// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.34;

import {Resolver} from "../src/Resolver.sol";
import {ShimDouble} from "./Doubles.sol";
import {Test} from "./Test.sol";

/// The resolver as the registry and a shim drive it: the routing policy behind
/// `resolve`, the registry-only mutations, and the calls they send the shim.
/// Requests, answers and shim calls are compared as raw bytes built from the
/// constants below: the shim that speaks this format can never change.
contract ResolverTest is Test {
    /// The registry: admin of the resolver.
    address private constant REGISTRY = 0x9E9e9e9e9e9E9E9e9E9e9E9E9E9e9E9E9E9e9e9e;
    address private constant STRANGER = 0x5757575757575757575757575757575757575757;
    address private constant OTHER_SHIM = 0x5B5B5b5B5b5B5B5b5B5B5b5b5B5B5B5b5B5B5b5b;
    address private constant IMPL_1 = 0x1111111111111111111111111111111111111111;
    address private constant IMPL_2 = 0x2222222222222222222222222222222222222222;
    address private constant INIT_1 = 0x4444444444444444444444444444444444444444;

    /// Version keys pack `major << 64 | minor << 32 | patch`.
    uint128 private constant V0_1_0 = uint128(1) << 32;
    uint128 private constant V1_0_0 = uint128(1) << 64;
    uint128 private constant V1_2_3 = (uint128(1) << 64) | (uint128(2) << 32) | 3;
    uint128 private constant V2_0_0 = uint128(2) << 64;

    /// First four bytes of a versioned or meta call.
    bytes4 private constant MAGIC = 0xa2264d53;
    /// `[MAGIC][16-byte version key]`, the header of a versioned call.
    uint256 private constant VERSIONED_HEADER_LEN = 20;
    /// `[MAGIC][key 0][meta selector]`, the header of a meta call.
    uint256 private constant META_HEADER_LEN = 24;
    /// `resolve(address,uint256,bytes)`.
    bytes4 private constant RESOLVE = 0x6a418533;

    /// Meta selectors the resolver serves.
    bytes4 private constant CALL_CODE = 0xd74c1f04;
    bytes4 private constant FROZEN = 0x054f7d9c;
    bytes4 private constant IMPL_OF = 0xdf379e50;
    bytes4 private constant LATEST = 0x52bfe789;
    bytes4 private constant MIN_SUPPORTED = 0x900fc468;
    bytes4 private constant ADMIN = 0xf851a440;

    /// Meta selectors the shim answers for the resolver.
    bytes4 private constant SHIM_SET_FAST_PATH = 0x8682471f;
    bytes4 private constant SHIM_SEAL = 0xe2e33028;

    bytes private constant PLAIN = hex"777777777777777777777777777777777777777777777777777777777777777777777777";

    Resolver private resolver;
    address private shim;

    function setUp() public {
        vm.prank(REGISTRY);
        resolver = new Resolver();
        shim = address(new ShimDouble(address(resolver)));
    }

    // ─── Driving the resolver ────────────────────────────────────────────

    /// The resolver, with its next call coming from the registry.
    function asRegistry() private returns (Resolver) {
        vm.prank(REGISTRY);
        return resolver;
    }

    /// Publishes a version of the name behind `shim`.
    function publish(uint128 key, address implementation) private {
        asRegistry().publish(shim, key, implementation);
    }

    /// `resolve` exactly as a shim issues it: the resolver's own caller is
    /// `from`, `caller` is whoever called that shim. The outcome is whether
    /// the call succeeded, with the bytes it returned or reverted with.
    function resolveAs(address from, address caller, bytes memory data) private returns (bytes memory) {
        vm.prank(from);
        (bool ok, bytes memory out) =
            address(resolver).staticcall(abi.encodeWithSelector(RESOLVE, caller, uint256(0), data));
        return abi.encode(ok, out);
    }

    /// `resolve` as the shim issues it for a stranger's call.
    function resolveFor(bytes memory data) private returns (bytes memory) {
        return resolveAs(shim, STRANGER, data);
    }

    /// The outcome of a `resolve` that returned `response`.
    function returned(bytes memory response) private pure returns (bytes memory) {
        return abi.encode(true, response);
    }

    /// The outcome of a `resolve` that reverted with `reason`.
    function reverted(bytes memory reason) private pure returns (bytes memory) {
        return abi.encode(false, reason);
    }

    function reverted(bytes4 selector) private pure returns (bytes memory) {
        return reverted(bytes.concat(selector));
    }

    /// The answer telling a shim to delegate-call `target` with the call's
    /// bytes from `strip` on: `[offset 0x20][kind 1][target][strip]
    /// [offset 0x80][payload length 0]`.
    function delegate(address target, uint256 strip) private pure returns (bytes memory) {
        return returned(abi.encode(uint256(0x20), uint256(1), target, strip, uint256(0x80), uint256(0)));
    }

    /// The answer telling a shim to return `payload`: `[offset 0x20][kind 0]
    /// [target 0][strip 0][offset 0x80][payload length]`, then the payload,
    /// which is whole words and so takes no padding.
    function answer(bytes memory payload) private pure returns (bytes memory) {
        return returned(
            bytes.concat(
                abi.encode(uint256(0x20), uint256(0), uint256(0), uint256(0), uint256(0x80), payload.length), payload
            )
        );
    }

    // ─── Wire helpers ────────────────────────────────────────────────────

    /// `[MAGIC][version key][inner calldata]`.
    function versioned(uint128 key, bytes memory inner) private pure returns (bytes memory) {
        return abi.encodePacked(MAGIC, key, inner);
    }

    /// `[MAGIC][key 0][meta selector][ABI args]`.
    function meta(bytes4 selector, bytes memory args) private pure returns (bytes memory) {
        return abi.encodePacked(MAGIC, uint128(0), selector, args);
    }

    /// The exact call that stores `(key, implementation)` in the shim's
    /// fast-path slot.
    function shimSetFastPath(uint128 key, address implementation) private pure returns (bytes memory) {
        return meta(SHIM_SET_FAST_PATH, abi.encode(key, implementation));
    }

    /// The exact call that empties the shim's fast-path slot.
    function shimClearFastPath() private pure returns (bytes memory) {
        return shimSetFastPath(0, address(0));
    }

    /// The exact call that seals the shim on `(key, implementation)`.
    function shimSeal(uint128 key, address implementation) private pure returns (bytes memory) {
        return meta(SHIM_SEAL, abi.encode(key, implementation));
    }

    /// The last call the shim received, which decides what its slot holds.
    function shimReceived() private view returns (bytes memory) {
        return ShimDouble(payable(shim)).lastCall();
    }

    /// How many of the resolver slots written since `vm.record()` hold a
    /// value: a slot holding zero is not a storage item.
    function storageItems() private returns (uint256 count) {
        (, bytes32[] memory writes) = vm.accesses(address(resolver));
        for (uint256 i = 0; i < writes.length; i++) {
            bool repeated;
            for (uint256 j = 0; j < i; j++) {
                if (writes[j] == writes[i]) repeated = true;
            }
            if (!repeated && vm.load(address(resolver), writes[i]) != 0) count++;
        }
    }

    // ─── Plain calls ─────────────────────────────────────────────────────

    function test_plain_call_delegates_to_latest_with_nothing_stripped() public {
        publish(V1_0_0, IMPL_1);
        publish(V1_2_3, IMPL_2);
        assertEq(resolveFor(PLAIN), delegate(IMPL_2, 0));
        // Empty calldata is a plain call too.
        assertEq(resolveFor(""), delegate(IMPL_2, 0));
    }

    function test_plain_call_before_first_publish_reverts_no_versions() public {
        assertEq(resolveFor(PLAIN), reverted(Resolver.NoVersions.selector));
    }

    function test_routing_is_per_shim() public {
        publish(V1_0_0, IMPL_1);
        assertEq(resolveAs(OTHER_SHIM, STRANGER, PLAIN), reverted(Resolver.NoVersions.selector));
    }

    // ─── Versioned calls ─────────────────────────────────────────────────

    function test_versioned_call_delegates_to_that_version_past_the_header() public {
        publish(V1_0_0, IMPL_1);
        publish(V1_2_3, IMPL_2);
        publish(V2_0_0, INIT_1);
        assertEq(resolveFor(versioned(V1_2_3, hex"01010101")), delegate(IMPL_2, VERSIONED_HEADER_LEN));
    }

    function test_versioned_call_unknown_key_reverts() public {
        publish(V1_0_0, IMPL_1);
        assertEq(resolveFor(versioned(V1_2_3, hex"01")), reverted(Resolver.UnknownVersion.selector));
    }

    function test_versioned_call_below_min_supported_reverts() public {
        publish(V1_0_0, IMPL_1);
        publish(V1_2_3, IMPL_2);
        asRegistry().setMinSupported(shim, V1_2_3);

        assertEq(
            resolveFor(versioned(V1_0_0, hex"01")),
            reverted(abi.encodeWithSelector(Resolver.UnsupportedVersion.selector, V1_0_0, V1_2_3))
        );
        assertEq(resolveFor(versioned(V1_2_3, hex"01")), delegate(IMPL_2, VERSIONED_HEADER_LEN));
    }

    // ─── Publish rules ───────────────────────────────────────────────────

    function test_publish_records_the_version_and_updates_latest() public {
        publish(V1_0_0, IMPL_1);
        publish(V1_2_3, IMPL_2);
        assertEq(
            abi.encode(resolver.routingOf(shim)),
            abi.encode(
                Resolver.Routing({
                    latestKey: V1_2_3,
                    minSupported: 0,
                    latestImpl: IMPL_2,
                    frozen: false,
                    fastPathOff: false,
                    isSealed: false
                })
            )
        );
        assertEq(resolver.implOf(shim, V1_0_0), IMPL_1);
        assertEq(resolver.implOf(shim, V2_0_0), address(0));
    }

    function test_publish_requires_strictly_increasing_keys() public {
        publish(V1_0_0, IMPL_1);
        uint128[2] memory keys = [V1_0_0, V0_1_0];
        for (uint256 i = 0; i < keys.length; i++) {
            vm.expectRevert(abi.encodeWithSelector(Resolver.VersionNotMonotonic.selector, keys[i], V1_0_0));
            asRegistry().publish(shim, keys[i], IMPL_2);
        }
    }

    function test_publish_rejects_invalid_keys_and_zero_impl() public {
        uint128[3] memory keys = [uint128(0), uint128(1) << 95, uint128(1) << 96];
        for (uint256 i = 0; i < keys.length; i++) {
            vm.expectRevert(Resolver.InvalidVersionKey.selector);
            asRegistry().publish(shim, keys[i], IMPL_1);
        }
        vm.expectRevert(Resolver.InvalidImplementation.selector);
        asRegistry().publish(shim, V1_0_0, address(0));
    }

    function test_mutations_require_the_registry() public {
        publish(V1_0_0, IMPL_1);
        vm.startPrank(STRANGER);
        vm.expectRevert(Resolver.UnauthorizedAdmin.selector);
        resolver.publish(shim, V2_0_0, IMPL_2);
        vm.expectRevert(Resolver.UnauthorizedAdmin.selector);
        resolver.setMinSupported(shim, V1_0_0);
        vm.expectRevert(Resolver.UnauthorizedAdmin.selector);
        resolver.setFrozen(shim, true);
        vm.expectRevert(Resolver.UnauthorizedAdmin.selector);
        resolver.setFastPath(shim, false);
        vm.expectRevert(Resolver.UnauthorizedAdmin.selector);
        resolver.seal(shim);
        vm.expectRevert(Resolver.UnauthorizedAdmin.selector);
        resolver.setCode(IMPL_2);
    }

    // ─── Min-supported ratchet ───────────────────────────────────────────

    function test_min_supported_only_ratchets_up_and_stays_at_or_below_latest() public {
        publish(V1_0_0, IMPL_1);
        publish(V1_2_3, IMPL_2);

        asRegistry().setMinSupported(shim, V1_2_3);
        assertEq(resolver.routingOf(shim).minSupported, V1_2_3);

        vm.expectRevert(abi.encodeWithSelector(Resolver.MinNotMonotonic.selector, V1_0_0, V1_2_3));
        asRegistry().setMinSupported(shim, V1_0_0);
        vm.expectRevert(abi.encodeWithSelector(Resolver.MinAboveLatest.selector, V2_0_0, V1_2_3));
        asRegistry().setMinSupported(shim, V2_0_0);
        vm.expectRevert(Resolver.NoVersions.selector);
        asRegistry().setMinSupported(OTHER_SHIM, V1_0_0);
    }

    // ─── Freeze ──────────────────────────────────────────────────────────

    function test_freeze_blocks_delegation_but_not_the_meta_plane() public {
        publish(V1_0_0, IMPL_1);
        publish(V1_2_3, IMPL_2);
        asRegistry().setFrozen(shim, true);

        assertEq(resolveFor(PLAIN), reverted(Resolver.ContractFrozen.selector));
        assertEq(resolveFor(versioned(V1_0_0, hex"01")), reverted(Resolver.ContractFrozen.selector));
        assertEq(resolveFor(meta(FROZEN, "")), answer(abi.encode(true)));

        // Publish still works while frozen; delegation resumes afterwards.
        publish(V2_0_0, INIT_1);
        asRegistry().setFrozen(shim, false);
        assertEq(resolveFor(PLAIN), delegate(INIT_1, 0));
    }

    // ─── Fast path ───────────────────────────────────────────────────────

    function test_publish_pushes_the_version_to_the_shim() public {
        publish(V1_0_0, IMPL_1);
        assertEq(shimReceived(), shimSetFastPath(V1_0_0, IMPL_1));

        publish(V1_2_3, IMPL_2);
        assertEq(shimReceived(), shimSetFastPath(V1_2_3, IMPL_2));
    }

    function test_freeze_empties_the_shim_and_unfreeze_restores_the_latest() public {
        publish(V1_0_0, IMPL_1);

        asRegistry().setFrozen(shim, true);
        assertEq(shimReceived(), shimClearFastPath());

        // A publish while frozen leaves the shim's slot empty.
        publish(V1_2_3, IMPL_2);
        assertEq(shimReceived(), shimClearFastPath());

        asRegistry().setFrozen(shim, false);
        assertEq(shimReceived(), shimSetFastPath(V1_2_3, IMPL_2));
    }

    function test_flag_changes_on_a_published_name_keep_the_same_storage_items() public {
        vm.record();
        publish(V1_0_0, IMPL_1);
        uint256 items = storageItems();

        asRegistry().setFrozen(shim, true);
        assertEq(storageItems(), items);
        asRegistry().setFrozen(shim, false);
        assertEq(storageItems(), items);
        asRegistry().setFastPath(shim, false);
        assertEq(storageItems(), items);
        asRegistry().setFastPath(shim, true);
        assertEq(storageItems(), items);
    }

    function test_fast_path_opt_out_survives_a_publish_and_a_freeze_cycle() public {
        publish(V1_0_0, IMPL_1);

        asRegistry().setFastPath(shim, false);
        assertTrue(resolver.routingOf(shim).fastPathOff);
        assertEq(shimReceived(), shimClearFastPath());

        publish(V1_2_3, IMPL_2);
        assertEq(shimReceived(), shimClearFastPath());

        asRegistry().setFrozen(shim, true);
        assertEq(shimReceived(), shimClearFastPath());
        asRegistry().setFrozen(shim, false);
        assertEq(shimReceived(), shimClearFastPath());

        // Opting back in hands the shim whatever is latest by then.
        asRegistry().setFastPath(shim, true);
        assertFalse(resolver.routingOf(shim).fastPathOff);
        assertEq(shimReceived(), shimSetFastPath(V1_2_3, IMPL_2));
    }

    function test_enabling_the_fast_path_while_frozen_waits_for_the_unfreeze() public {
        publish(V1_0_0, IMPL_1);
        asRegistry().setFastPath(shim, false);
        asRegistry().setFrozen(shim, true);

        asRegistry().setFastPath(shim, true);
        assertEq(shimReceived(), shimClearFastPath());

        asRegistry().setFrozen(shim, false);
        assertEq(shimReceived(), shimSetFastPath(V1_0_0, IMPL_1));
    }

    function test_shim_revert_bubbles_out_of_the_mutation() public {
        bytes memory reason = hex"c0ffee";
        ShimDouble(payable(shim)).revertWith(reason);
        vm.expectRevert(reason);
        asRegistry().publish(shim, V1_0_0, IMPL_1);
    }

    // ─── Seal ────────────────────────────────────────────────────────────

    function test_seal_pins_the_shim_to_the_latest_version() public {
        publish(V1_0_0, IMPL_1);
        publish(V1_2_3, IMPL_2);

        asRegistry().seal(shim);
        assertTrue(resolver.routingOf(shim).isSealed);
        assertEq(shimReceived(), shimSeal(V1_2_3, IMPL_2));
    }

    function test_seal_reaches_a_shim_whose_fast_path_is_off() public {
        publish(V1_0_0, IMPL_1);
        asRegistry().setFastPath(shim, false);

        asRegistry().seal(shim);
        assertEq(shimReceived(), shimSeal(V1_0_0, IMPL_1));
    }

    function test_seal_needs_an_unfrozen_name_with_a_version() public {
        publish(V1_0_0, IMPL_1);
        vm.expectRevert(Resolver.NoVersions.selector);
        asRegistry().seal(OTHER_SHIM);

        asRegistry().setFrozen(shim, true);
        vm.expectRevert(Resolver.ContractFrozen.selector);
        asRegistry().seal(shim);
    }

    function test_sealed_name_takes_no_further_mutations() public {
        publish(V1_0_0, IMPL_1);
        publish(V1_2_3, IMPL_2);
        asRegistry().seal(shim);

        vm.expectRevert(Resolver.NameSealed.selector);
        asRegistry().publish(shim, V2_0_0, INIT_1);
        vm.expectRevert(Resolver.NameSealed.selector);
        asRegistry().setMinSupported(shim, V1_2_3);
        vm.expectRevert(Resolver.NameSealed.selector);
        asRegistry().setFrozen(shim, true);
        vm.expectRevert(Resolver.NameSealed.selector);
        asRegistry().setFastPath(shim, false);
        vm.expectRevert(Resolver.NameSealed.selector);
        asRegistry().seal(shim);
    }

    // ─── Meta queries ────────────────────────────────────────────────────

    function test_meta_queries_answer_with_abi_words() public {
        publish(V1_0_0, IMPL_1);
        publish(V1_2_3, IMPL_2);

        assertEq(resolveFor(meta(IMPL_OF, abi.encode(V1_0_0))), answer(abi.encode(IMPL_1)));
        assertEq(resolveFor(meta(IMPL_OF, abi.encode(V2_0_0))), answer(abi.encode(address(0))));
        assertEq(resolveFor(meta(LATEST, "")), answer(abi.encode(V1_2_3, IMPL_2)));
        assertEq(resolveFor(meta(MIN_SUPPORTED, "")), answer(abi.encode(uint128(0))));
        assertEq(resolveFor(meta(ADMIN, "")), answer(abi.encode(REGISTRY)));
        assertEq(resolveFor(meta(FROZEN, "")), answer(abi.encode(false)));
    }

    function test_latest_before_first_publish_reverts_no_versions() public {
        assertEq(resolveFor(meta(LATEST, "")), reverted(Resolver.NoVersions.selector));
    }

    // ─── callCode (the initializations primitive) ────────────────────────

    function test_call_code_from_the_registry_delegates_past_the_target_word() public {
        publish(V1_0_0, IMPL_1);
        bytes memory args = bytes.concat(abi.encode(INIT_1), hex"3a67c2f8");
        assertEq(resolveAs(shim, REGISTRY, meta(CALL_CODE, args)), delegate(INIT_1, META_HEADER_LEN + 32));
    }

    function test_call_code_is_authorized_by_the_forwarded_caller() public {
        // The resolver's own caller is always the shim; only the caller the
        // shim forwards decides.
        publish(V1_0_0, IMPL_1);
        bytes memory data = meta(CALL_CODE, abi.encode(INIT_1));
        assertEq(resolveAs(shim, STRANGER, data), reverted(Resolver.UnauthorizedAdmin.selector));
        assertEq(resolveAs(REGISTRY, STRANGER, data), reverted(Resolver.UnauthorizedAdmin.selector));
    }

    function test_call_code_works_while_frozen_and_before_first_publish() public {
        asRegistry().setFrozen(shim, true);
        assertEq(resolveAs(shim, REGISTRY, meta(CALL_CODE, abi.encode(INIT_1))), delegate(INIT_1, META_HEADER_LEN + 32));
    }

    function test_call_code_rejects_zero_and_malformed_targets() public {
        publish(V1_0_0, IMPL_1);
        assertEq(
            resolveAs(shim, REGISTRY, meta(CALL_CODE, new bytes(32))), reverted(Resolver.InvalidImplementation.selector)
        );
        assertEq(resolveAs(shim, REGISTRY, meta(CALL_CODE, new bytes(31))), reverted(Resolver.MalformedCall.selector));
        bytes memory dirty = abi.encode(INIT_1);
        dirty[0] = 0xff;
        assertEq(resolveAs(shim, REGISTRY, meta(CALL_CODE, dirty)), reverted(Resolver.MalformedCall.selector));
    }

    // ─── Malformed input ─────────────────────────────────────────────────

    function test_magic_prefixed_garbage_reverts() public {
        publish(V1_0_0, IMPL_1);
        bytes memory truncated = bytes.concat(MAGIC, new bytes(7));
        assertEq(resolveFor(truncated), reverted(Resolver.MalformedCall.selector));

        bytes memory dirty = abi.encode(V1_0_0);
        dirty[0] = 0xff;
        assertEq(resolveFor(meta(IMPL_OF, dirty)), reverted(Resolver.MalformedCall.selector));
        assertEq(resolveFor(meta(0xdeadbeef, "")), reverted(Resolver.UnknownMetaSelector.selector));
    }

    // ─── setCode ─────────────────────────────────────────────────────────

    function test_set_code_updates_the_implementation_slot() public {
        // Only an address with code can become the implementation.
        vm.etch(IMPL_2, hex"00");
        assertEq(resolver.getAdmin(), REGISTRY);
        asRegistry().setCode(IMPL_2);
        assertEq(resolver.getCode(), IMPL_2);
    }

    // ─── Wire format (the shim's side of the protocol) ───────────────────

    function test_resolve_request_header_decodes_as_the_abi_arguments() public {
        publish(V1_0_0, IMPL_1);
        // [selector][caller word][value word][offset 0x60][length word], then
        // the shim's calldata zero-padded to whole words.
        bytes memory request = bytes.concat(
            hex"6a418533",
            hex"0000000000000000000000009e9e9e9e9e9e9e9e9e9e9e9e9e9e9e9e9e9e9e9e",
            hex"0000000000000000000000000000000000000000000000000000000000000009",
            hex"0000000000000000000000000000000000000000000000000000000000000060",
            hex"0000000000000000000000000000000000000000000000000000000000000024",
            hex"7777777777777777777777777777777777777777777777777777777777777777",
            hex"7777777700000000000000000000000000000000000000000000000000000000"
        );

        vm.prank(shim);
        (bool ok, bytes memory response) = address(resolver).staticcall(request);
        assertTrue(ok);
        // Delegate to the latest implementation with nothing stripped.
        assertEq(
            response,
            hex"0000000000000000000000000000000000000000000000000000000000000020"
            hex"0000000000000000000000000000000000000000000000000000000000000001"
            hex"0000000000000000000000001111111111111111111111111111111111111111"
            hex"0000000000000000000000000000000000000000000000000000000000000000"
            hex"0000000000000000000000000000000000000000000000000000000000000080"
            hex"0000000000000000000000000000000000000000000000000000000000000000"
        );
    }

    function test_encoded_resolution_is_the_response_layout_the_shim_decodes() public {
        publish(V1_0_0, IMPL_1);
        publish(V1_2_3, IMPL_2);

        // [offset 0x20][kind][target][strip][offset 0x80][payload length],
        // then the payload: here the latest key and implementation.
        assertEq(
            resolveFor(meta(LATEST, "")),
            returned(
                hex"0000000000000000000000000000000000000000000000000000000000000020"
                hex"0000000000000000000000000000000000000000000000000000000000000000"
                hex"0000000000000000000000000000000000000000000000000000000000000000"
                hex"0000000000000000000000000000000000000000000000000000000000000000"
                hex"0000000000000000000000000000000000000000000000000000000000000080"
                hex"0000000000000000000000000000000000000000000000000000000000000040"
                hex"0000000000000000000000000000000000000000000000010000000200000003"
                hex"0000000000000000000000002222222222222222222222222222222222222222"
            )
        );

        assertEq(
            resolveFor(versioned(V1_2_3, hex"01010101")),
            returned(
                hex"0000000000000000000000000000000000000000000000000000000000000020"
                hex"0000000000000000000000000000000000000000000000000000000000000001"
                hex"0000000000000000000000002222222222222222222222222222222222222222"
                hex"0000000000000000000000000000000000000000000000000000000000000014"
                hex"0000000000000000000000000000000000000000000000000000000000000080"
                hex"0000000000000000000000000000000000000000000000000000000000000000"
            )
        );
    }

    /// A resolver method named by its signature, with its ABI-encoded arguments.
    struct AbiCall {
        string signature;
        bytes input;
    }

    function test_every_abi_selector_dispatches() public {
        // Only an address with code can become the implementation.
        vm.etch(IMPL_2, hex"00");
        AbiCall[10] memory cases = [
            AbiCall("publish(address,uint128,address)", abi.encode(shim, V1_0_0, IMPL_1)),
            AbiCall("setMinSupported(address,uint128)", abi.encode(shim, V1_0_0)),
            AbiCall("setFrozen(address,bool)", abi.encode(shim, false)),
            AbiCall("setFastPath(address,bool)", abi.encode(shim, true)),
            // Last of the per-name mutations: a sealed name takes no more.
            AbiCall("seal(address)", abi.encode(shim)),
            AbiCall("setCode(address)", abi.encode(IMPL_2)),
            AbiCall("getCode()", ""),
            AbiCall("getAdmin()", ""),
            AbiCall("routingOf(address)", abi.encode(shim)),
            AbiCall("implOf(address,uint128)", abi.encode(shim, V1_0_0))
        ];
        for (uint256 i = 0; i < cases.length; i++) {
            vm.prank(REGISTRY);
            (bool ok,) =
                address(resolver).call(bytes.concat(bytes4(keccak256(bytes(cases[i].signature))), cases[i].input));
            assertTrue(ok);
        }
        (bool handled, bytes memory out) = address(resolver).call(hex"deadbeef");
        assertFalse(handled);
        assertEq(out, "");
    }

    function test_error_selectors_derive_from_signatures() public pure {
        assertEq(Resolver.UnknownVersion.selector, bytes4(keccak256("UnknownVersion()")));
        assertEq(Resolver.UnsupportedVersion.selector, bytes4(keccak256("UnsupportedVersion(uint128,uint128)")));
    }
}
