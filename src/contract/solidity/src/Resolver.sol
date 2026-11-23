// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.34;

/// CDM resolver implementation.
/// Deployed behind the EIP-1967 proxy with the registry as admin: the routing
/// tables and policy for every call a shim asks about. The admin and
/// implementation live at fixed slots; everything else is one ERC-7201 struct.
contract Resolver {
    /// What a shim does with the call it forwarded: kind 0 returns `payload`,
    /// kind 1 delegate-calls `target` with `payload ++ data[strip..]`.
    struct Resolution {
        uint8 kind;
        address target;
        uint32 strip;
        bytes payload;
    }

    /// Two slots: the keys, then `latestImpl` with the flags. A published
    /// name's `latestImpl` is never zero, so flipping a flag never creates or
    /// removes a storage item.
    struct Routing {
        uint128 latestKey;
        uint128 minSupported;
        address latestImpl;
        bool frozen;
        bool fastPathOff;
        bool isSealed;
    }

    error UnknownVersion();
    /// `(requested, minSupported)`: versioned call below the owner's floor.
    error UnsupportedVersion(uint128, uint128);
    error UnauthorizedAdmin();
    /// `(attempted, latest)`: published keys must strictly increase.
    error VersionNotMonotonic(uint128, uint128);
    error InvalidVersionKey();
    error InvalidImplementation();
    error MalformedCall();
    error UnknownMetaSelector();
    /// `(requested, current)`: the floor only ratchets up.
    error MinNotMonotonic(uint128, uint128);
    /// `(requested, latest)`: the floor cannot exceed the latest version.
    error MinAboveLatest(uint128, uint128);
    error NoVersions();
    error ContractFrozen();
    error BadImplementation();
    error NameSealed();

    bytes32 private constant IMPLEMENTATION_SLOT = 0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc;
    bytes32 private constant ADMIN_SLOT = 0xb53127684a568b3173ae13b9f8a6016e243e63b6e8ee1178d6a717850b5d6103;

    bytes4 private constant MAGIC = 0xa2264d53;
    uint32 private constant VERSIONED_HEADER_LEN = 20;
    uint32 private constant META_HEADER_LEN = 24;

    bytes4 private constant CALL_CODE = bytes4(keccak256("callCode(address,bytes)"));
    bytes4 private constant FROZEN = bytes4(keccak256("frozen()"));
    bytes4 private constant IMPL_OF = bytes4(keccak256("implOf(uint128)"));
    bytes4 private constant LATEST = bytes4(keccak256("latest()"));
    bytes4 private constant MIN_SUPPORTED = bytes4(keccak256("minSupported()"));
    bytes4 private constant ADMIN = bytes4(keccak256("admin()"));
    bytes4 private constant SHIM_SET_FAST_PATH = bytes4(keccak256("setFastPath(uint128,address)"));
    bytes4 private constant SHIM_SEAL = bytes4(keccak256("seal(uint128,address)"));

    /// @custom:storage-location erc7201:cdm.resolver.v1
    struct ResolverStorage {
        /// Shim → latest version, floor, frozen, fast-path opt-out, sealed.
        mapping(address => Routing) routing;
        /// Shim → version key → implementation.
        mapping(address => mapping(uint128 => address)) implementations;
    }

    /// keccak256(abi.encode(uint256(keccak256("cdm.resolver.v1")) - 1)) & ~bytes32(uint256(0xff))
    bytes32 private constant STORAGE_ROOT = 0x582f05604914296885c9056699245f1db329eb5c152585294d191ef37929e000;

    /// Runs only when the implementation itself is deployed. Through the
    /// proxy, admin is initialized by the proxy's constructor instead.
    constructor() {
        assembly {
            sstore(ADMIN_SLOT, caller())
        }
    }

    // ─── Routing ─────────────────────────────────────────────────────────

    /// Route one shim call: `msg.sender` is the shim, `caller` is who called
    /// it. `value` is carried for future policy and unused today.
    function resolve(address caller, uint256 value, bytes calldata data) external view returns (Resolution memory) {
        value;
        Routing memory r = _state().routing[msg.sender];

        if (data.length < 4 || bytes4(data[:4]) != MAGIC) {
            if (r.frozen) revert ContractFrozen();
            if (r.latestImpl == address(0)) revert NoVersions();
            return _delegate(r.latestImpl, 0);
        }
        if (data.length < VERSIONED_HEADER_LEN) revert MalformedCall();
        uint128 key = uint128(bytes16(data[4:20]));
        if (key != 0) {
            if (r.frozen) revert ContractFrozen();
            if (key < r.minSupported) revert UnsupportedVersion(key, r.minSupported);
            address target = _state().implementations[msg.sender][key];
            if (target == address(0)) revert UnknownVersion();
            return _delegate(target, VERSIONED_HEADER_LEN);
        }
        if (data.length < META_HEADER_LEN) revert MalformedCall();

        bytes4 selector = bytes4(data[20:24]);
        bytes calldata args = data[META_HEADER_LEN:];
        if (selector == IMPL_OF) {
            return _answer(abi.encode(_state().implementations[msg.sender][uint128(_word(args, 128))]));
        }
        if (selector == LATEST) {
            if (r.latestKey == 0) revert NoVersions();
            return _answer(abi.encode(r.latestKey, r.latestImpl));
        }
        if (selector == MIN_SUPPORTED) return _answer(abi.encode(r.minSupported));
        if (selector == FROZEN) return _answer(abi.encode(r.frozen));
        if (selector == ADMIN) return _answer(abi.encode(getAdmin()));
        if (selector == CALL_CODE) {
            // Live while frozen: the freeze → publish+init → unfreeze window
            // depends on it.
            if (caller != getAdmin()) revert UnauthorizedAdmin();
            address target = address(uint160(_word(args, 160)));
            if (target == address(0)) revert InvalidImplementation();
            return _delegate(target, META_HEADER_LEN + 32);
        }
        revert UnknownMetaSelector();
    }

    // ─── Registry-only mutations ─────────────────────────────────────────

    /// Register `implementation` as version `versionKey` of the name behind
    /// `proxy`; keys must strictly increase. The shim gets the version as its
    /// shortcut unless the name is frozen or opted out.
    function publish(address proxy, uint128 versionKey, address implementation) external {
        Routing memory r = _mutable(proxy);
        if (versionKey == 0 || versionKey >> 95 != 0) revert InvalidVersionKey();
        if (implementation == address(0)) revert InvalidImplementation();
        if (r.latestKey != 0 && versionKey <= r.latestKey) revert VersionNotMonotonic(versionKey, r.latestKey);
        r.latestKey = versionKey;
        r.latestImpl = implementation;
        _state().routing[proxy] = r;
        _state().implementations[proxy][versionKey] = implementation;
        if (!r.frozen && !r.fastPathOff) _fillFastPath(proxy, r);
    }

    /// Raise the name's floor: monotonic, at most the latest key.
    function setMinSupported(address proxy, uint128 versionKey) external {
        Routing memory r = _mutable(proxy);
        if (versionKey >> 95 != 0) revert InvalidVersionKey();
        if (versionKey < r.minSupported) revert MinNotMonotonic(versionKey, r.minSupported);
        if (r.latestKey == 0) revert NoVersions();
        if (versionKey > r.latestKey) revert MinAboveLatest(versionKey, r.latestKey);
        _state().routing[proxy].minSupported = versionKey;
    }

    /// While frozen, plain and versioned calls revert `ContractFrozen()`; the
    /// meta plane keeps answering. Freezing empties the shim's shortcut so
    /// those calls reach this policy.
    function setFrozen(address proxy, bool frozen) external {
        Routing memory r = _mutable(proxy);
        _state().routing[proxy].frozen = frozen;
        if (r.latestKey != 0) {
            if (frozen) _clearFastPath(proxy);
            else if (!r.fastPathOff) _fillFastPath(proxy, r);
        }
    }

    /// Choose whether the name's shim serves the latest version from its own
    /// storage (`enabled`, the default) or asks on every call.
    function setFastPath(address proxy, bool enabled) external {
        Routing memory r = _mutable(proxy);
        _state().routing[proxy].fastPathOff = !enabled;
        if (r.latestKey != 0) {
            if (enabled && !r.frozen) _fillFastPath(proxy, r);
            else _clearFastPath(proxy);
        }
    }

    /// Pin the name to its latest version for good.
    function seal(address proxy) external {
        Routing memory r = _mutable(proxy);
        if (r.frozen) revert ContractFrozen();
        if (r.latestKey == 0) revert NoVersions();
        _state().routing[proxy].isSealed = true;
        _callShim(proxy, SHIM_SEAL, r.latestKey, r.latestImpl);
    }

    // ─── Admin & queries ─────────────────────────────────────────────────

    function setCode(address newImplementation) external {
        _requireAdmin();
        if (newImplementation.code.length == 0) revert BadImplementation();
        assembly {
            sstore(IMPLEMENTATION_SLOT, newImplementation)
        }
    }

    function getCode() external view returns (address) {
        address implementation;
        assembly {
            implementation := sload(IMPLEMENTATION_SLOT)
        }
        return implementation;
    }

    /// The registry.
    function getAdmin() public view returns (address) {
        address admin;
        assembly {
            admin := sload(ADMIN_SLOT)
        }
        return admin;
    }

    function routingOf(address proxy) external view returns (Routing memory) {
        return _state().routing[proxy];
    }

    function implOf(address proxy, uint128 versionKey) external view returns (address) {
        return _state().implementations[proxy][versionKey];
    }

    // ─── Internals ───────────────────────────────────────────────────────

    function _state() private pure returns (ResolverStorage storage $) {
        assembly {
            $.slot := STORAGE_ROOT
        }
    }

    function _requireAdmin() private view {
        if (msg.sender != getAdmin()) revert UnauthorizedAdmin();
    }

    /// The routing state of a name the registry may still change.
    function _mutable(address proxy) private view returns (Routing memory r) {
        _requireAdmin();
        r = _state().routing[proxy];
        if (r.isSealed) revert NameSealed();
    }

    function _delegate(address target, uint32 strip) private pure returns (Resolution memory) {
        return Resolution(1, target, strip, "");
    }

    function _answer(bytes memory payload) private pure returns (Resolution memory) {
        return Resolution(0, address(0), 0, payload);
    }

    /// The first ABI word of `args`, whose bits above `bits` must be zero.
    function _word(bytes calldata args, uint256 bits) private pure returns (uint256 word) {
        if (args.length < 32) revert MalformedCall();
        word = uint256(bytes32(args[:32]));
        if (word >> bits != 0) revert MalformedCall();
    }

    function _fillFastPath(address proxy, Routing memory r) private {
        _callShim(proxy, SHIM_SET_FAST_PATH, r.latestKey, r.latestImpl);
    }

    function _clearFastPath(address proxy) private {
        _callShim(proxy, SHIM_SET_FAST_PATH, 0, address(0));
    }

    /// `[MAGIC][0][selector][key word][implementation word]` to the shim
    /// behind `proxy`, bubbling its revert unchanged.
    function _callShim(address proxy, bytes4 selector, uint128 key, address implementation) private {
        (bool ok, bytes memory reason) =
            proxy.call(abi.encodePacked(MAGIC, uint128(0), selector, abi.encode(key, implementation)));
        if (!ok) {
            assembly {
                revert(add(reason, 32), mload(reason))
            }
        }
    }
}
