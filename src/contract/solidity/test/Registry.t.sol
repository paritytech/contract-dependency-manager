// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.34;

import {Registry} from "../src/Registry.sol";
import {Resolver} from "../src/Resolver.sol";
import {ShimDouble, ShimFactoryDouble} from "./Doubles.sol";
import {ResolverSpy} from "./RegistryDoubles.sol";
import {Test, Vm} from "./Test.sol";

/// The registry's methods against the real resolver, behind a `ResolverSpy`
/// that keeps what the registry sent it, with a `ShimDouble` standing in for
/// every name's shim. The dispatch-level tests at the end send raw calldata
/// to lock the wire format.
contract RegistryTest is Test {
    address private constant ADMIN = 0xadADADadAdADAdadADADADadadADAdAdadaDAdAD;
    address private constant ALICE = 0xaAaAaAaaAaAaAaaAaAAAAAAAAaaaAaAaAaaAaaAa;
    address private constant BOB = 0xB0B0b0B0B0B0B0b0B0B0B0b0b0b0b0B0b0b0B0B0;
    address private constant ADDR_1 = 0x1111111111111111111111111111111111111111;
    address private constant ADDR_2 = 0x2222222222222222222222222222222222222222;
    address private constant NEW_IMPL = 0x1C1C1c1c1c1C1c1c1c1c1C1c1c1c1c1C1C1c1c1c;
    /// A stand-in initialization contract address.
    address private constant INIT_1 = 0x1B1b1B1B1B1B1B1B1b1b1B1B1b1b1B1B1b1b1B1b;

    string private constant NAME = "@cdm/registry";
    string private constant URI_1 = "ipfs://one";
    string private constant URI_2 = "ipfs://two";

    uint128 private constant V1_0_0 = uint128(1) << 64;
    uint128 private constant V1_1_0 = (uint128(1) << 64) | (uint128(1) << 32);
    uint128 private constant V2_0_0 = uint128(2) << 64;

    address private factory;
    address private resolverImplementation;
    Registry private registry;
    ResolverSpy private resolver;

    function setUp() public {
        factory = address(new ShimFactoryDouble());
        resolverImplementation = address(new Resolver());
        // The registry refuses a published, upgrade or initialization target
        // that holds no code.
        vm.etch(ADDR_1, hex"00");
        vm.etch(ADDR_2, hex"00");
        vm.etch(NEW_IMPL, hex"00");
        vm.etch(INIT_1, hex"00");
    }

    // ─── Helpers ─────────────────────────────────────────────────────────────

    /// A registry constructed by `admin`, and a resolver that has the registry
    /// as its admin but is not set on it. Every later call comes from `admin`
    /// until a test starts another prank.
    function deployedWithoutResolver(address admin) private {
        vm.startPrank(admin);
        registry = new Registry(factory);
        resolver = new ResolverSpy(resolverImplementation, address(registry));
    }

    /// `deployedWithoutResolver` with the resolver set: ready to publish.
    function deployed(address admin) private {
        deployedWithoutResolver(admin);
        registry.setResolver(address(resolver));
    }

    /// Where the factory double puts the shim of `name`: CREATE2 from the
    /// registry with `salt = keccak256(name)` and the resolver as the
    /// constructor argument.
    function shimOf(string memory name) private view returns (address) {
        bytes32 initCodeHash = keccak256(abi.encodePacked(type(ShimDouble).creationCode, abi.encode(address(resolver))));
        return address(
            uint160(
                uint256(
                    keccak256(abi.encodePacked(bytes1(0xff), address(registry), keccak256(bytes(name)), initCodeHash))
                )
            )
        );
    }

    function word(uint256 value) private pure returns (bytes32) {
        return bytes32(value);
    }

    function topic0(string memory signature) private pure returns (bytes32) {
        return keccak256(bytes(signature));
    }

    function topics(bytes32 first) private pure returns (bytes32[] memory out) {
        out = new bytes32[](1);
        out[0] = first;
    }

    function topics(bytes32 first, bytes32 second) private pure returns (bytes32[] memory out) {
        out = new bytes32[](2);
        out[0] = first;
        out[1] = second;
    }

    function assertLog(Vm.Log memory log, bytes32[] memory expectedTopics, bytes memory expectedData) private view {
        assertEq(log.emitter, address(registry));
        assertEq(log.topics, expectedTopics);
        assertEq(log.data, expectedData);
    }

    function lastLog() private returns (Vm.Log memory) {
        Vm.Log[] memory logs = vm.getRecordedLogs();
        return logs[logs.length - 1];
    }

    function assertSome(Registry.OptionalAddress memory actual, address expected) private pure {
        assertTrue(actual.isSome);
        assertEq(actual.value, expected);
    }

    function assertSome(Registry.OptionalString memory actual, string memory expected) private pure {
        assertTrue(actual.isSome);
        assertEq(actual.value, expected);
    }

    function assertNone(Registry.OptionalAddress memory actual) private pure {
        assertFalse(actual.isSome);
        assertEq(actual.value, address(0));
    }

    function assertNone(Registry.OptionalString memory actual) private pure {
        assertFalse(actual.isSome);
        assertEq(actual.value, "");
    }

    function assertVersion(
        Registry.OptionalVersionEntry memory actual,
        bool isSome,
        uint128 versionKey,
        string memory metadataUri
    ) private pure {
        assertEq(actual.isSome, isSome);
        assertEq(actual.versionKey, versionKey);
        assertEq(actual.metadataUri, metadataUri);
    }

    function assertPage(Registry.ContractPage memory actual, uint32 total, Registry.ContractEntry[] memory entries)
        private
        pure
    {
        assertEq(abi.encode(actual), abi.encode(Registry.ContractPage(total, entries)));
    }

    function list() private pure returns (Registry.ContractEntry[] memory) {
        return new Registry.ContractEntry[](0);
    }

    function list(Registry.ContractEntry memory a) private pure returns (Registry.ContractEntry[] memory out) {
        out = new Registry.ContractEntry[](1);
        out[0] = a;
    }

    function list(Registry.ContractEntry memory a, Registry.ContractEntry memory b)
        private
        pure
        returns (Registry.ContractEntry[] memory out)
    {
        out = new Registry.ContractEntry[](2);
        out[0] = a;
        out[1] = b;
    }

    function list(Registry.ContractEntry memory a, Registry.ContractEntry memory b, Registry.ContractEntry memory c)
        private
        pure
        returns (Registry.ContractEntry[] memory out)
    {
        out = new Registry.ContractEntry[](3);
        out[0] = a;
        out[1] = b;
        out[2] = c;
    }

    /// The exact calldata the registry must send the resolver.
    function resolverCalldata(string memory signature, bytes memory args) private pure returns (bytes memory) {
        return abi.encodePacked(bytes4(keccak256(bytes(signature))), args);
    }

    function resolverPublish(string memory name, uint128 key, address target) private view returns (bytes memory) {
        return resolverCalldata("publish(address,uint128,address)", abi.encode(shimOf(name), key, target));
    }

    /// The resolver received exactly this call since the last check.
    function assertResolverReceived(bytes memory only) private {
        bytes[] memory calls = resolver.take();
        assertEq(calls.length, 1);
        assertEq(calls[0], only);
    }

    /// The resolver received exactly these two calls, in order, since the
    /// last check.
    function assertResolverReceived(bytes memory first, bytes memory second) private {
        bytes[] memory calls = resolver.take();
        assertEq(calls.length, 2);
        assertEq(calls[0], first);
        assertEq(calls[1], second);
    }

    /// Makes the resolver accept every publish. It enforces the registry's
    /// version rules itself, so a test of those rules stubs it to see the
    /// registry's own revert.
    function resolverAcceptsEveryPublish() private {
        vm.mockCall(address(resolver), resolverCalldata("publish(address,uint128,address)", ""), "");
    }

    /// The exact callCode calldata a publish-with-initialization must send
    /// the shim: `[MAGIC][0][callCode][init word]` followed by
    /// `[initialize selector][from word][owner word]`, unpadded.
    function initCalldata(address initTarget, uint128 from, address owner) private pure returns (bytes memory) {
        return abi.encodePacked(
            hex"a2264d53",
            uint128(0),
            bytes4(keccak256("callCode(address,bytes)")),
            abi.encode(initTarget),
            bytes4(keccak256("initialize(uint128,address)")),
            abi.encode(from, owner)
        );
    }

    // ─── Constructor ─────────────────────────────────────────────────────────

    function test_constructor_sets_admin() public {
        vm.prank(ALICE);
        registry = new Registry(factory);
        assertEq(registry.getAdmin(), ALICE);
    }

    // ─── Publishing ──────────────────────────────────────────────────────────

    function test_first_publish_registers_name_and_creates_proxy() public {
        deployed(ALICE);
        address shim = shimOf(NAME);

        // The factory is asked for the frozen blob: `[salt][code hash][resolver word]`.
        bytes32 shimCodeHash = keccak256(vm.readFileBinary("../proxy/artifacts/contract-proxy.polkavm"));
        vm.expectCall(factory, abi.encodePacked(keccak256(bytes(NAME)), shimCodeHash, abi.encode(address(resolver))), 1);
        registry.publish(NAME, V1_0_0, ADDR_1, URI_1);

        assertEq(registry.getOwner(NAME), ALICE);
        assertEq(registry.getVersionCount(NAME), 1);
        // The name's address is its shim, not the implementation.
        assertSome(registry.getAddress(NAME), shim);
        assertSome(registry.getProxy(NAME), shim);
        assertEq(registry.getLatestKey(NAME), V1_0_0);
        assertSome(registry.getMetadataUri(NAME), URI_1);
        assertEq(registry.getContractCount(), 1);
        assertEq(registry.getContractNameAt(0), NAME);

        // The resolver was told about the version.
        assertResolverReceived(resolverPublish(NAME, V1_0_0, ADDR_1));
    }

    function test_second_publish_keeps_address_and_bumps_latest() public {
        deployed(ALICE);
        registry.publish(NAME, V1_0_0, ADDR_1, URI_1);
        resolver.take();

        registry.publish(NAME, V1_1_0, ADDR_2, URI_2);

        assertEq(registry.getVersionCount(NAME), 2);
        // Same name, not a new entry.
        assertEq(registry.getContractCount(), 1);

        // The stable address never moves; the latest key does.
        assertSome(registry.getAddress(NAME), shimOf(NAME));
        assertEq(registry.getLatestKey(NAME), V1_1_0);
        assertSome(registry.getMetadataUri(NAME), URI_2);

        // Both versions are recorded with their keys and metadata URIs.
        assertVersion(registry.getVersionAt(NAME, 0), true, V1_0_0, URI_1);
        assertVersion(registry.getVersionAt(NAME, 1), true, V1_1_0, URI_2);
        // Beyond the count: none.
        assertVersion(registry.getVersionAt(NAME, 2), false, 0, "");

        // Only the version registration went out.
        assertResolverReceived(resolverPublish(NAME, V1_1_0, ADDR_2));
    }

    function test_publish_requires_strictly_increasing_keys() public {
        deployed(ALICE);
        resolverAcceptsEveryPublish();
        registry.publish(NAME, V1_1_0, ADDR_1, URI_1);

        uint128[2] memory keys = [V1_1_0, V1_0_0];
        for (uint256 i = 0; i < keys.length; i++) {
            vm.expectRevert(abi.encodeWithSelector(Registry.VersionNotMonotonic.selector, keys[i], V1_1_0));
            registry.publish(NAME, keys[i], ADDR_2, URI_2);
        }
        assertEq(registry.getVersionCount(NAME), 1);
    }

    function test_publish_rejects_invalid_keys() public {
        deployed(ALICE);
        resolverAcceptsEveryPublish();

        uint128[4] memory keys = [uint128(0), uint128(1) << 95, uint128(1) << 96, type(uint128).max];
        for (uint256 i = 0; i < keys.length; i++) {
            vm.expectRevert(Registry.InvalidVersionKey.selector);
            registry.publish(NAME, keys[i], ADDR_1, URI_1);
        }
        assertEq(registry.getContractCount(), 0);
    }

    function test_publish_without_resolver_fails() public {
        deployedWithoutResolver(ALICE);
        vm.expectRevert(Registry.ResolverUnset.selector);
        registry.publish(NAME, V1_0_0, ADDR_1, URI_1);
        assertEq(registry.getContractCount(), 0);
    }

    function test_owner_only_calls_check_the_caller_before_the_resolver() public {
        deployedWithoutResolver(ALICE);
        vm.expectRevert(Registry.Unauthorized.selector);
        registry.setMinSupported(NAME, V1_0_0);
        vm.expectRevert(Registry.Unauthorized.selector);
        registry.freezeContract(NAME);
        vm.expectRevert(Registry.Unauthorized.selector);
        registry.unfreezeContract(NAME);
        vm.expectRevert(Registry.Unauthorized.selector);
        registry.setFastPath(NAME, false);
        vm.expectRevert(Registry.Unauthorized.selector);
        registry.sealContract(NAME);
    }

    function test_publish_by_non_owner_is_unauthorized() public {
        deployed(ALICE);
        registry.publish(NAME, V1_0_0, ADDR_1, URI_1);

        vm.startPrank(BOB);
        vm.expectRevert(Registry.Unauthorized.selector);
        registry.publish(NAME, V1_1_0, ADDR_2, URI_2);

        // Nothing changed.
        assertEq(registry.getVersionCount(NAME), 1);
        assertSome(registry.getAddress(NAME), shimOf(NAME));
        assertEq(registry.getOwner(NAME), ALICE);
    }

    function test_publish_rejects_invalid_names() public {
        deployed(ALICE);

        vm.expectRevert(Registry.ContractNameEmpty.selector);
        registry.publish("", V1_0_0, ADDR_1, URI_1);

        bytes memory package = new bytes(64);
        for (uint256 i = 0; i < package.length; i++) {
            package[i] = "a";
        }
        vm.expectRevert(Registry.ContractNameTooLong.selector);
        registry.publish(string.concat("@scope/", string(package)), V1_0_0, ADDR_1, URI_1);

        string[2] memory names = ["cdm/registry", "@cdm"];
        for (uint256 i = 0; i < names.length; i++) {
            vm.expectRevert(Registry.ContractNameInvalid.selector);
            registry.publish(names[i], V1_0_0, ADDR_1, URI_1);
        }

        assertEq(registry.getContractCount(), 0);
    }

    // ─── publishWithInit ─────────────────────────────────────────────────────

    function test_publish_with_init_first_publish_sends_from_zero_and_owner() public {
        deployed(ALICE);
        vm.recordLogs();

        registry.publishWithInit(NAME, V1_0_0, ADDR_1, URI_1, INIT_1);

        // Version registration first, then the initialization: it is the last
        // call the shim received, after the one the resolver made on publish.
        assertResolverReceived(resolverPublish(NAME, V1_0_0, ADDR_1));
        // First publish: from = 0, owner = the first publisher.
        assertEq(ShimDouble(payable(shimOf(NAME))).lastCall(), initCalldata(INIT_1, 0, ALICE));

        // Registry state is the same as a plain publish.
        assertEq(registry.getVersionCount(NAME), 1);
        assertEq(registry.getLatestKey(NAME), V1_0_0);

        // ProxyCreated, Published, then Initialized.
        Vm.Log[] memory logs = vm.getRecordedLogs();
        assertEq(logs.length, 3);
        assertLog(
            logs[2],
            topics(topic0("Initialized(string,uint128,address)"), keccak256(bytes(NAME))),
            abi.encode(V1_0_0, INIT_1)
        );
    }

    function test_publish_with_init_upgrade_sends_previous_latest_as_from() public {
        deployed(ALICE);
        registry.publish(NAME, V1_0_0, ADDR_1, URI_1);
        resolver.take();

        registry.publishWithInit(NAME, V2_0_0, ADDR_2, URI_2, INIT_1);

        assertResolverReceived(resolverPublish(NAME, V2_0_0, ADDR_2));
        // Upgrade: from = the latest key before this publish.
        assertEq(ShimDouble(payable(shimOf(NAME))).lastCall(), initCalldata(INIT_1, V1_0_0, ALICE));
        assertEq(registry.getLatestKey(NAME), V2_0_0);
    }

    function test_publish_with_init_rejects_zero_init_target() public {
        deployed(ALICE);
        vm.expectRevert(Registry.InvalidInitTarget.selector);
        registry.publishWithInit(NAME, V1_0_0, ADDR_1, URI_1, address(0));
        assertEq(registry.getContractCount(), 0);
    }

    function test_publish_with_init_enforces_publish_rules() public {
        deployed(ALICE);
        resolverAcceptsEveryPublish();
        registry.publish(NAME, V1_1_0, ADDR_1, URI_1);

        // Same monotonic gate as plain publish.
        vm.expectRevert(abi.encodeWithSelector(Registry.VersionNotMonotonic.selector, V1_0_0, V1_1_0));
        registry.publishWithInit(NAME, V1_0_0, ADDR_2, URI_2, INIT_1);

        // Same ownership gate.
        vm.startPrank(BOB);
        vm.expectRevert(Registry.Unauthorized.selector);
        registry.publishWithInit(NAME, V2_0_0, ADDR_2, URI_2, INIT_1);
    }

    // ─── setMinSupported ─────────────────────────────────────────────────────

    function test_set_min_supported_forwards_to_the_resolver_and_emits() public {
        deployed(ALICE);
        registry.publish(NAME, V1_0_0, ADDR_1, URI_1);
        registry.publish(NAME, V1_1_0, ADDR_2, URI_2);
        resolver.take();
        vm.recordLogs();

        registry.setMinSupported(NAME, V1_1_0);

        assertResolverReceived(resolverCalldata("setMinSupported(address,uint128)", abi.encode(shimOf(NAME), V1_1_0)));
        assertLog(
            lastLog(), topics(topic0("MinSupportedSet(string,uint128)"), keccak256(bytes(NAME))), abi.encode(V1_1_0)
        );
    }

    function test_set_min_supported_requires_owner() public {
        deployed(ALICE);
        registry.publish(NAME, V1_0_0, ADDR_1, URI_1);

        // Not the owner (also covers unregistered names, which have no owner).
        vm.startPrank(BOB);
        vm.expectRevert(Registry.Unauthorized.selector);
        registry.setMinSupported(NAME, V1_0_0);
        vm.expectRevert(Registry.Unauthorized.selector);
        registry.setMinSupported("@cdm/missing", V1_0_0);
    }

    function test_freeze_contract_forwards_and_requires_owner() public {
        deployed(ALICE);
        registry.publish(NAME, V1_0_0, ADDR_1, URI_1);
        resolver.take();

        registry.freezeContract(NAME);
        registry.unfreezeContract(NAME);
        assertResolverReceived(
            resolverCalldata("setFrozen(address,bool)", abi.encode(shimOf(NAME), true)),
            resolverCalldata("setFrozen(address,bool)", abi.encode(shimOf(NAME), false))
        );

        vm.startPrank(BOB);
        vm.expectRevert(Registry.Unauthorized.selector);
        registry.freezeContract(NAME);
        vm.expectRevert(Registry.Unauthorized.selector);
        registry.unfreezeContract("@cdm/missing");
    }

    // ─── setFastPath / sealContract ──────────────────────────────────────────

    function test_set_fast_path_forwards_to_the_resolver_and_emits() public {
        deployed(ALICE);
        registry.publish(NAME, V1_0_0, ADDR_1, URI_1);
        resolver.take();
        vm.recordLogs();

        registry.setFastPath(NAME, false);

        assertResolverReceived(resolverCalldata("setFastPath(address,bool)", abi.encode(shimOf(NAME), false)));
        assertLog(lastLog(), topics(topic0("FastPathSet(string,bool)"), keccak256(bytes(NAME))), abi.encode(false));
    }

    function test_seal_contract_forwards_to_the_resolver_and_emits() public {
        deployed(ALICE);
        registry.publish(NAME, V1_0_0, ADDR_1, URI_1);
        resolver.take();
        vm.recordLogs();

        registry.sealContract(NAME);

        assertResolverReceived(resolverCalldata("seal(address)", abi.encode(shimOf(NAME))));
        assertLog(lastLog(), topics(topic0("ContractSealed(string)"), keccak256(bytes(NAME))), "");
    }

    function test_set_fast_path_and_seal_contract_require_owner() public {
        deployed(ALICE);
        registry.publish(NAME, V1_0_0, ADDR_1, URI_1);

        // Not the owner (also covers unregistered names, which have no owner).
        vm.startPrank(BOB);
        vm.expectRevert(Registry.Unauthorized.selector);
        registry.setFastPath(NAME, false);
        vm.expectRevert(Registry.Unauthorized.selector);
        registry.setFastPath("@cdm/missing", false);
        vm.expectRevert(Registry.Unauthorized.selector);
        registry.sealContract(NAME);
        vm.expectRevert(Registry.Unauthorized.selector);
        registry.sealContract("@cdm/missing");
    }

    function test_set_fast_path_and_seal_contract_stop_while_the_registry_is_frozen() public {
        // The admin is exempt from the freeze, so the name gets another owner.
        deployed(ADMIN);
        vm.startPrank(ALICE);
        registry.publish(NAME, V1_0_0, ADDR_1, URI_1);
        vm.startPrank(ADMIN);
        registry.freeze();

        vm.startPrank(ALICE);
        vm.expectRevert(Registry.ContractFrozen.selector);
        registry.setFastPath(NAME, false);
        vm.expectRevert(Registry.ContractFrozen.selector);
        registry.sealContract(NAME);
    }

    // ─── Queries on unregistered names ───────────────────────────────────────

    function test_unregistered_name_queries_return_defaults() public {
        deployed(ALICE);

        assertNone(registry.getAddress(NAME));
        assertNone(registry.getMetadataUri(NAME));
        assertNone(registry.getProxy(NAME));
        assertEq(registry.getLatestKey(NAME), 0);
        assertFalse(registry.getVersionAt(NAME, 0).isSome);
        assertEq(registry.getOwner(NAME), address(0));
        assertEq(registry.getVersionCount(NAME), 0);
        assertEq(registry.getContractCount(), 0);
        assertEq(registry.getContractNameAt(0), "");
        assertPage(registry.getContracts(0, 10), 0, list());
    }

    // ─── getContracts paging ─────────────────────────────────────────────────

    function test_get_contracts_pages_latest_entries_by_registration_order() public {
        deployed(ALICE);
        uint128 v0_0_1 = 1;
        uint128 v0_0_2 = 2;
        registry.publish("@cdm/alpha", v0_0_1, ADDR_1, "ipfs://alpha");
        registry.publish("@cdm/beta", v0_0_1, ADDR_1, "ipfs://beta-v0");
        registry.publish("@cdm/beta", v0_0_2, ADDR_2, "ipfs://beta-v1");
        registry.publish("@cdm/gamma", V1_0_0, ADDR_2, "ipfs://gamma");

        // Every entry resolves to its own shim.
        Registry.ContractEntry memory alpha =
            Registry.ContractEntry("@cdm/alpha", v0_0_1, shimOf("@cdm/alpha"), "ipfs://alpha", ALICE);
        Registry.ContractEntry memory beta =
            Registry.ContractEntry("@cdm/beta", v0_0_2, shimOf("@cdm/beta"), "ipfs://beta-v1", ALICE);
        Registry.ContractEntry memory gamma =
            Registry.ContractEntry("@cdm/gamma", V1_0_0, shimOf("@cdm/gamma"), "ipfs://gamma", ALICE);

        // Full page: every entry carries its latest version.
        assertPage(registry.getContracts(0, 10), 3, list(alpha, beta, gamma));
        // Partial pages.
        assertPage(registry.getContracts(0, 2), 3, list(alpha, beta));
        assertPage(registry.getContracts(1, 1), 3, list(beta));
        assertPage(registry.getContracts(2, 10), 3, list(gamma));
        // Start beyond the total: empty, total still reported.
        assertPage(registry.getContracts(3, 5), 3, list());
        assertPage(registry.getContracts(type(uint32).max, 5), 3, list());
        // Zero count: empty.
        assertPage(registry.getContracts(0, 0), 3, list());
    }

    function test_get_contracts_clamps_count_to_max_page_limit() public {
        deployed(ADMIN);
        for (uint256 i = 0; i < 101; i++) {
            registry.publish(string.concat("@scope/pkg", vm.toString(i)), V1_0_0, ADDR_1, URI_1);
        }

        // A count above the page limit clamps to 100 entries; total is unaffected.
        Registry.ContractPage memory head = registry.getContracts(0, 200);
        assertEq(head.total, 101);
        assertEq(head.entries.length, 100);
        assertEq(head.entries[0].name, "@scope/pkg0");
        assertEq(head.entries[99].name, "@scope/pkg99");

        Registry.ContractPage memory tail = registry.getContracts(100, 200);
        assertEq(tail.total, 101);
        assertEq(tail.entries.length, 1);
        assertEq(tail.entries[0].name, "@scope/pkg100");
    }

    // ─── setAdmin ────────────────────────────────────────────────────────────

    function test_set_admin_transfers_admin_rights() public {
        deployed(ADMIN);
        vm.recordLogs();

        registry.setAdmin(BOB);
        assertEq(registry.getAdmin(), BOB);
        Vm.Log[] memory logs = vm.getRecordedLogs();
        assertEq(logs.length, 1);
        assertLog(logs[0], topics(topic0("AdminChanged(address,address)")), abi.encode(ADMIN, BOB));

        // The old admin is just a regular account now.
        vm.expectRevert(Registry.UnauthorizedAdmin.selector);
        registry.freeze();
        vm.expectRevert(Registry.UnauthorizedAdmin.selector);
        registry.setAdmin(ADMIN);

        // The new admin holds the permissions.
        vm.startPrank(BOB);
        registry.freeze();
    }

    function test_set_admin_rejects_non_admin() public {
        deployed(ADMIN);
        vm.startPrank(ALICE);

        vm.expectRevert(Registry.UnauthorizedAdmin.selector);
        registry.setAdmin(ALICE);
        assertEq(registry.getAdmin(), ADMIN);
    }

    // ─── freeze / unfreeze ───────────────────────────────────────────────────

    function test_freeze_and_unfreeze_require_admin() public {
        deployed(ADMIN);
        vm.startPrank(ALICE);

        vm.expectRevert(Registry.UnauthorizedAdmin.selector);
        registry.freeze();
        vm.expectRevert(Registry.UnauthorizedAdmin.selector);
        registry.unfreeze();
        assertFalse(registry.isFrozen());
    }

    function test_freeze_blocks_non_admin_mutations_but_not_reads() public {
        deployed(ADMIN);
        registry.publish(NAME, V1_0_0, ADDR_1, URI_1);

        registry.freeze();
        assertTrue(registry.isFrozen());

        vm.startPrank(ALICE);
        assertTrue(registry.isFrozen());
        vm.expectRevert(Registry.ContractFrozen.selector);
        registry.publish("@cdm/alice", V1_0_0, ADDR_2, URI_2);

        // Reads keep working while frozen.
        assertSome(registry.getAddress(NAME), shimOf(NAME));
        assertSome(registry.getMetadataUri(NAME), URI_1);
        assertEq(registry.getContractCount(), 1);
    }

    function test_frozen_admin_is_exempt() public {
        deployed(ADMIN);
        registry.freeze();

        registry.publish(NAME, V1_0_0, ADDR_1, URI_1);
        assertEq(registry.getContractCount(), 1);
    }

    function test_unfreeze_restores_publishing() public {
        deployed(ADMIN);
        vm.recordLogs();
        registry.freeze();
        registry.unfreeze();
        assertFalse(registry.isFrozen());

        Vm.Log[] memory logs = vm.getRecordedLogs();
        assertEq(logs.length, 2);
        assertLog(logs[0], topics(topic0("FrozenSet(bool)")), abi.encode(true));
        assertLog(logs[1], topics(topic0("FrozenSet(bool)")), abi.encode(false));

        vm.startPrank(ALICE);
        registry.publish(NAME, V1_0_0, ADDR_1, URI_1);
    }

    // ─── setCode ─────────────────────────────────────────────────────────────

    function test_set_code_updates_implementation_and_emits_upgraded() public {
        deployed(ADMIN);
        vm.recordLogs();

        registry.setCode(NEW_IMPL);
        assertEq(registry.getCode(), NEW_IMPL);
        Vm.Log[] memory logs = vm.getRecordedLogs();
        assertEq(logs.length, 1);
        assertLog(logs[0], topics(topic0("Upgraded(address)"), bytes32(uint256(uint160(NEW_IMPL)))), "");
    }

    function test_set_code_rejects_non_admin() public {
        deployed(ADMIN);
        vm.startPrank(ALICE);

        vm.expectRevert(Registry.UnauthorizedAdmin.selector);
        registry.setCode(NEW_IMPL);
        assertEq(registry.getCode(), address(0));
    }

    function test_proxy_code_hash_is_the_frozen_shim_blob() public {
        deployed(ADMIN);
        bytes memory blob = vm.readFileBinary("../proxy/artifacts/contract-proxy.polkavm");
        assertEq(registry.getProxyCodeHash(), keccak256(blob));
    }

    // ─── Resolver ────────────────────────────────────────────────────────────

    function test_set_resolver_is_admin_only_non_zero_and_write_once() public {
        deployedWithoutResolver(ADMIN);
        assertEq(registry.getResolver(), address(0));

        vm.startPrank(ALICE);
        vm.expectRevert(Registry.UnauthorizedAdmin.selector);
        registry.setResolver(address(resolver));
        vm.startPrank(ADMIN);
        vm.expectRevert(Registry.InvalidResolver.selector);
        registry.setResolver(address(0));

        registry.setResolver(address(resolver));
        assertEq(registry.getResolver(), address(resolver));
        vm.expectRevert(Registry.ResolverAlreadySet.selector);
        registry.setResolver(ADDR_1);
    }

    function test_upgrade_resolver_forwards_set_code_to_the_resolver() public {
        deployed(ADMIN);
        registry.upgradeResolver(NEW_IMPL);
        assertResolverReceived(resolverCalldata("setCode(address)", abi.encode(NEW_IMPL)));

        vm.startPrank(ALICE);
        vm.expectRevert(Registry.UnauthorizedAdmin.selector);
        registry.upgradeResolver(NEW_IMPL);

        deployedWithoutResolver(ADMIN);
        vm.expectRevert(Registry.ResolverUnset.selector);
        registry.upgradeResolver(NEW_IMPL);
    }

    // ─── Events ──────────────────────────────────────────────────────────────

    function test_publish_emits_events_per_version() public {
        deployed(ALICE);
        vm.recordLogs();
        registry.publish(NAME, V1_0_0, ADDR_1, URI_1);
        registry.publish(NAME, V1_1_0, ADDR_2, URI_2);

        // Indexed string: the topic carries keccak256 of the name bytes.
        bytes32 nameTopic = keccak256(bytes(NAME));
        Vm.Log[] memory logs = vm.getRecordedLogs();
        assertEq(logs.length, 3);
        assertLog(logs[0], topics(topic0("ProxyCreated(string,address)"), nameTopic), abi.encode(shimOf(NAME)));
        assertLog(logs[1], topics(topic0("Published(string,uint128,address)"), nameTopic), abi.encode(V1_0_0, ADDR_1));
        assertLog(logs[2], topics(topic0("Published(string,uint128,address)"), nameTopic), abi.encode(V1_1_0, ADDR_2));
    }

    // ─── Dispatch-level ABI lock ─────────────────────────────────────────────
    //
    // `pvm-cdm-macros` bakes the `getAddress(string)` selector into consumer
    // contracts and reads exactly 64 bytes back: bool at byte 31, address at
    // bytes 44..64.

    /// `getAddress(string)` calldata exactly as `cdm_lookup` emits it.
    function cdmLookupCalldata(string memory name) private pure returns (bytes memory) {
        uint256 length = bytes(name).length;
        return abi.encodePacked(hex"bf40fac1", word(32), word(length), name, new bytes((32 - length % 32) % 32));
    }

    function test_get_address_wire_format_matches_cdm_lookup_consumer() public {
        deployed(ALICE);
        registry.publish(NAME, V1_0_0, ADDR_1, URI_1);

        (bool ok, bytes memory data) = address(registry).staticcall(cdmLookupCalldata(NAME));
        assertTrue(ok);
        // word0: bool isSome, word1: the stable shim address.
        assertEq(data, bytes.concat(word(1), word(uint160(shimOf(NAME)))));
    }

    function test_get_address_wire_format_for_missing_name_is_all_zero() public {
        deployed(ALICE);

        (bool ok, bytes memory data) = address(registry).staticcall(cdmLookupCalldata("@cdm/missing"));
        assertTrue(ok);
        assertEq(data, new bytes(64));
    }

    // Multi-value returns are one tuple output (a leading offset word for
    // dynamic returns). Every deployed registry and released CLI decodes this
    // layout.
    function test_get_metadata_uri_wire_format_matches_legacy_tuple_encoding() public {
        deployed(ALICE);
        registry.publish(NAME, V1_0_0, ADDR_1, URI_1);

        (bool ok, bytes memory data) = address(registry)
            .staticcall(abi.encodePacked(bytes4(keccak256("getMetadataUri(string)")), abi.encode(NAME)));
        assertTrue(ok);
        assertEq(
            data,
            bytes.concat(
                word(0x20), // offset of the single tuple output
                word(1), // isSome
                word(0x40), // offset of `value` within the tuple
                word(bytes(URI_1).length),
                bytes32(bytes(URI_1))
            )
        );
    }

    function test_get_metadata_uri_wire_format_for_missing_name() public {
        deployed(ALICE);

        (bool ok, bytes memory data) = address(registry)
            .staticcall(abi.encodePacked(bytes4(keccak256("getMetadataUri(string)")), abi.encode(NAME)));
        assertTrue(ok);
        assertEq(
            data,
            bytes.concat(
                word(0x20),
                word(0),
                word(0x40),
                word(0) // empty string
            )
        );
    }

    function test_get_contracts_wire_format_matches_legacy_tuple_encoding() public {
        deployed(ALICE);

        (bool ok, bytes memory data) = address(registry)
            .staticcall(
                abi.encodePacked(bytes4(keccak256("getContracts(uint32,uint32)")), abi.encode(uint32(0), uint32(10)))
            );
        assertTrue(ok);
        assertEq(
            data,
            bytes.concat(
                word(0x20), // offset of the single tuple output
                word(0), // total
                word(0x40), // offset of `entries` within the tuple
                word(0) // empty entries array
            )
        );
    }

    struct Case {
        string signature;
        bytes input;
    }

    function test_every_abi_selector_dispatches() public {
        deployedWithoutResolver(ADMIN);

        Case[28] memory cases = [
            Case("setResolver(address)", abi.encode(address(resolver))),
            Case("publish(string,uint128,address,string)", abi.encode(NAME, V1_0_0, ADDR_1, URI_1)),
            // V2_0_0: must stay monotonic after the publish case above.
            Case(
                "publishWithInit(string,uint128,address,string,address)",
                abi.encode(NAME, V2_0_0, ADDR_2, URI_2, INIT_1)
            ),
            Case("setMinSupported(string,uint128)", abi.encode(NAME, V1_0_0)),
            Case("freezeContract(string)", abi.encode(NAME)),
            Case("unfreezeContract(string)", abi.encode(NAME)),
            Case("setFastPath(string,bool)", abi.encode(NAME, true)),
            Case("sealContract(string)", abi.encode(NAME)),
            Case("getAddress(string)", abi.encode(NAME)),
            Case("getMetadataUri(string)", abi.encode(NAME)),
            Case("getProxy(string)", abi.encode(NAME)),
            Case("getLatestKey(string)", abi.encode(NAME)),
            Case("getResolver()", ""),
            Case("upgradeResolver(address)", abi.encode(NEW_IMPL)),
            Case("getVersionAt(string,uint32)", abi.encode(NAME, uint32(0))),
            Case("getOwner(string)", abi.encode(NAME)),
            Case("getVersionCount(string)", abi.encode(NAME)),
            Case("getContractNameAt(uint32)", abi.encode(uint32(0))),
            Case("getContracts(uint32,uint32)", abi.encode(uint32(0), uint32(10))),
            Case("getContractCount()", ""),
            Case("getAdmin()", ""),
            Case("getCode()", ""),
            Case("getProxyCodeHash()", ""),
            Case("isFrozen()", ""),
            Case("setAdmin(address)", abi.encode(ADMIN)),
            Case("setCode(address)", abi.encode(NEW_IMPL)),
            Case("freeze()", ""),
            Case("unfreeze()", "")
        ];

        for (uint256 i = 0; i < cases.length; i++) {
            (bool ok,) =
                address(registry).call(abi.encodePacked(bytes4(keccak256(bytes(cases[i].signature))), cases[i].input));
            assertTrue(ok);
        }

        // Control: an unknown selector reaches no method.
        (bool handled, bytes memory data) = address(registry).call(hex"deadbeef");
        assertFalse(handled);
        assertEq(data, "");
    }
}
