// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.28;

import "../../CounterA.sol";

/// @notice Initialization for @example/counter-a version 0.1.0: runs exactly
/// once, in the name's proxy storage, inside the transaction that publishes
/// 0.1.0. The directory names the contract it initializes; inheriting CounterA
/// gives it the same storage layout, which CDM verifies before deploying.
contract Init_0_1_0 is CounterA {
    /// `from` is the previously-latest version key (0 on a first publish);
    /// `owner` is the name's registry owner.
    function initialize(uint128, address) external {
        // Demonstrative — set genuine starting state or transform existing state here.
        count = 0;
    }
}
