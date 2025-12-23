// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/// @title Multicall
/// @notice Enables calling multiple methods in a single call to the contract
abstract contract Multicall {
    /// @notice Call multiple functions in the current contract
    /// @param data Array of encoded function calls
    /// @return results Array of results from each call
    function multicall(bytes[] calldata data) external payable returns (bytes[] memory results) {
        results = new bytes[](data.length);
        for (uint256 i = 0; i < data.length; i++) {
            (bool success, bytes memory result) = address(this).delegatecall(data[i]);

            if (!success) {
                // Forward the revert reason
                if (result.length > 0) {
                    assembly {
                        let returndata_size := mload(result)
                        revert(add(32, result), returndata_size)
                    }
                } else {
                    revert("Multicall: call failed");
                }
            }

            results[i] = result;
        }
    }

    /// @notice Call multiple functions in the current contract, allowing failures
    /// @param data Array of encoded function calls
    /// @return successes Array of success flags
    /// @return results Array of results from each call
    function tryMulticall(bytes[] calldata data)
        external
        payable
        returns (bool[] memory successes, bytes[] memory results)
    {
        successes = new bool[](data.length);
        results = new bytes[](data.length);

        for (uint256 i = 0; i < data.length; i++) {
            (bool success, bytes memory result) = address(this).delegatecall(data[i]);
            successes[i] = success;
            results[i] = result;
        }
    }
}
