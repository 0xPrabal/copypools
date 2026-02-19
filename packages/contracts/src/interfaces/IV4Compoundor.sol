// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import { Currency } from "@uniswap/v4-core/src/types/Currency.sol";

/// @title IV4Compoundor
/// @notice Interface for V4Compoundor - automated fee compounding for Uniswap V4 positions
interface IV4Compoundor {
    /// @notice Emitted when a position is registered for auto-compounding
    event PositionRegistered(uint256 indexed tokenId, address indexed owner);

    /// @notice Emitted when a position is unregistered from auto-compounding
    event PositionUnregistered(uint256 indexed tokenId, address indexed owner);

    /// @notice Emitted when fees are auto-compounded
    event AutoCompounded(
        uint256 indexed tokenId,
        address indexed caller,
        uint256 amount0Compounded,
        uint256 amount1Compounded,
        uint256 fee0,
        uint256 fee1,
        uint128 liquidityAdded
    );

    /// @notice Emitted when protocol fee is updated
    event ProtocolFeeUpdated(uint256 oldFee, uint256 newFee);

    /// @notice Emitted when fees are withdrawn
    event FeesWithdrawn(address indexed recipient, Currency currency, uint256 amount);

    /// @notice Configuration for auto-compound
    struct CompoundConfig {
        bool enabled;
        uint32 minCompoundInterval; // Minimum seconds between compounds
        uint256 minRewardAmount; // Minimum reward for caller to trigger
    }

    /// @notice Result of compound operation
    struct CompoundResult {
        uint256 amount0Compounded;
        uint256 amount1Compounded;
        uint256 fee0;
        uint256 fee1;
        uint128 liquidityAdded;
    }

    /// @notice Register a position for auto-compounding
    /// @param tokenId The position token ID
    /// @param config The compound configuration
    function registerPosition(uint256 tokenId, CompoundConfig calldata config) external;

    /// @notice Unregister a position from auto-compounding
    /// @param tokenId The position token ID
    function unregisterPosition(uint256 tokenId) external;

    /// @notice Update compound configuration for a position
    /// @param tokenId The position token ID
    /// @param config The new compound configuration
    function updateConfig(uint256 tokenId, CompoundConfig calldata config) external;

    /// @notice Auto-compound fees for a position
    /// @param tokenId The position token ID
    /// @param swapData Optional swap data for rebalancing
    /// @return result The compound result
    function autoCompound(uint256 tokenId, bytes calldata swapData, uint256 deadline) external returns (CompoundResult memory result);

    /// @notice Self-compound fees (called by position owner)
    /// @param tokenId The position token ID
    /// @param swapData Optional swap data for rebalancing
    /// @return result The compound result
    function selfCompound(uint256 tokenId, bytes calldata swapData, uint256 deadline) external returns (CompoundResult memory result);

    /// @notice Check if a position is profitable to compound
    /// @param tokenId The position token ID
    /// @return profitable Whether it's profitable to compound
    /// @return estimatedReward Estimated reward for caller
    function isCompoundProfitable(uint256 tokenId) external view returns (bool profitable, uint256 estimatedReward);

    /// @notice Get compound configuration for a position
    /// @param tokenId The position token ID
    /// @return config The compound configuration
    function getConfig(uint256 tokenId) external view returns (CompoundConfig memory config);

    /// @notice Get pending fees for a position
    /// @param tokenId The position token ID
    /// @return amount0 Pending fee amount for token0
    /// @return amount1 Pending fee amount for token1
    function getPendingFees(uint256 tokenId) external view returns (uint256 amount0, uint256 amount1);

    /// @notice Get last compound timestamp for a position
    /// @param tokenId The position token ID
    /// @return timestamp The last compound timestamp
    function getLastCompoundTime(uint256 tokenId) external view returns (uint256 timestamp);

    /// @notice Get protocol fee percentage (in basis points)
    /// @return fee The protocol fee (e.g., 200 = 2%)
    function protocolFee() external view returns (uint256 fee);

    /// @notice Set protocol fee (owner only)
    /// @param newFee New protocol fee in basis points
    function setProtocolFee(uint256 newFee) external;

    /// @notice Withdraw accumulated protocol fees
    /// @param currency The currency to withdraw
    /// @param recipient The recipient address
    function withdrawFees(Currency currency, address recipient) external;

    /// @notice Batch withdraw accumulated protocol fees for multiple currencies
    /// @param currencies Array of currencies to withdraw
    /// @param recipient The recipient address
    function batchWithdrawFees(Currency[] calldata currencies, address recipient) external;
}
