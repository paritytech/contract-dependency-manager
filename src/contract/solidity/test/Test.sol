// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.34;

/// The Foundry cheatcodes these tests use.
interface Vm {
    struct Log {
        bytes32[] topics;
        bytes data;
        address emitter;
    }

    function prank(address sender) external;
    function startPrank(address sender) external;
    function stopPrank() external;
    function expectRevert() external;
    function expectRevert(bytes4 selector) external;
    function expectRevert(bytes calldata data) external;
    function expectEmit() external;
    function expectEmit(address emitter) external;
    function expectCall(address callee, bytes calldata data) external;
    function expectCall(address callee, bytes calldata data, uint64 count) external;
    function mockCall(address callee, bytes calldata data, bytes calldata returnData) external;
    function mockCallRevert(address callee, bytes calldata data, bytes calldata revertData) external;
    function etch(address target, bytes calldata code) external;
    function load(address target, bytes32 slot) external view returns (bytes32);
    function store(address target, bytes32 slot, bytes32 value) external;
    function record() external;
    function accesses(address target) external returns (bytes32[] memory reads, bytes32[] memory writes);
    function recordLogs() external;
    function getRecordedLogs() external returns (Log[] memory);
    function readFileBinary(string calldata path) external view returns (bytes memory);
    function toString(uint256 value) external pure returns (string memory);

    function assertTrue(bool condition) external pure;
    function assertFalse(bool condition) external pure;
    function assertEq(uint256 left, uint256 right) external pure;
    function assertEq(address left, address right) external pure;
    function assertEq(bytes32 left, bytes32 right) external pure;
    function assertEq(bool left, bool right) external pure;
    function assertEq(string calldata left, string calldata right) external pure;
    function assertEq(bytes calldata left, bytes calldata right) external pure;
    function assertEq(bytes32[] calldata left, bytes32[] calldata right) external pure;
}

/// Base for every test contract: the cheatcode handle and its assertions.
abstract contract Test {
    Vm internal constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));

    function assertTrue(bool condition) internal pure {
        vm.assertTrue(condition);
    }

    function assertFalse(bool condition) internal pure {
        vm.assertFalse(condition);
    }

    function assertEq(uint256 left, uint256 right) internal pure {
        vm.assertEq(left, right);
    }

    function assertEq(address left, address right) internal pure {
        vm.assertEq(left, right);
    }

    function assertEq(bytes32 left, bytes32 right) internal pure {
        vm.assertEq(left, right);
    }

    function assertEq(bool left, bool right) internal pure {
        vm.assertEq(left, right);
    }

    function assertEq(string memory left, string memory right) internal pure {
        vm.assertEq(left, right);
    }

    function assertEq(bytes memory left, bytes memory right) internal pure {
        vm.assertEq(left, right);
    }

    function assertEq(bytes32[] memory left, bytes32[] memory right) internal pure {
        vm.assertEq(left, right);
    }
}
