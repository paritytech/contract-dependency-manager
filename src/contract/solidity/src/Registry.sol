// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.34;

interface IResolver {
    function publish(address proxy, uint128 versionKey, address target) external;
    function setMinSupported(address proxy, uint128 versionKey) external;
    function setFrozen(address proxy, bool frozen) external;
    function setFastPath(address proxy, bool enabled) external;
    function seal(address proxy) external;
    function setCode(address newImplementation) external;
}

/// CDM ContractRegistry implementation: name → semver-versioned history and
/// metadata URIs, and the factory of every name's shim. It is the resolver's
/// admin and its only writer.
/// Deployed behind the EIP-1967 proxy. The admin, implementation and frozen
/// flags live at fixed slots; everything else is one ERC-7201 struct.
contract Registry {
    struct ContractEntry {
        string name;
        uint128 versionKey;
        address addr;
        string metadataUri;
        address owner;
    }

    struct OptionalAddress {
        bool isSome;
        address value;
    }

    struct OptionalString {
        bool isSome;
        string value;
    }

    struct ContractPage {
        uint32 total;
        ContractEntry[] entries;
    }

    struct OptionalVersionEntry {
        bool isSome;
        uint128 versionKey;
        string metadataUri;
    }

    /// `versionCount == 0` means unregistered; every registered name has a proxy.
    struct NamedContractInfo {
        address owner;
        uint32 versionCount;
        address proxy;
    }

    error Unauthorized();
    error UnauthorizedAdmin();
    error ContractFrozen();
    error ContractNameEmpty();
    error ContractNameTooLong();
    error ContractNameInvalid();
    error VersionOverflow();
    error BadImplementation();
    error InvalidVersionKey();
    /// `(attempted, latest)`: published keys must strictly increase.
    error VersionNotMonotonic(uint128, uint128);
    error ResolverUnset();
    error ResolverAlreadySet();
    error InvalidResolver();
    error InvalidInitTarget();

    event Published(string indexed name, uint128 versionKey, address target);
    event ProxyCreated(string indexed name, address proxy);
    event Initialized(string indexed name, uint128 versionKey, address initTarget);
    event MinSupportedSet(string indexed name, uint128 versionKey);
    event ContractFrozenSet(string indexed name, bool frozen);
    event FastPathSet(string indexed name, bool enabled);
    event ContractSealed(string indexed name);
    event Upgraded(address indexed implementation);
    event AdminChanged(address previousAdmin, address newAdmin);
    event FrozenSet(bool frozen);

    bytes32 private constant IMPLEMENTATION_SLOT = 0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc;
    bytes32 private constant ADMIN_SLOT = 0xb53127684a568b3173ae13b9f8a6016e243e63b6e8ee1178d6a717850b5d6103;
    bytes32 private constant FROZEN_SLOT = bytes32(uint256(keccak256("cdm.registry.frozen")) - 1);

    uint256 private constant MAX_CONTRACT_NAME_LEN = 64;
    uint32 private constant MAX_PAGE_LIMIT = 100;
    bytes4 private constant MAGIC = 0xa2264d53;
    bytes4 private constant CALL_CODE = bytes4(keccak256("callCode(address,bytes)"));
    bytes4 private constant INITIALIZE = bytes4(keccak256("initialize(uint128,address)"));

    /// @custom:storage-location erc7201:cdm.registry.v1
    struct RegistryStorage {
        /// Registered names in registration order; drives `getContracts` paging.
        string[] names;
        mapping(string => NamedContractInfo) info;
        /// name → version index → packed semver key.
        mapping(string => mapping(uint32 => uint128)) versions;
        /// name → version index → metadata URI.
        mapping(string => mapping(uint32 => string)) metadataUriOf;
        /// The resolver proxy: every shim is constructed with it.
        address resolver;
    }

    /// keccak256(abi.encode(uint256(keccak256("cdm.registry.v1")) - 1)) & ~bytes32(uint256(0xff))
    bytes32 private constant STORAGE_ROOT = 0x2f9ca4198b1806e2802afcaa45efbe30cd86df59e0fca3c23144e2c191c5f800;

    /// keccak-256 of the frozen per-name shim blob
    /// (`src/contract/proxy/artifacts/contract-proxy.polkavm`). Every name's
    /// shim is created from it, and it is part of each new name's address.
    bytes32 private constant SHIM_CODE_HASH = 0x7e5df2e36e06a4f78320a5fbdb4443ce4963850f5d2e2b371ea53a633c7c75ec;

    /// The PVM contract that instantiates a shim by code hash. EVM bytecode
    /// cannot create a PVM contract, so the registry delegate-calls it and
    /// the new shim's address derives from the registry.
    address private immutable SHIM_FACTORY;

    /// Runs only when the implementation itself is deployed. Through the
    /// proxy, admin is initialized by the proxy's constructor instead.
    constructor(address shimFactory) {
        SHIM_FACTORY = shimFactory;
        _store(ADMIN_SLOT, uint256(uint160(msg.sender)));
    }

    // ─── Admin & longevity ───────────────────────────────────────────────

    function getAdmin() public view returns (address) {
        return address(uint160(_load(ADMIN_SLOT)));
    }

    function setAdmin(address newAdmin) external {
        _requireAdmin();
        emit AdminChanged(getAdmin(), newAdmin);
        _store(ADMIN_SLOT, uint256(uint160(newAdmin)));
    }

    /// Upgrade in place: point the proxy at a new implementation.
    function setCode(address newImplementation) external {
        _requireAdmin();
        if (newImplementation.code.length == 0) revert BadImplementation();
        _store(IMPLEMENTATION_SLOT, uint256(uint160(newImplementation)));
        emit Upgraded(newImplementation);
    }

    function getCode() external view returns (address) {
        return address(uint160(_load(IMPLEMENTATION_SLOT)));
    }

    /// Code hash of the per-name shim blob this implementation creates shims from.
    function getProxyCodeHash() external pure returns (bytes32) {
        return SHIM_CODE_HASH;
    }

    /// Set once: every shim bakes the resolver address into its address.
    function setResolver(address resolver) external {
        _requireAdmin();
        if (resolver == address(0)) revert InvalidResolver();
        RegistryStorage storage $ = _state();
        if ($.resolver != address(0)) revert ResolverAlreadySet();
        $.resolver = resolver;
    }

    function getResolver() external view returns (address) {
        return _state().resolver;
    }

    function upgradeResolver(address newImplementation) external {
        _requireAdmin();
        _resolver().setCode(newImplementation);
    }

    function freeze() external {
        _requireAdmin();
        _store(FROZEN_SLOT, 1);
        emit FrozenSet(true);
    }

    function unfreeze() external {
        _requireAdmin();
        _store(FROZEN_SLOT, 0);
        emit FrozenSet(false);
    }

    function isFrozen() public view returns (bool) {
        return _load(FROZEN_SLOT) != 0;
    }

    // ─── Publishing ──────────────────────────────────────────────────────

    function publish(string calldata contractName, uint128 versionKey, address target, string calldata metadataUri)
        external
    {
        _publish(contractName, versionKey, target, metadataUri, address(0));
    }

    function publishWithInit(
        string calldata contractName,
        uint128 versionKey,
        address target,
        string calldata metadataUri,
        address initTarget
    ) external {
        if (initTarget == address(0) || initTarget.code.length == 0) revert InvalidInitTarget();
        _publish(contractName, versionKey, target, metadataUri, initTarget);
    }

    function _publish(
        string calldata contractName,
        uint128 versionKey,
        address target,
        string calldata metadataUri,
        address initTarget
    ) private {
        _requireUnfrozen();
        _validateName(contractName);
        if (versionKey == 0 || versionKey >> 95 != 0) revert InvalidVersionKey();

        RegistryStorage storage $ = _state();
        NamedContractInfo memory entry = $.info[contractName];
        bool isNewName = entry.versionCount == 0;
        if (isNewName) {
            entry.owner = msg.sender;
        } else if (entry.owner != msg.sender) {
            revert Unauthorized();
        }

        uint128 previousLatest = isNewName ? 0 : $.versions[contractName][entry.versionCount - 1];
        if (previousLatest != 0 && versionKey <= previousLatest) {
            revert VersionNotMonotonic(versionKey, previousLatest);
        }
        if (target.code.length == 0) revert BadImplementation();

        if (entry.proxy == address(0)) {
            entry.proxy = _createShim(contractName);
            emit ProxyCreated(contractName, entry.proxy);
        }
        _resolver().publish(entry.proxy, versionKey, target);

        uint32 index = entry.versionCount;
        if (index == type(uint32).max) revert VersionOverflow();
        entry.versionCount = index + 1;
        if (isNewName) $.names.push(contractName);
        $.info[contractName] = entry;
        $.versions[contractName][index] = versionKey;
        $.metadataUriOf[contractName][index] = metadataUri;

        emit Published(contractName, versionKey, target);

        if (initTarget != address(0)) {
            // [MAGIC][0][callCode][init target word][initialize(from, owner)]
            (bool ok, bytes memory reason) = entry.proxy
                .call(
                    abi.encodePacked(
                        MAGIC,
                        uint128(0),
                        CALL_CODE,
                        abi.encode(initTarget),
                        INITIALIZE,
                        abi.encode(previousLatest, entry.owner)
                    )
                );
            if (!ok) {
                assembly {
                    revert(add(reason, 32), mload(reason))
                }
            }
            emit Initialized(contractName, versionKey, initTarget);
        }
    }

    function setMinSupported(string calldata contractName, uint128 versionKey) external {
        address proxy = _ownedProxy(contractName);
        _resolver().setMinSupported(proxy, versionKey);
        emit MinSupportedSet(contractName, versionKey);
    }

    function freezeContract(string calldata contractName) external {
        _setContractFrozen(contractName, true);
    }

    function unfreezeContract(string calldata contractName) external {
        _setContractFrozen(contractName, false);
    }

    function setFastPath(string calldata contractName, bool enabled) external {
        address proxy = _ownedProxy(contractName);
        _resolver().setFastPath(proxy, enabled);
        emit FastPathSet(contractName, enabled);
    }

    function sealContract(string calldata contractName) external {
        address proxy = _ownedProxy(contractName);
        _resolver().seal(proxy);
        emit ContractSealed(contractName);
    }

    // ─── Queries ─────────────────────────────────────────────────────────

    /// The name's stable address as `(bool isSome, address)`.
    function getAddress(string calldata contractName) public view returns (OptionalAddress memory) {
        NamedContractInfo storage entry = _state().info[contractName];
        bool isSome = entry.versionCount > 0;
        return OptionalAddress(isSome, isSome ? entry.proxy : address(0));
    }

    function getMetadataUri(string calldata contractName) external view returns (OptionalString memory) {
        RegistryStorage storage $ = _state();
        uint32 count = $.info[contractName].versionCount;
        if (count == 0) return OptionalString(false, "");
        return OptionalString(true, $.metadataUriOf[contractName][count - 1]);
    }

    function getProxy(string calldata contractName) external view returns (OptionalAddress memory) {
        return getAddress(contractName);
    }

    function getLatestKey(string calldata contractName) external view returns (uint128) {
        RegistryStorage storage $ = _state();
        uint32 count = $.info[contractName].versionCount;
        return count == 0 ? 0 : $.versions[contractName][count - 1];
    }

    function getVersionAt(string calldata contractName, uint32 index)
        external
        view
        returns (OptionalVersionEntry memory)
    {
        RegistryStorage storage $ = _state();
        if (index >= $.info[contractName].versionCount) return OptionalVersionEntry(false, 0, "");
        return OptionalVersionEntry(true, $.versions[contractName][index], $.metadataUriOf[contractName][index]);
    }

    function getContractNameAt(uint32 index) external view returns (string memory) {
        string[] storage names = _state().names;
        return index < names.length ? names[index] : "";
    }

    /// A page of latest contract entries by registration index.
    function getContracts(uint32 start, uint32 count) external view returns (ContractPage memory) {
        RegistryStorage storage $ = _state();
        uint256 total = $.names.length;
        uint256 end = uint256(start) + (count < MAX_PAGE_LIMIT ? count : MAX_PAGE_LIMIT);
        if (end > total) end = total;
        ContractPage memory page;
        // forge-lint: disable-next-line(unsafe-typecast)
        page.total = uint32(total);
        page.entries = new ContractEntry[](end > start ? end - start : 0);
        for (uint256 i = start; i < end; i++) {
            string memory name = $.names[i];
            NamedContractInfo storage entry = $.info[name];
            uint32 index = entry.versionCount - 1;
            page.entries[i - start] =
                ContractEntry(name, $.versions[name][index], entry.proxy, $.metadataUriOf[name][index], entry.owner);
        }
        return page;
    }

    function getOwner(string calldata contractName) external view returns (address) {
        return _state().info[contractName].owner;
    }

    function getVersionCount(string calldata contractName) external view returns (uint32) {
        return _state().info[contractName].versionCount;
    }

    function getContractCount() external view returns (uint32) {
        // forge-lint: disable-next-line(unsafe-typecast)
        return uint32(_state().names.length);
    }

    // ─── Internals ───────────────────────────────────────────────────────

    function _requireAdmin() private view {
        if (msg.sender != getAdmin()) revert UnauthorizedAdmin();
    }

    /// Frozen blocks every mutation for everyone but the admin.
    function _requireUnfrozen() private view {
        if (isFrozen() && msg.sender != getAdmin()) revert ContractFrozen();
    }

    function _setContractFrozen(string calldata contractName, bool frozen) private {
        address proxy = _ownedProxy(contractName);
        _resolver().setFrozen(proxy, frozen);
        emit ContractFrozenSet(contractName, frozen);
    }

    /// The proxy of `contractName`, for its owner only and only while the
    /// registry is not frozen.
    function _ownedProxy(string calldata contractName) private view returns (address) {
        _requireUnfrozen();
        NamedContractInfo storage entry = _state().info[contractName];
        if (entry.versionCount == 0 || entry.owner != msg.sender) revert Unauthorized();
        return entry.proxy;
    }

    function _resolver() private view returns (IResolver) {
        address resolver = _state().resolver;
        if (resolver == address(0)) revert ResolverUnset();
        return IResolver(resolver);
    }

    /// Create the name's shim with `salt = keccak256(name)` and the resolver
    /// as its one constructor argument, so its address is a pure function of
    /// (registry, shim blob, resolver address, name). The factory's calldata
    /// is `[salt][code hash][constructor input]`.
    function _createShim(string calldata contractName) private returns (address) {
        (bool ok, bytes memory result) = SHIM_FACTORY.delegatecall(
            abi.encodePacked(keccak256(bytes(contractName)), SHIM_CODE_HASH, abi.encode(address(_resolver())))
        );
        if (!ok) {
            assembly {
                revert(add(result, 32), mload(result))
            }
        }
        return abi.decode(result, (address));
    }

    function _state() private pure returns (RegistryStorage storage $) {
        assembly {
            $.slot := STORAGE_ROOT
        }
    }

    // "@scope/package": one "@"-prefixed scope and a package separated by
    // exactly one "/", both non-empty, of alphanumerics, "-" and "_".
    function _validateName(string calldata name) private pure {
        bytes calldata b = bytes(name);
        if (b.length == 0) revert ContractNameEmpty();
        if (b.length > MAX_CONTRACT_NAME_LEN) revert ContractNameTooLong();
        if (b[0] != "@") revert ContractNameInvalid();
        uint256 slash;
        for (uint256 i = 1; i < b.length; i++) {
            bytes1 c = b[i];
            if (c == "/") {
                if (slash != 0) revert ContractNameInvalid();
                slash = i;
            } else if (!((c >= "0" && c <= "9") || (c >= "a" && c <= "z") || (c >= "A" && c <= "Z") || c == "-"
                        || c == "_")) {
                revert ContractNameInvalid();
            }
        }
        if (slash < 2 || slash + 1 >= b.length) revert ContractNameInvalid();
    }

    function _load(bytes32 slot) private view returns (uint256 value) {
        assembly {
            value := sload(slot)
        }
    }

    function _store(bytes32 slot, uint256 value) private {
        assembly {
            sstore(slot, value)
        }
    }
}
