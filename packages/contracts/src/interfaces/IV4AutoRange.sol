// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import { Currency } from "@uniswap/v4-core/src/types/Currency.sol";

/// @title IV4AutoRange
/// @notice Interface for V4AutoRange - automated position rebalancing for Uniswap V4
interface IV4AutoRange {
    /// @notice Emitted when a position is configured for auto-range
    event RangeConfigured(
        uint256 indexed tokenId, address indexed owner, int24 lowerDelta, int24 upperDelta, uint32 rebalanceThreshold
    );

    /// @notice Emitted when range config is removed
    event RangeRemoved(uint256 indexed tokenId);

    /// @notice Emitted when a position is rebalanced
    event Rebalanced(
        uint256 indexed oldTokenId,
        uint256 indexed newTokenId,
        int24 newTickLower,
        int24 newTickUpper,
        uint128 liquidity,
        uint256 fee0,
        uint256 fee1
    );

    /// @notice Rebalance configuration for a position
    struct RangeConfig {
        bool enabled;
        int24 lowerDelta; // How many ticks below current tick for lower bound
        int24 upperDelta; // How many ticks above current tick for upper bound
        uint32 rebalanceThreshold; // Percentage of range the price must exit (basis points)
        uint32 minRebalanceInterval; // Minimum seconds between rebalances
        bool collectFeesOnRebalance; // Whether to collect and compound fees
        uint256 maxSwapSlippage; // Maximum slippage for swaps (basis points)
    }

    /// @notice Rebalance result
    struct RebalanceResult {
        uint256 newTokenId;
        int24 newTickLower;
        int24 newTickUpper;
        uint128 liquidity;
        uint256 fee0;
        uint256 fee1;
    }

    /// @notice Configure auto-range for a position
    /// @param tokenId The position token ID
    /// @param config The range configuration
    function configureRange(uint256 tokenId, RangeConfig calldata config) external;

    /// @notice Remove auto-range configuration
    /// @param tokenId The position token ID
    function removeRange(uint256 tokenId) external;

    /// @notice Update range configuration
    /// @param tokenId The position token ID
    /// @param config New range configuration
    function updateRangeConfig(uint256 tokenId, RangeConfig calldata config) external;

    /// @notice Execute rebalance for a position
    /// @param tokenId The position token ID
    /// @param swapData Swap data for rebalancing tokens
    /// @return result The rebalance result
    function executeRebalance(uint256 tokenId, bytes calldata swapData)
        external
        returns (RebalanceResult memory result);

    /// @notice Check if a position needs rebalancing
    /// @param tokenId The position token ID
    /// @return needsRebalance Whether the position needs rebalancing
    /// @return reason Reason code (0=in range, 1=below range, 2=above range)
    function checkRebalance(uint256 tokenId) external view returns (bool needsRebalance, uint8 reason);

    /// @notice Get range configuration for a position
    /// @param tokenId The position token ID
    /// @return config The range configuration
    function getRangeConfig(uint256 tokenId) external view returns (RangeConfig memory config);

    /// @notice Get last rebalance timestamp for a position
    /// @param tokenId The position token ID
    /// @return timestamp The last rebalance timestamp
    function getLastRebalanceTime(uint256 tokenId) external view returns (uint256 timestamp);

    /// @notice Batch check multiple positions for rebalance
    /// @param tokenIds Array of position token IDs
    /// @return results Array of booleans indicating which need rebalance
    function batchCheckRebalance(uint256[] calldata tokenIds) external view returns (bool[] memory results);

    /// @notice Calculate optimal range for current price
    /// @param tokenId The position token ID
    /// @return tickLower Optimal lower tick
    /// @return tickUpper Optimal upper tick
    function calculateOptimalRange(uint256 tokenId) external view returns (int24 tickLower, int24 tickUpper);

    /// @notice Get position status
    /// @param tokenId The position token ID
    /// @return inRange Whether position is in range
    /// @return currentTick Current pool tick
    /// @return tickLower Position lower tick
    /// @return tickUpper Position upper tick
    function getPositionStatus(uint256 tokenId)
        external
        view
        returns (bool inRange, int24 currentTick, int24 tickLower, int24 tickUpper);
}
