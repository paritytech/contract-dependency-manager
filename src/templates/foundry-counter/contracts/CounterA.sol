// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.28;

/// @notice Stores a counter that other contracts can increment through CDM.
/// @custom:cdm @example/counter-a
contract CounterA {
    uint256 public count;

    event Incremented(address indexed caller, uint256 count);
    event Added(address indexed caller, uint256 amount, uint256 count);

    function increment() external returns (uint256) {
        count += 1;
        emit Incremented(msg.sender, count);
        return count;
    }

    function add(uint256 amount) external returns (uint256) {
        count += amount;
        emit Added(msg.sender, amount, count);
        return count;
    }
}
