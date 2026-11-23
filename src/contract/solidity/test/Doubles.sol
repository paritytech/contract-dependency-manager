// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.34;

/// Stands in for a per-name shim, which is a PVM contract these tests cannot
/// run: it keeps the last call it received and can be told to revert.
contract ShimDouble {
    address public immutable RESOLVER;
    bytes public lastCall;
    uint256 public calls;
    bytes private revertData;
    bool private reverts;

    constructor(address resolver) {
        RESOLVER = resolver;
    }

    function revertWith(bytes calldata data) external {
        reverts = true;
        revertData = data;
    }

    receive() external payable {}

    fallback() external payable {
        if (reverts) {
            bytes memory data = revertData;
            assembly {
                revert(add(data, 32), mload(data))
            }
        }
        lastCall = msg.data;
        calls += 1;
    }
}

/// Stands in for the PVM shim factory. Delegate-called with exactly
/// `[salt][code hash][one constructor word]`, it creates a `ShimDouble` at an
/// address derived from the caller and returns it as one ABI word.
contract ShimFactoryDouble {
    fallback(bytes calldata input) external returns (bytes memory) {
        require(input.length == 96);
        address resolver = abi.decode(input[64:], (address));
        return abi.encode(address(new ShimDouble{salt: bytes32(input[:32])}(resolver)));
    }
}
