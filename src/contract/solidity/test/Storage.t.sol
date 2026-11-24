// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.34;

import {Registry} from "../src/Registry.sol";
import {Resolver} from "../src/Resolver.sol";
import {ShimDouble, ShimFactoryDouble} from "./Doubles.sol";
import {Test} from "./Test.sol";

/// Where the registry and the resolver keep their state. An upgrade reads
/// these keys again, so a moved field is a silent misread: every key a first
/// publish writes is pinned here.
contract StorageTest is Test {
    bytes32 private constant REGISTRY_ROOT = 0x2f9ca4198b1806e2802afcaa45efbe30cd86df59e0fca3c23144e2c191c5f800;
    bytes32 private constant RESOLVER_ROOT = 0x582f05604914296885c9056699245f1db329eb5c152585294d191ef37929e000;

    bytes32 private constant IMPLEMENTATION_SLOT = 0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc;
    bytes32 private constant ADMIN_SLOT = 0xb53127684a568b3173ae13b9f8a6016e243e63b6e8ee1178d6a717850b5d6103;
    bytes32 private constant FROZEN_SLOT = bytes32(uint256(keccak256("cdm.registry.frozen")) - 1);
    bytes32 private constant SHIM_FAST_SLOT = bytes32(uint256(keccak256("cdm.shim.fast")) - 1);

    string private constant NAME = "@scope/package";
    string private constant URI = "ipfs://metadata";
    uint128 private constant KEY = uint128(1) << 64;

    Registry private registry;
    Resolver private resolver;
    address private target = address(new ShimDouble(address(0)));

    function setUp() public {
        registry = new Registry(address(new ShimFactoryDouble()));
        vm.prank(address(registry));
        resolver = new Resolver();
        registry.setResolver(address(resolver));
    }

    function erc7201(string memory id) private pure returns (bytes32) {
        return keccak256(abi.encode(uint256(keccak256(bytes(id))) - 1)) & ~bytes32(uint256(0xff));
    }

    function at(bytes32 root, uint256 field) private pure returns (bytes32) {
        return bytes32(uint256(root) + field);
    }

    function test_roots_are_the_erc7201_slots_of_their_ids() public pure {
        assertEq(REGISTRY_ROOT, erc7201("cdm.registry.v1"));
        assertEq(RESOLVER_ROOT, erc7201("cdm.resolver.v1"));
    }

    function test_fixed_slots_are_distinct() public pure {
        bytes32[6] memory slots =
            [REGISTRY_ROOT, RESOLVER_ROOT, IMPLEMENTATION_SLOT, ADMIN_SLOT, FROZEN_SLOT, SHIM_FAST_SLOT];
        for (uint256 i = 0; i < slots.length; i++) {
            for (uint256 j = i + 1; j < slots.length; j++) {
                assertTrue(slots[i] != slots[j]);
            }
        }
    }

    function test_set_resolver_writes_the_fifth_registry_field() public view {
        assertEq(vm.load(address(registry), at(REGISTRY_ROOT, 4)), bytes32(uint256(uint160(address(resolver)))));
    }

    function test_first_publish_writes_exactly_these_registry_keys() public {
        vm.record();
        registry.publish(NAME, KEY, target, URI);
        (, bytes32[] memory writes) = vm.accesses(address(registry));

        bytes32 names = at(REGISTRY_ROOT, 0);
        bytes32 info = keccak256(abi.encodePacked(NAME, at(REGISTRY_ROOT, 1)));
        bytes32 version = keccak256(abi.encode(uint32(0), keccak256(abi.encodePacked(NAME, at(REGISTRY_ROOT, 2)))));
        bytes32 uri = keccak256(abi.encode(uint32(0), keccak256(abi.encodePacked(NAME, at(REGISTRY_ROOT, 3)))));

        bytes32[] memory expected = new bytes32[](6);
        expected[0] = names; // length
        expected[1] = keccak256(abi.encode(names)); // first element
        expected[2] = info; // owner and version count
        expected[3] = bytes32(uint256(info) + 1); // proxy
        expected[4] = version;
        expected[5] = uri;
        assertEq(distinct(writes), sorted(expected));

        assertEq(vm.load(address(registry), names), bytes32(uint256(1)));
        assertEq(vm.load(address(registry), version), bytes32(uint256(KEY)));
    }

    function test_first_publish_writes_exactly_these_resolver_keys() public {
        vm.record();
        registry.publish(NAME, KEY, target, URI);
        (, bytes32[] memory writes) = vm.accesses(address(resolver));

        address shim = registry.getAddress(NAME).value;
        bytes32 routing = keccak256(abi.encode(shim, at(RESOLVER_ROOT, 0)));
        bytes32 implementation = keccak256(abi.encode(KEY, keccak256(abi.encode(shim, at(RESOLVER_ROOT, 1)))));

        bytes32[] memory expected = new bytes32[](3);
        expected[0] = routing; // latest key and floor
        expected[1] = bytes32(uint256(routing) + 1); // latest implementation and flags
        expected[2] = implementation;
        assertEq(distinct(writes), sorted(expected));

        assertEq(vm.load(address(resolver), routing), bytes32(uint256(KEY)));
        assertEq(vm.load(address(resolver), bytes32(uint256(routing) + 1)), bytes32(uint256(uint160(target))));
        assertEq(vm.load(address(resolver), implementation), bytes32(uint256(uint160(target))));
    }

    function sorted(bytes32[] memory values) private pure returns (bytes32[] memory) {
        for (uint256 i = 1; i < values.length; i++) {
            bytes32 value = values[i];
            uint256 j = i;
            for (; j > 0 && values[j - 1] > value; j--) {
                values[j] = values[j - 1];
            }
            values[j] = value;
        }
        return values;
    }

    /// `values` sorted, with repeats removed: a slot written twice is listed twice.
    function distinct(bytes32[] memory values) private pure returns (bytes32[] memory out) {
        values = sorted(values);
        uint256 count;
        for (uint256 i = 0; i < values.length; i++) {
            if (i == 0 || values[i] != values[i - 1]) values[count++] = values[i];
        }
        out = new bytes32[](count);
        for (uint256 i = 0; i < count; i++) {
            out[i] = values[i];
        }
    }
}
