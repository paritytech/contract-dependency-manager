// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.28;

interface ICounterA {
    function count() external view returns (uint256);
    function increment() external returns (uint256);
    function add(uint256 amount) external returns (uint256);
}

contract CounterB {
    address public counterA;
    uint256 public localCount;

    event CounterAUpdated(address indexed counterA);
    event LocalIncremented(address indexed caller, uint256 count);

    function setCounterA(address newCounterA) external {
        counterA = newCounterA;
        emit CounterAUpdated(newCounterA);
    }

    function incrementLocal() external returns (uint256) {
        localCount += 1;
        emit LocalIncremented(msg.sender, localCount);
        return localCount;
    }

    function incrementA() external returns (uint256) {
        return ICounterA(counterA).increment();
    }

    function addToA(uint256 amount) external returns (uint256) {
        return ICounterA(counterA).add(amount);
    }

    function readA() external view returns (uint256) {
        return ICounterA(counterA).count();
    }
}
