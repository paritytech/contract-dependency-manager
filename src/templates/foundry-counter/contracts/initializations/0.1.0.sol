// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.28;

import "../CounterA.sol";

/// @notice Initialization for @example/counter-a version 0.1.0.
///
/// Runs exactly once, inside the name's per-name proxy storage, in the same
/// transaction that publishes 0.1.0. Inheriting CounterA gives it the exact
/// storage layout (and internal helpers) of the contract it initializes —
/// which CDM's layout guard verifies before deploying.
contract Init_0_1_0 is CounterA {
    /// @param from The previously-latest version key — 0 on a first publish.
    /// @param owner_ The name's registry owner (the publisher).
    function cdmInit(uint128 from, address owner_) external {
        from; // first publish — nothing to migrate from
        owner = owner_;
    }
}
