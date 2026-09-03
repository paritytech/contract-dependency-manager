// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.28;

import "../../CounterA.sol";

/// @notice Initialization for @example/counter-a version 0.1.0.
///
/// Runs exactly once, inside the name's per-name proxy storage, in the same
/// transaction that publishes 0.1.0. The directory names the contract this
/// file initializes (initializations/CounterA/), and inheriting CounterA
/// gives it the exact storage layout (and internal helpers) of that contract
/// — which CDM's layout guard verifies before deploying.
contract Init_0_1_0 is CounterA {
    /// `from` is the previously-latest version key (0 on a first publish);
    /// `owner` is the name's registry owner.
    function initialize(uint128, address) external {
        // Demonstrates the shape — a real initialization would set genuine
        // starting state or transform what's already there.
        count = 0;
    }
}
