// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import { PoolKey } from "@uniswap/v4-core/src/types/PoolKey.sol";
import { IPoolManager } from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import { PoolId, PoolIdLibrary } from "@uniswap/v4-core/src/types/PoolId.sol";
import { StateLibrary } from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import { TickMath } from "@uniswap/v4-core/src/libraries/TickMath.sol";
import { FullMath } from "@uniswap/v4-core/src/libraries/FullMath.sol";
import { FixedPoint96 } from "@uniswap/v4-core/src/libraries/FixedPoint96.sol";
import { LiquidityAmounts } from "@uniswap/v4-periphery/src/libraries/LiquidityAmounts.sol";

/// @title PositionValueLib
/// @notice Library for calculating position values and amounts
library PositionValueLib {
    using PoolIdLibrary for PoolKey;
    using StateLibrary for IPoolManager;

    /// @notice Position information
    struct PositionInfo {
        PoolKey poolKey;
        int24 tickLower;
        int24 tickUpper;
        uint128 liquidity;
        uint256 feeGrowthInside0LastX128;
        uint256 feeGrowthInside1LastX128;
        uint128 tokensOwed0;
        uint128 tokensOwed1;
    }

    /// @notice Calculate the amounts of tokens in a position
    /// @param poolManager The pool manager
    /// @param poolKey The pool key
    /// @param tickLower Lower tick of the position
    /// @param tickUpper Upper tick of the position
    /// @param liquidity The liquidity amount
    /// @return amount0 The amount of token0
    /// @return amount1 The amount of token1
    function getAmountsForLiquidity(
        IPoolManager poolManager,
        PoolKey memory poolKey,
        int24 tickLower,
        int24 tickUpper,
        uint128 liquidity
    ) internal view returns (uint256 amount0, uint256 amount1) {
        (uint160 sqrtPriceX96, int24 tick,,) = poolManager.getSlot0(poolKey.toId());

        uint160 sqrtRatioAX96 = TickMath.getSqrtPriceAtTick(tickLower);
        uint160 sqrtRatioBX96 = TickMath.getSqrtPriceAtTick(tickUpper);

        // Calculate amounts based on current price position
        if (sqrtPriceX96 <= sqrtRatioAX96) {
            // Current price below range - all token0
            amount0 = FullMath.mulDiv(
                uint256(liquidity) << FixedPoint96.RESOLUTION,
                sqrtRatioBX96 - sqrtRatioAX96,
                sqrtRatioBX96
            ) / sqrtRatioAX96;
        } else if (sqrtPriceX96 < sqrtRatioBX96) {
            // Current price in range
            amount0 = FullMath.mulDiv(
                uint256(liquidity) << FixedPoint96.RESOLUTION,
                sqrtRatioBX96 - sqrtPriceX96,
                sqrtRatioBX96
            ) / sqrtPriceX96;
            amount1 = FullMath.mulDiv(
                liquidity,
                sqrtPriceX96 - sqrtRatioAX96,
                FixedPoint96.Q96
            );
        } else {
            // Current price above range - all token1
            amount1 = FullMath.mulDiv(
                liquidity,
                sqrtRatioBX96 - sqrtRatioAX96,
                FixedPoint96.Q96
            );
        }
    }

    /// @notice Calculate the USD value of a position
    /// @param amount0 Amount of token0
    /// @param amount1 Amount of token1
    /// @param price0 Price of token0 in USD (scaled by 1e18)
    /// @param price1 Price of token1 in USD (scaled by 1e18)
    /// @param decimals0 Decimals of token0
    /// @param decimals1 Decimals of token1
    /// @return value The USD value (scaled by 1e18)
    function calculateUSDValue(
        uint256 amount0,
        uint256 amount1,
        uint256 price0,
        uint256 price1,
        uint8 decimals0,
        uint8 decimals1
    ) internal pure returns (uint256 value) {
        // Normalize to 18 decimals and multiply by price
        uint256 value0 = FullMath.mulDiv(amount0, price0, 10 ** decimals0);
        uint256 value1 = FullMath.mulDiv(amount1, price1, 10 ** decimals1);
        value = value0 + value1;
    }

    /// @notice Calculate liquidity for given amounts
    /// @param poolManager The pool manager
    /// @param poolKey The pool key
    /// @param tickLower Lower tick
    /// @param tickUpper Upper tick
    /// @param amount0 Desired amount of token0
    /// @param amount1 Desired amount of token1
    /// @return liquidity The calculated liquidity
    function getLiquidityForAmounts(
        IPoolManager poolManager,
        PoolKey memory poolKey,
        int24 tickLower,
        int24 tickUpper,
        uint256 amount0,
        uint256 amount1
    ) internal view returns (uint128 liquidity) {
        (uint160 sqrtPriceX96,,,) = poolManager.getSlot0(poolKey.toId());

        uint160 sqrtRatioAX96 = TickMath.getSqrtPriceAtTick(tickLower);
        uint160 sqrtRatioBX96 = TickMath.getSqrtPriceAtTick(tickUpper);

        liquidity = LiquidityAmounts.getLiquidityForAmounts(
            sqrtPriceX96,
            sqrtRatioAX96,
            sqrtRatioBX96,
            amount0,
            amount1
        );
    }

    /// @notice Check if a position is in range
    /// @param poolManager The pool manager
    /// @param poolKey The pool key
    /// @param tickLower Lower tick
    /// @param tickUpper Upper tick
    /// @return inRange Whether the position is in range
    /// @return currentTick The current pool tick
    function isInRange(
        IPoolManager poolManager,
        PoolKey memory poolKey,
        int24 tickLower,
        int24 tickUpper
    ) internal view returns (bool inRange, int24 currentTick) {
        (, currentTick,,) = poolManager.getSlot0(poolKey.toId());
        inRange = currentTick >= tickLower && currentTick < tickUpper;
    }

    /// @notice Calculate optimal token ratio for a range
    /// @dev L-NEW-02: Converts amount0 to token1 value using sqrtPriceX96 before computing ratio,
    ///      so tokens with different decimals are compared in a common denomination.
    /// @param sqrtPriceX96 Current sqrt price
    /// @param tickLower Lower tick
    /// @param tickUpper Upper tick
    /// @return ratio0 Ratio of token0 value (basis points, where 10000 = 100%)
    /// @return ratio1 Ratio of token1 value (basis points)
    function calculateOptimalRatio(
        uint160 sqrtPriceX96,
        int24 tickLower,
        int24 tickUpper
    ) internal pure returns (uint256 ratio0, uint256 ratio1) {
        uint160 sqrtRatioAX96 = TickMath.getSqrtPriceAtTick(tickLower);
        uint160 sqrtRatioBX96 = TickMath.getSqrtPriceAtTick(tickUpper);

        // Use a reference liquidity to calculate amounts
        uint128 refLiquidity = 1e18;

        uint256 amount0;
        uint256 amount1;

        // Calculate amounts based on current price position
        if (sqrtPriceX96 <= sqrtRatioAX96) {
            // Current price below range - all token0
            amount0 = FullMath.mulDiv(
                uint256(refLiquidity) << FixedPoint96.RESOLUTION,
                sqrtRatioBX96 - sqrtRatioAX96,
                sqrtRatioBX96
            ) / sqrtRatioAX96;
        } else if (sqrtPriceX96 < sqrtRatioBX96) {
            // Current price in range
            amount0 = FullMath.mulDiv(
                uint256(refLiquidity) << FixedPoint96.RESOLUTION,
                sqrtRatioBX96 - sqrtPriceX96,
                sqrtRatioBX96
            ) / sqrtPriceX96;
            amount1 = FullMath.mulDiv(
                refLiquidity,
                sqrtPriceX96 - sqrtRatioAX96,
                FixedPoint96.Q96
            );
        } else {
            // Current price above range - all token1
            amount1 = FullMath.mulDiv(
                refLiquidity,
                sqrtRatioBX96 - sqrtRatioAX96,
                FixedPoint96.Q96
            );
        }

        // Convert amount0 to token1 value using price so tokens with different
        // decimals are compared in the same denomination
        // value0InToken1 = amount0 * (sqrtPriceX96 / Q96)^2
        uint256 Q96 = FixedPoint96.Q96;
        uint256 value0InToken1 = FullMath.mulDiv(
            FullMath.mulDiv(amount0, sqrtPriceX96, Q96),
            sqrtPriceX96,
            Q96
        );
        uint256 total = value0InToken1 + amount1;
        if (total == 0) {
            ratio0 = 5000;
            ratio1 = 5000;
        } else {
            ratio0 = (value0InToken1 * 10000) / total;
            ratio1 = 10000 - ratio0;
        }
    }

    /// @notice Calculate the swap amount needed to achieve optimal ratio
    /// @param amount0Available Amount of token0 available
    /// @param amount1Available Amount of token1 available
    /// @param sqrtPriceX96 Current sqrt price
    /// @param tickLower Lower tick
    /// @param tickUpper Upper tick
    /// @return zeroForOne Whether to swap token0 for token1
    /// @return swapAmount Amount to swap
    function calculateSwapForOptimalRatio(
        uint256 amount0Available,
        uint256 amount1Available,
        uint160 sqrtPriceX96,
        int24 tickLower,
        int24 tickUpper
    ) internal pure returns (bool zeroForOne, uint256 swapAmount) {
        (uint256 ratio0,) = calculateOptimalRatio(sqrtPriceX96, tickLower, tickUpper);

        // Calculate current price from sqrtPriceX96
        // H-01: Use nested FullMath.mulDiv to avoid uint256 overflow for large sqrtPriceX96 values
        uint256 price = FullMath.mulDiv(
            FullMath.mulDiv(uint256(sqrtPriceX96), uint256(sqrtPriceX96), 1 << 96),
            1e18,
            1 << 96
        );

        // Total value in terms of token1
        uint256 totalValue = FullMath.mulDiv(amount0Available, price, 1e18) + amount1Available;

        // Optimal amounts
        uint256 optimalAmount0Value = FullMath.mulDiv(totalValue, ratio0, 10000);
        uint256 currentAmount0Value = FullMath.mulDiv(amount0Available, price, 1e18);

        if (currentAmount0Value > optimalAmount0Value) {
            // Need to swap token0 for token1
            zeroForOne = true;
            uint256 excessValue = currentAmount0Value - optimalAmount0Value;
            swapAmount = FullMath.mulDiv(excessValue, 1e18, price);
        } else {
            // Need to swap token1 for token0
            zeroForOne = false;
            swapAmount = optimalAmount0Value - currentAmount0Value;
        }
    }
}
