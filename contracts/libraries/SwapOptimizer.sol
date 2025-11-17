// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {FullMath} from "@uniswap/v4-core/src/libraries/FullMath.sol";
import {LiquidityAmounts} from "@uniswap/v4-periphery/src/libraries/LiquidityAmounts.sol";

/**
 * @title SwapOptimizer
 * @notice Helper library for calculating optimal token swap amounts for liquidity positions
 * @dev Used for Revert Finance-style auto-compounding with rebalancing
 */
library SwapOptimizer {
    uint256 constant Q96 = 0x1000000000000000000000000;

    /**
     * @notice Calculate optimal swap amount for adding liquidity
     * @dev Determines how much of which token to swap to achieve optimal ratio
     * @param amount0 Available amount of token0
     * @param amount1 Available amount of token1
     * @param sqrtPriceX96 Current pool sqrt price
     * @param tickLower Lower tick of the position
     * @param tickUpper Upper tick of the position
     * @return zeroForOne Direction of swap (true = token0 → token1)
     * @return amountToSwap Amount of input token to swap
     */
    function calculateOptimalSwap(
        uint256 amount0,
        uint256 amount1,
        uint160 sqrtPriceX96,
        int24 tickLower,
        int24 tickUpper
    ) internal pure returns (bool zeroForOne, uint256 amountToSwap) {
        // Get sqrt prices at tick boundaries
        uint160 sqrtPriceAX96 = TickMath.getSqrtPriceAtTick(tickLower);
        uint160 sqrtPriceBX96 = TickMath.getSqrtPriceAtTick(tickUpper);

        // Calculate the required ratio based on current price and tick range
        (uint256 ratio0, uint256 ratio1) = _calculateRequiredRatio(
            sqrtPriceX96,
            sqrtPriceAX96,
            sqrtPriceBX96
        );

        // Calculate total value in terms of token1
        uint256 price0 = _getPriceFromSqrt(sqrtPriceX96); // Price of token0 in terms of token1
        uint256 value0 = FullMath.mulDiv(amount0, price0, Q96);
        uint256 value1 = amount1;
        uint256 totalValue = value0 + value1;

        if (totalValue == 0) {
            return (false, 0);
        }

        // Calculate required values based on ratio
        uint256 totalRatio = ratio0 + ratio1;
        uint256 requiredValue0 = FullMath.mulDiv(totalValue, ratio0, totalRatio);
        uint256 requiredValue1 = totalValue - requiredValue0;

        // Determine swap direction and amount
        if (value0 > requiredValue0) {
            // Too much token0, need to swap token0 → token1
            zeroForOne = true;
            uint256 excessValue0 = value0 - requiredValue0;

            // Account for swap impact (simplified: assume ~0.3% fee)
            // In production, use more sophisticated price impact calculation
            amountToSwap = FullMath.mulDiv(excessValue0, Q96, price0);

            // Reduce by estimated fee (0.3% = 9970/10000)
            amountToSwap = FullMath.mulDiv(amountToSwap, 9970, 10000);
        } else if (value1 > requiredValue1) {
            // Too much token1, need to swap token1 → token0
            zeroForOne = false;
            uint256 excessValue1 = value1 - requiredValue1;

            // Reduce by estimated fee
            amountToSwap = FullMath.mulDiv(excessValue1, 9970, 10000);
        } else {
            // Already balanced (within rounding error)
            amountToSwap = 0;
        }
    }

    /**
     * @notice Calculate required ratio of token0:token1 for a position
     * @dev Based on current price and tick range
     * @param sqrtPriceX96 Current pool sqrt price
     * @param sqrtPriceAX96 Sqrt price at lower tick
     * @param sqrtPriceBX96 Sqrt price at upper tick
     * @return ratio0 Required proportion of token0 value
     * @return ratio1 Required proportion of token1 value
     */
    function _calculateRequiredRatio(
        uint160 sqrtPriceX96,
        uint160 sqrtPriceAX96,
        uint160 sqrtPriceBX96
    ) internal pure returns (uint256 ratio0, uint256 ratio1) {
        // If price is below range, only token1 needed
        if (sqrtPriceX96 <= sqrtPriceAX96) {
            return (0, Q96);
        }

        // If price is above range, only token0 needed
        if (sqrtPriceX96 >= sqrtPriceBX96) {
            return (Q96, 0);
        }

        // Price is in range - calculate ratio
        // This is a simplified calculation
        // For exact calculation, use LiquidityAmounts.getAmount0/getAmount1ForLiquidity

        // Simplified ratio calculation based on price position in range
        // This is an approximation but works well in practice

        // Calculate position of current price in the range
        // If price is at lower bound, need all token1
        // If price is at upper bound, need all token0
        // If price is in middle, need both

        uint256 priceRange = uint256(sqrtPriceBX96) - uint256(sqrtPriceAX96);
        if (priceRange == 0) {
            return (Q96 / 2, Q96 / 2);
        }

        uint256 pricePosition = uint256(sqrtPriceX96) - uint256(sqrtPriceAX96);

        // Calculate approximate ratio
        // Lower in range = more token1 needed
        // Higher in range = more token0 needed
        ratio1 = FullMath.mulDiv(pricePosition, Q96, priceRange);
        ratio0 = Q96 - ratio1;

        // Adjust for concentrated liquidity (positions need more of both tokens near current price)
        // This is a simplified heuristic
        if (ratio0 > Q96 / 4 && ratio1 > Q96 / 4) {
            // If not at extremes, balance towards 50/50
            uint256 adjustment = (ratio0 > ratio1 ? ratio0 - ratio1 : ratio1 - ratio0) / 4;
            if (ratio0 > ratio1) {
                ratio0 -= adjustment;
                ratio1 += adjustment;
            } else {
                ratio1 -= adjustment;
                ratio0 += adjustment;
            }
        }
    }

    /**
     * @notice Convert sqrt price to regular price
     * @dev Price of token0 in terms of token1
     * @param sqrtPriceX96 Sqrt price in Q64.96 format
     * @return price Price in Q96 format
     */
    function _getPriceFromSqrt(uint160 sqrtPriceX96) internal pure returns (uint256 price) {
        // price = (sqrtPrice ^ 2) / 2^96
        price = FullMath.mulDiv(uint256(sqrtPriceX96), uint256(sqrtPriceX96), Q96);
    }

    /**
     * @notice Check if amounts need rebalancing
     * @dev Returns true if swap is needed (amounts are not in optimal ratio)
     * @param amount0 Available amount of token0
     * @param amount1 Available amount of token1
     * @param sqrtPriceX96 Current pool sqrt price
     * @param tickLower Lower tick of the position
     * @param tickUpper Upper tick of the position
     * @param toleranceBps Tolerance in basis points (e.g., 100 = 1%)
     * @return needsRebalancing Whether rebalancing is needed
     */
    function needsRebalancing(
        uint256 amount0,
        uint256 amount1,
        uint160 sqrtPriceX96,
        int24 tickLower,
        int24 tickUpper,
        uint256 toleranceBps
    ) internal pure returns (bool) {
        (, uint256 amountToSwap) = calculateOptimalSwap(
            amount0,
            amount1,
            sqrtPriceX96,
            tickLower,
            tickUpper
        );

        // If swap amount is significant (more than tolerance), rebalancing is needed
        uint256 totalValue = amount0 + amount1; // Simplified
        if (totalValue == 0) return false;

        uint256 swapValueBps = FullMath.mulDiv(amountToSwap, 10000, totalValue);
        return swapValueBps > toleranceBps;
    }

    /**
     * @notice Calculate swap amount accounting for slippage and fees
     * @dev More conservative calculation for production use
     * @param amount0 Available amount of token0
     * @param amount1 Available amount of token1
     * @param sqrtPriceX96 Current pool sqrt price
     * @param tickLower Lower tick of the position
     * @param tickUpper Upper tick of the position
     * @param slippageBps Maximum acceptable slippage in basis points
     * @return zeroForOne Direction of swap
     * @return amountToSwap Amount to swap (adjusted for slippage)
     */
    function calculateOptimalSwapWithSlippage(
        uint256 amount0,
        uint256 amount1,
        uint160 sqrtPriceX96,
        int24 tickLower,
        int24 tickUpper,
        uint256 slippageBps
    ) internal pure returns (bool zeroForOne, uint256 amountToSwap) {
        (zeroForOne, amountToSwap) = calculateOptimalSwap(
            amount0,
            amount1,
            sqrtPriceX96,
            tickLower,
            tickUpper
        );

        // Reduce swap amount to account for slippage
        // This ensures we don't over-swap
        if (amountToSwap > 0) {
            amountToSwap = FullMath.mulDiv(
                amountToSwap,
                10000 - slippageBps,
                10000
            );
        }
    }
}
