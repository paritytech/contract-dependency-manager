// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.28;

import "../.cdm/solidity/example/counter-a.sol";

/// @notice Demonstrates a Solidity contract calling CounterA through a generated CDM import.
/// @custom:cdm @example/counter-b
contract CounterB {
    uint256 public localCount;

    event LocalIncremented(address indexed caller, uint256 count);

    function incrementLocal() external returns (uint256) {
        localCount += 1;
        emit LocalIncremented(msg.sender, localCount);
        return localCount;
    }

    function incrementA() external returns (uint256) {
        return ExampleCounterA.ref().increment();
    }

    function addToA(uint256 amount) external returns (uint256) {
        return ExampleCounterA.ref().add(amount);
    }

    function readA() external view returns (uint256) {
        return ExampleCounterA.ref().count();
    }
}
