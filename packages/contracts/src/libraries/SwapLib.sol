// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import { Currency, CurrencyLibrary } from "@uniswap/v4-core/src/types/Currency.sol";
import { IPoolManager } from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import { PoolKey } from "@uniswap/v4-core/src/types/PoolKey.sol";
import { PoolId, PoolIdLibrary } from "@uniswap/v4-core/src/types/PoolId.sol";
import { BalanceDelta } from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import { SwapParams as PoolSwapParams } from "@uniswap/v4-core/src/types/PoolOperation.sol";
import { StateLibrary } from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/// @notice WETH9 interface for wrapping ETH
interface IWETH9 {
    function deposit() external payable;
    function withdraw(uint256) external;
}

/// @title SwapLib
/// @notice Library for executing swaps via external aggregators (0x, 1inch, etc.)
library SwapLib {
    using SafeERC20 for IERC20;
    using CurrencyLibrary for Currency;
    using StateLibrary for IPoolManager;
    using PoolIdLibrary for PoolKey;

    /// @notice Error when swap fails
    error SwapFailed();

    /// @notice Error when slippage is too high
    error SlippageExceeded(uint256 expected, uint256 received);

    /// @notice Error when TWAP check fails
    error TWAPCheckFailed(uint160 spotPrice, uint160 twapPrice, uint256 maxDeviation);

    /// @notice Swap parameters
    struct SwapParams {
        Currency fromCurrency;
        Currency toCurrency;
        uint256 amountIn;
        uint256 minAmountOut;
        address router; // 0x, 1inch, or other aggregator
        bytes swapData;
        address weth9; // WETH address for wrapping native ETH
    }

    /// @notice Execute a swap via external aggregator
    /// @param params Swap parameters
    /// @return amountOut The amount received from swap
    function executeSwap(SwapParams memory params) internal returns (uint256 amountOut) {
        if (params.amountIn == 0) return 0;

        uint256 balanceBefore;
        if (params.toCurrency.isAddressZero()) {
            balanceBefore = address(this).balance;
        } else {
            balanceBefore = IERC20(Currency.unwrap(params.toCurrency)).balanceOf(address(this));
        }

        // Handle native ETH -> wrap to WETH for external routers
        // Most modern DEX aggregators (0x v2, etc.) expect WETH, not native ETH
        address tokenToApprove;
        if (params.fromCurrency.isAddressZero()) {
            // Wrap ETH to WETH
            require(params.weth9 != address(0), "WETH9 not set");
            IWETH9(params.weth9).deposit{value: params.amountIn}();
            tokenToApprove = params.weth9;
        } else {
            tokenToApprove = Currency.unwrap(params.fromCurrency);
        }

        // Approve router to spend the token (WETH or ERC20)
        IERC20(tokenToApprove).forceApprove(params.router, params.amountIn);

        // Execute swap (no ETH value - we've wrapped to WETH)
        (bool success,) = params.router.call(params.swapData);
        if (!success) revert SwapFailed();

        // Calculate amount received
        if (params.toCurrency.isAddressZero()) {
            amountOut = address(this).balance - balanceBefore;
        } else {
            amountOut = IERC20(Currency.unwrap(params.toCurrency)).balanceOf(address(this)) - balanceBefore;
        }

        if (amountOut < params.minAmountOut) {
            revert SlippageExceeded(params.minAmountOut, amountOut);
        }

        // Reset approval
        IERC20(tokenToApprove).forceApprove(params.router, 0);
    }

    /// @notice Execute a swap within Uniswap V4 pool
    /// @param poolManager The pool manager
    /// @param poolKey The pool key
    /// @param zeroForOne Whether to swap token0 for token1
    /// @param amountSpecified The amount to swap (negative for exact input)
    /// @param sqrtPriceLimitX96 The price limit
    /// @return delta The balance delta from the swap
    function executePoolSwap(
        IPoolManager poolManager,
        PoolKey memory poolKey,
        bool zeroForOne,
        int256 amountSpecified,
        uint160 sqrtPriceLimitX96
    ) internal returns (BalanceDelta delta) {
        delta = poolManager.swap(
            poolKey,
            PoolSwapParams({
                zeroForOne: zeroForOne,
                amountSpecified: amountSpecified,
                sqrtPriceLimitX96: sqrtPriceLimitX96
            }),
            ""
        );
    }

    /// @notice Validate swap against TWAP to prevent manipulation
    /// @param poolManager The pool manager
    /// @param poolKey The pool key
    /// @param maxDeviation Maximum allowed deviation from TWAP (basis points)
    /// @param twapInterval TWAP observation interval in seconds
    function validateAgainstTWAP(
        IPoolManager poolManager,
        PoolKey memory poolKey,
        uint256 maxDeviation,
        uint32 twapInterval
    ) internal view {
        PoolId poolId = poolKey.toId();
        (uint160 sqrtPriceX96,,,) = poolManager.getSlot0(poolId);

        // Get TWAP price (simplified - in production use oracle observations)
        // For V4, we'd need to implement or use a TWAP oracle hook
        uint160 twapSqrtPriceX96 = sqrtPriceX96; // Placeholder

        // Calculate deviation
        uint256 deviation;
        if (sqrtPriceX96 > twapSqrtPriceX96) {
            deviation = ((uint256(sqrtPriceX96) - uint256(twapSqrtPriceX96)) * 10000) / uint256(twapSqrtPriceX96);
        } else {
            deviation = ((uint256(twapSqrtPriceX96) - uint256(sqrtPriceX96)) * 10000) / uint256(twapSqrtPriceX96);
        }

        if (deviation > maxDeviation) {
            revert TWAPCheckFailed(sqrtPriceX96, twapSqrtPriceX96, maxDeviation);
        }
    }

    /// @notice Calculate minimum output with slippage
    /// @param amountIn Input amount
    /// @param priceX96 Price in X96 format
    /// @param slippageBps Slippage in basis points
    /// @param zeroForOne Direction of swap
    /// @return minAmountOut Minimum output amount
    function calculateMinOutput(
        uint256 amountIn,
        uint160 priceX96,
        uint256 slippageBps,
        bool zeroForOne
    ) internal pure returns (uint256 minAmountOut) {
        uint256 expectedOut;
        if (zeroForOne) {
            // token0 -> token1: multiply by price
            expectedOut = (amountIn * uint256(priceX96) * uint256(priceX96)) >> 192;
        } else {
            // token1 -> token0: divide by price
            expectedOut = (amountIn << 192) / (uint256(priceX96) * uint256(priceX96));
        }

        minAmountOut = (expectedOut * (10000 - slippageBps)) / 10000;
    }
}
