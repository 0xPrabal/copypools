// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import { Currency } from "@uniswap/v4-core/src/types/Currency.sol";

/// @title IV4AutoExit
/// @notice Interface for V4AutoExit - automated position exit for Uniswap V4
/// @dev Supports stop-loss, take-profit, and out-of-range exit triggers
interface IV4AutoExit {
    // ============ Events ============

    /// @notice Emitted when exit is configured for a position
    event ExitConfigured(
        uint256 indexed tokenId,
        address indexed owner,
        int24 triggerTickLower,
        int24 triggerTickUpper,
        bool exitOnRangeExit
    );

    /// @notice Emitted when exit config is removed
    event ExitRemoved(uint256 indexed tokenId);

    /// @notice Emitted when a position exit is executed
    event ExitExecuted(
        uint256 indexed tokenId,
        address indexed owner,
        uint8 exitReason,
        uint256 amount0Received,
        uint256 amount1Received,
        uint256 fee0,
        uint256 fee1,
        uint128 liquidityRemoved
    );

    /// @notice Emitted when protocol fee is updated
    event ProtocolFeeUpdated(uint256 oldFee, uint256 newFee);

    /// @notice Emitted when fees are withdrawn
    event FeesWithdrawn(address indexed recipient, Currency currency, uint256 amount);

    // ============ Errors ============

    /// @notice Exit is not configured for this position
    error ExitNotConfigured();

    /// @notice Exit conditions are not met
    error ExitConditionsNotMet();

    /// @notice Exit interval has not passed since configuration
    error ExitTooSoon();

    /// @notice Trigger ticks are invalid (upper <= lower)
    error InvalidTriggerTicks();

    /// @notice Position has no liquidity
    error NoLiquidity();

    // ============ Structs ============

    /// @notice Exit configuration for a position
    struct ExitConfig {
        bool enabled;
        int24 triggerTickLower;     // Exit if currentTick <= this (stop-loss below)
        int24 triggerTickUpper;     // Exit if currentTick >= this (take-profit above)
        bool exitOnRangeExit;       // Exit when position goes out of range (any direction)
        Currency exitToken;         // Token to swap everything to (address(0) = keep both)
        uint256 maxSwapSlippage;    // Max slippage for exit swap (basis points)
        uint32 minExitInterval;     // Cooldown since config time (prevents frontrunning)
    }

    /// @notice Exit execution result
    struct ExitResult {
        uint8 exitReason;           // 1=stopLoss, 2=takeProfit, 3=outOfRange
        uint256 amount0Received;    // Amount of token0 sent to owner (after fees/swap)
        uint256 amount1Received;    // Amount of token1 sent to owner (after fees/swap)
        uint256 fee0;               // Protocol fee taken in token0
        uint256 fee1;               // Protocol fee taken in token1
        uint128 liquidityRemoved;   // Total liquidity removed
    }

    // ============ User Configuration ============

    /// @notice Configure auto-exit for a position
    /// @param tokenId The position token ID
    /// @param config The exit configuration
    function configureExit(uint256 tokenId, ExitConfig calldata config) external;

    /// @notice Remove auto-exit configuration
    /// @param tokenId The position token ID
    function removeExit(uint256 tokenId) external;

    /// @notice Update exit configuration
    /// @param tokenId The position token ID
    /// @param config New exit configuration
    function updateExitConfig(uint256 tokenId, ExitConfig calldata config) external;

    // ============ Bot Execution ============

    /// @notice Execute an automated exit (called by bot, takes protocol fee)
    /// @param tokenId The position token ID
    /// @param swapData Swap data for converting to exit token (empty = keep both)
    /// @param deadline Transaction deadline timestamp
    /// @return result The exit result
    function executeExit(uint256 tokenId, bytes calldata swapData, uint256 deadline)
        external
        returns (ExitResult memory result);

    /// @notice Owner self-exit (no protocol fee)
    /// @param tokenId The position token ID
    /// @param swapData Swap data for converting to exit token
    /// @param deadline Transaction deadline timestamp
    /// @return result The exit result
    function selfExit(uint256 tokenId, bytes calldata swapData, uint256 deadline)
        external
        returns (ExitResult memory result);

    // ============ View Functions ============

    /// @notice Check if a position needs to be exited
    /// @param tokenId The position token ID
    /// @return needsExit Whether the position needs to be exited
    /// @return reason 0=no exit, 1=stopLoss, 2=takeProfit, 3=outOfRange
    function checkExit(uint256 tokenId) external view returns (bool needsExit, uint8 reason);

    /// @notice Batch check multiple positions for exit
    /// @param tokenIds Array of position token IDs
    /// @return results Array of booleans indicating which need exit
    function batchCheckExit(uint256[] calldata tokenIds) external view returns (bool[] memory results);

    /// @notice Get exit configuration for a position
    /// @param tokenId The position token ID
    /// @return config The exit configuration
    function getExitConfig(uint256 tokenId) external view returns (ExitConfig memory config);

    /// @notice Get configuration timestamp for a position
    /// @param tokenId The position token ID
    /// @return timestamp When the exit was configured
    function getConfigTimestamp(uint256 tokenId) external view returns (uint256 timestamp);

    // ============ Protocol Fee Management ============

    /// @notice Get protocol fee percentage (in basis points)
    function protocolFee() external view returns (uint256);

    /// @notice Set protocol fee (owner only)
    /// @param newFee New protocol fee in basis points
    function setProtocolFee(uint256 newFee) external;

    /// @notice Withdraw accumulated protocol fees
    /// @param currency The currency to withdraw
    /// @param recipient The recipient address
    function withdrawFees(Currency currency, address recipient) external;

    /// @notice Batch withdraw accumulated protocol fees
    /// @param currencies Array of currencies to withdraw
    /// @param recipient The recipient address
    function batchWithdrawFees(Currency[] calldata currencies, address recipient) external;

    /// @notice Get accumulated fees for a currency
    /// @param currency The currency to check
    /// @return amount The accumulated fee amount
    function accumulatedFees(Currency currency) external view returns (uint256 amount);
}
