// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.34;

/// Stands in for the resolver's EIP-1967 proxy: delegate-calls the resolver
/// implementation against its own storage and keeps the calldata of every
/// call it forwarded, in order.
contract ResolverSpy {
    bytes32 private constant ADMIN_SLOT = 0xb53127684a568b3173ae13b9f8a6016e243e63b6e8ee1178d6a717850b5d6103;

    address private immutable IMPLEMENTATION;
    bytes[] private forwarded;

    constructor(address implementation, address admin) {
        IMPLEMENTATION = implementation;
        assembly {
            sstore(ADMIN_SLOT, admin)
        }
    }

    /// The calls forwarded since the last `take`. A call the resolver
    /// reverted is not among them.
    function take() external returns (bytes[] memory calls) {
        calls = forwarded;
        delete forwarded;
    }

    fallback() external {
        forwarded.push(msg.data);
        (bool ok, bytes memory result) = IMPLEMENTATION.delegatecall(msg.data);
        assembly {
            if iszero(ok) { revert(add(result, 32), mload(result)) }
            return(add(result, 32), mload(result))
        }
    }
}
