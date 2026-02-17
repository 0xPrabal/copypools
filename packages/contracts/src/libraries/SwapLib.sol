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
import { FullMath } from "@uniswap/v4-core/src/libraries/FullMath.sol";

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

        // When target is native ETH, DEX aggregators return WETH, so we track WETH balance
        // and unwrap it after the swap
        bool targetIsNative = params.toCurrency.isAddressZero();
        address targetToken = targetIsNative ? params.weth9 : Currency.unwrap(params.toCurrency);

        uint256 balanceBefore;
        if (targetIsNative) {
            // Track WETH balance since swap returns WETH
            require(params.weth9 != address(0), "WETH9 not set");
            balanceBefore = IERC20(params.weth9).balanceOf(address(this));
        } else {
            balanceBefore = IERC20(targetToken).balanceOf(address(this));
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
        if (targetIsNative) {
            // Swap returned WETH, calculate how much we received
            amountOut = IERC20(params.weth9).balanceOf(address(this)) - balanceBefore;
            // Unwrap WETH to native ETH
            if (amountOut > 0) {
                IWETH9(params.weth9).withdraw(amountOut);
            }
        } else {
            amountOut = IERC20(targetToken).balanceOf(address(this)) - balanceBefore;
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
    /// @dev Not yet implemented — requires a TWAP oracle hook for V4.
    ///      Calling this function will revert unconditionally.
    function validateAgainstTWAP(
        IPoolManager,
        PoolKey memory,
        uint256,
        uint32
    ) internal pure {
        revert("TWAP not implemented");
    }

    /// @notice Calculate minimum output with slippage
    /// @param amountIn Input amount
    /// @param priceX96 Price in X96 format (sqrtPriceX96 from pool)
    /// @param slippageBps Slippage in basis points
    /// @param zeroForOne Direction of swap
    /// @return minAmountOut Minimum output amount
    function calculateMinOutput(
        uint256 amountIn,
        uint160 priceX96,
        uint256 slippageBps,
        bool zeroForOne
    ) internal pure returns (uint256 minAmountOut) {
        if (amountIn == 0 || priceX96 == 0) return 0;

        uint256 Q96 = 1 << 96;
        uint256 expectedOut;
        if (zeroForOne) {
            // token0 -> token1: multiply by (price/Q96)^2
            // Split to avoid overflow: (amountIn * priceX96 / Q96) * priceX96 / Q96
            expectedOut = FullMath.mulDiv(FullMath.mulDiv(amountIn, priceX96, Q96), priceX96, Q96);
        } else {
            // token1 -> token0: divide by (price/Q96)^2
            // Split to avoid overflow: (amountIn * Q96 / priceX96) * Q96 / priceX96
            expectedOut = FullMath.mulDiv(FullMath.mulDiv(amountIn, Q96, priceX96), Q96, priceX96);
        }

        minAmountOut = (expectedOut * (10000 - slippageBps)) / 10000;
    }
}
