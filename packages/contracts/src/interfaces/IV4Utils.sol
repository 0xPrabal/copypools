// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import { PoolKey } from "@uniswap/v4-core/src/types/PoolKey.sol";
import { BalanceDelta } from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import { Currency } from "@uniswap/v4-core/src/types/Currency.sol";

/// @title IV4Utils
/// @notice Interface for V4Utils - atomic operations for Uniswap V4 positions
interface IV4Utils {
    /// @notice Emitted when a new position is minted
    event PositionMinted(
        uint256 indexed tokenId,
        address indexed owner,
        PoolKey poolKey,
        int24 tickLower,
        int24 tickUpper,
        uint128 liquidity
    );

    /// @notice Emitted when liquidity is increased
    event LiquidityIncreased(uint256 indexed tokenId, uint128 liquidity, uint256 amount0, uint256 amount1);

    /// @notice Emitted when liquidity is decreased
    event LiquidityDecreased(uint256 indexed tokenId, uint128 liquidity, uint256 amount0, uint256 amount1);

    /// @notice Emitted when fees are collected
    event FeesCollected(uint256 indexed tokenId, uint256 amount0, uint256 amount1);

    /// @notice Emitted when position range is moved
    event RangeMoved(uint256 indexed oldTokenId, uint256 indexed newTokenId, int24 newTickLower, int24 newTickUpper);

    /// @notice Emitted when protocol fee is updated
    event ProtocolFeeUpdated(uint256 oldFee, uint256 newFee);

    /// @notice Emitted when fees are withdrawn
    event FeesWithdrawn(address indexed recipient, Currency currency, uint256 amount);

    /// @notice Emitted when swap fee is taken
    event SwapFeeTaken(Currency currency, uint256 amount);

    /// @notice Parameters for swap and mint operation
    struct SwapAndMintParams {
        PoolKey poolKey;
        int24 tickLower;
        int24 tickUpper;
        uint256 amount0Desired;
        uint256 amount1Desired;
        uint256 amount0Max; // Maximum amount of token0 to spend
        uint256 amount1Max; // Maximum amount of token1 to spend
        address recipient;
        uint256 deadline;
        Currency swapSourceCurrency;
        uint256 swapSourceAmount;
        bytes swapData; // 0x API swap data
        uint256 maxSwapSlippage; // in basis points (10000 = 100%)
    }

    /// @notice Parameters for swap and increase liquidity
    struct SwapAndIncreaseParams {
        uint256 tokenId;
        uint256 amount0Desired;
        uint256 amount1Desired;
        uint256 amount0Max; // Maximum amount of token0 to spend
        uint256 amount1Max; // Maximum amount of token1 to spend
        uint256 deadline;
        Currency swapSourceCurrency;
        uint256 swapSourceAmount;
        bytes swapData;
        uint256 maxSwapSlippage;
    }

    /// @notice Parameters for decrease and swap operation
    struct DecreaseAndSwapParams {
        uint256 tokenId;
        uint128 liquidity;
        uint256 amount0Min;
        uint256 amount1Min;
        uint256 deadline;
        Currency targetCurrency;
        bytes swapData0;       // Swap data for token0 → target (empty if token0 is target)
        bytes swapData1;       // Swap data for token1 → target (empty if token1 is target)
        uint256 maxSwapSlippage;
    }

    /// @notice Parameters for collect and swap operation
    struct CollectAndSwapParams {
        uint256 tokenId;
        Currency targetCurrency;
        bytes swapData0;       // Swap data for token0 → target (empty if token0 is target)
        bytes swapData1;       // Swap data for token1 → target (empty if token1 is target)
        uint256 maxSwapSlippage;
        uint256 deadline;
    }

    /// @notice Parameters for move range operation
    struct MoveRangeParams {
        uint256 tokenId;
        int24 newTickLower;
        int24 newTickUpper;
        uint128 liquidityToMove; // 0 means all
        uint256 amount0Max; // Maximum amount of token0 to spend when adding to new position
        uint256 amount1Max; // Maximum amount of token1 to spend when adding to new position
        uint256 deadline;
        bytes swapData;
        uint256 maxSwapSlippage;
    }

    /// @notice Parameters for decrease liquidity (returns both tokens)
    struct DecreaseLiquidityParams {
        uint256 tokenId;
        uint128 liquidity; // 0 means all
        uint256 amount0Min;
        uint256 amount1Min;
        uint256 deadline;
    }

    /// @notice Parameters for collect fees (returns both tokens, no swap)
    struct CollectFeesParams {
        uint256 tokenId;
        uint256 deadline;
    }

    /// @notice Parameters for exit to stablecoin operation
    struct ExitToStablecoinParams {
        uint256 tokenId;
        uint128 liquidity; // 0 means all
        Currency targetStablecoin; // USDC, USDT, or DAI address
        uint256 minAmountOut; // Minimum stablecoin to receive
        uint256 deadline;
        bytes swapData0; // Swap data for token0 -> stablecoin (empty if token0 is the stablecoin)
        bytes swapData1; // Swap data for token1 -> stablecoin (empty if token1 is the stablecoin)
        uint256 maxSwapSlippage;
    }

    /// @notice Swap tokens and mint a new position
    /// @param params The parameters for swap and mint
    /// @return tokenId The ID of the new position
    /// @return liquidity The amount of liquidity minted
    /// @return amount0 The amount of token0 added
    /// @return amount1 The amount of token1 added
    function swapAndMint(SwapAndMintParams calldata params)
        external
        payable
        returns (uint256 tokenId, uint128 liquidity, uint256 amount0, uint256 amount1);

    /// @notice Swap tokens and increase liquidity in an existing position
    /// @param params The parameters for swap and increase
    /// @return liquidity The amount of liquidity added
    /// @return amount0 The amount of token0 added
    /// @return amount1 The amount of token1 added
    function swapAndIncreaseLiquidity(SwapAndIncreaseParams calldata params)
        external
        payable
        returns (uint128 liquidity, uint256 amount0, uint256 amount1);

    /// @notice Decrease liquidity and swap to target currency
    /// @param params The parameters for decrease and swap
    /// @return amount The amount of target currency received
    function decreaseAndSwap(DecreaseAndSwapParams calldata params) external returns (uint256 amount);

    /// @notice Collect fees and swap to target currency
    /// @param params The parameters for collect and swap
    /// @return amount The amount of target currency received
    function collectAndSwap(CollectAndSwapParams calldata params) external returns (uint256 amount);

    /// @notice Collect fees and receive both tokens (no swap)
    /// @param params The parameters for collect fees
    /// @return amount0 The amount of token0 received
    /// @return amount1 The amount of token1 received
    function collectFees(CollectFeesParams calldata params) external returns (uint256 amount0, uint256 amount1);

    /// @notice Move position to a new range
    /// @param params The parameters for move range
    /// @return newTokenId The ID of the new position
    /// @return liquidity The amount of liquidity in new position
    function moveRange(MoveRangeParams calldata params) external returns (uint256 newTokenId, uint128 liquidity);

    /// @notice Decrease liquidity and receive both tokens (no swap)
    /// @param params The parameters for decrease liquidity
    /// @return amount0 The amount of token0 received
    /// @return amount1 The amount of token1 received
    function decreaseLiquidity(DecreaseLiquidityParams calldata params) external returns (uint256 amount0, uint256 amount1);

    /// @notice Exit position to a stablecoin (USDC, USDT, or DAI)
    /// @param params The parameters for exit to stablecoin
    /// @return amount The amount of stablecoin received
    function exitToStablecoin(ExitToStablecoinParams calldata params) external returns (uint256 amount);

    /// @notice Get protocol fee percentage (in basis points)
    /// @return fee The protocol fee (e.g., 65 = 0.65%)
    function protocolFee() external view returns (uint256 fee);

    /// @notice Set protocol fee (owner only)
    /// @param newFee New protocol fee in basis points
    function setProtocolFee(uint256 newFee) external;

    /// @notice Withdraw accumulated protocol fees
    /// @param currency The currency to withdraw
    /// @param recipient The recipient address
    function withdrawFees(Currency currency, address recipient) external;

    /// @notice Get accumulated fees for a currency
    /// @param currency The currency to check
    /// @return amount The accumulated fee amount
    function accumulatedFees(Currency currency) external view returns (uint256 amount);
}
