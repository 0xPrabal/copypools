// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import { IPoolManager } from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import { IUnlockCallback } from "@uniswap/v4-core/src/interfaces/callback/IUnlockCallback.sol";
import { PoolKey } from "@uniswap/v4-core/src/types/PoolKey.sol";
import { PoolIdLibrary } from "@uniswap/v4-core/src/types/PoolId.sol";
import { Currency, CurrencyLibrary } from "@uniswap/v4-core/src/types/Currency.sol";
import { BalanceDelta } from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import { SwapParams } from "@uniswap/v4-core/src/types/PoolOperation.sol";
import { StateLibrary } from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import { TickMath } from "@uniswap/v4-core/src/libraries/TickMath.sol";
import { Actions } from "@uniswap/v4-periphery/src/libraries/Actions.sol";
import { IERC721 } from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import { LiquidityAmounts } from "@uniswap/v4-periphery/src/libraries/LiquidityAmounts.sol";

import { V4Base } from "../base/V4Base.sol";
import { Multicall } from "../base/Multicall.sol";
import { IV4Utils } from "../interfaces/IV4Utils.sol";
import { SwapLib } from "../libraries/SwapLib.sol";

/// @title V4Utils
/// @notice Utility contract for atomic operations on Uniswap V4 positions
/// @dev Stateless contract that performs swap+mint, swap+increase, decrease+swap, collect+swap, and move range
contract V4Utils is V4Base, Multicall, IV4Utils, IUnlockCallback {
    using SafeERC20 for IERC20;
    using CurrencyLibrary for Currency;
    using PoolIdLibrary for PoolKey;
    using StateLibrary for IPoolManager;

    /// @notice Contract version
    string public constant VERSION = "1.0.0";

    /// @notice Maximum swap slippage (50%)
    uint256 public constant MAX_SLIPPAGE = 5000;

    /// @notice Protocol fee in basis points (0.65%)
    uint256 public override protocolFee = 65;

    /// @notice Maximum protocol fee (10%)
    uint256 public constant MAX_PROTOCOL_FEE = 1000;

    /// @notice Accumulated protocol fees by currency
    mapping(Currency => uint256) public override accumulatedFees;

    /// @notice Storage gap for upgrades
    uint256[48] private __gap;

    /// @notice Constructor
    constructor(
        address _poolManager,
        address _positionManager,
        address _weth9
    ) V4Base(_poolManager, _positionManager, _weth9) {}

    /// @notice Initialize the contract
    function initialize(address _owner) external initializer {
        __V4Base_init(_owner);
    }

    /// @inheritdoc IV4Utils
    function swapAndMint(SwapAndMintParams calldata params)
        external
        payable
        override
        nonReentrant
        whenNotPaused
        checkDeadline(params.deadline)
        returns (uint256 tokenId, uint128 liquidity, uint256 amount0, uint256 amount1)
    {
        uint256 balance0;
        uint256 balance1;

        // Handle native ETH specially to avoid double-counting msg.value
        // When swapSourceCurrency == currency0 == native ETH, msg.value covers both
        bool swapSourceIsNative = params.swapSourceCurrency.isAddressZero();
        bool currency0IsNative = params.poolKey.currency0.isAddressZero();
        bool currency1IsNative = params.poolKey.currency1.isAddressZero();

        if (params.swapSourceAmount > 0 && swapSourceIsNative && currency0IsNative) {
            // Native ETH case: msg.value = amount0Desired + swapSourceAmount
            // Don't receive separately - just track that we have msg.value total
            balance0 = msg.value; // Will be updated after swap
            balance1 = _receiveTokens(params.poolKey.currency1, params.amount1Desired);

            // Execute swap with the swap portion
            _executeOptimalSwap(
                params.swapSourceCurrency,
                params.poolKey,
                params.tickLower,
                params.tickUpper,
                params.swapSourceAmount, // Use exact swap amount, not full msg.value
                params.swapData,
                params.maxSwapSlippage
            );

            // Update balances after swap
            balance0 = _getBalance(params.poolKey.currency0);
            balance1 = _getBalance(params.poolKey.currency1);
        } else if (params.swapSourceAmount > 0 && swapSourceIsNative && currency1IsNative) {
            // Native ETH is token1 and swap source
            balance0 = _receiveTokens(params.poolKey.currency0, params.amount0Desired);
            balance1 = msg.value; // Will be updated after swap

            _executeOptimalSwap(
                params.swapSourceCurrency,
                params.poolKey,
                params.tickLower,
                params.tickUpper,
                params.swapSourceAmount,
                params.swapData,
                params.maxSwapSlippage
            );

            balance0 = _getBalance(params.poolKey.currency0);
            balance1 = _getBalance(params.poolKey.currency1);
        } else {
            // Standard case: transfer input tokens separately
            balance0 = _receiveTokens(params.poolKey.currency0, params.amount0Desired);
            balance1 = _receiveTokens(params.poolKey.currency1, params.amount1Desired);

            // If swap source is provided, execute swap
            if (params.swapSourceAmount > 0) {
                uint256 swapBalance = _receiveTokens(params.swapSourceCurrency, params.swapSourceAmount);
                _executeOptimalSwap(
                    params.swapSourceCurrency,
                    params.poolKey,
                    params.tickLower,
                    params.tickUpper,
                    swapBalance,
                    params.swapData,
                    params.maxSwapSlippage
                );

                // Update balances after swap
                balance0 = _getBalance(params.poolKey.currency0);
                balance1 = _getBalance(params.poolKey.currency1);
            }
        }

        // Calculate liquidity from amounts
        (uint160 sqrtPriceX96,,,) = poolManager.getSlot0(params.poolKey.toId());
        liquidity = LiquidityAmounts.getLiquidityForAmounts(
            sqrtPriceX96,
            TickMath.getSqrtPriceAtTick(params.tickLower),
            TickMath.getSqrtPriceAtTick(params.tickUpper),
            balance0,
            balance1
        );

        // Mint position via PositionManager
        (tokenId, amount0, amount1) = _mintPosition(
            params.poolKey,
            params.tickLower,
            params.tickUpper,
            liquidity,
            params.amount0Max,
            params.amount1Max,
            params.recipient
        );

        // Refund excess tokens
        _refundExcess(params.poolKey.currency0, params.recipient, balance0 - amount0);
        _refundExcess(params.poolKey.currency1, params.recipient, balance1 - amount1);

        emit PositionMinted(tokenId, params.recipient, params.poolKey, params.tickLower, params.tickUpper, liquidity);
    }

    /// @inheritdoc IV4Utils
    function swapAndIncreaseLiquidity(SwapAndIncreaseParams calldata params)
        external
        payable
        override
        nonReentrant
        whenNotPaused
        checkDeadline(params.deadline)
        onlyPositionOwnerOrApproved(params.tokenId)
        returns (uint128 liquidity, uint256 amount0, uint256 amount1)
    {
        (PoolKey memory poolKey, int24 tickLower, int24 tickUpper,) = getPositionInfo(params.tokenId);

        uint256 balance0;
        uint256 balance1;

        // Handle native ETH specially to avoid double-counting msg.value
        // When swapSourceCurrency == currency0 == native ETH, msg.value covers both
        bool swapSourceIsNative = params.swapSourceCurrency.isAddressZero();
        bool currency0IsNative = poolKey.currency0.isAddressZero();
        bool currency1IsNative = poolKey.currency1.isAddressZero();

        if (params.swapSourceAmount > 0 && swapSourceIsNative && currency0IsNative) {
            // Native ETH case: msg.value = amount0Desired + swapSourceAmount
            // Don't receive separately - just track that we have msg.value total
            balance0 = msg.value; // Will be updated after swap
            balance1 = _receiveTokens(poolKey.currency1, params.amount1Desired);

            // Execute swap with the swap portion
            _executeOptimalSwap(
                params.swapSourceCurrency,
                poolKey,
                tickLower,
                tickUpper,
                params.swapSourceAmount, // Use exact swap amount, not full msg.value
                params.swapData,
                params.maxSwapSlippage
            );

            // Update balances after swap
            balance0 = _getBalance(poolKey.currency0);
            balance1 = _getBalance(poolKey.currency1);
        } else if (params.swapSourceAmount > 0 && swapSourceIsNative && currency1IsNative) {
            // Native ETH is token1 and swap source
            balance0 = _receiveTokens(poolKey.currency0, params.amount0Desired);
            balance1 = msg.value; // Will be updated after swap

            _executeOptimalSwap(
                params.swapSourceCurrency,
                poolKey,
                tickLower,
                tickUpper,
                params.swapSourceAmount,
                params.swapData,
                params.maxSwapSlippage
            );

            balance0 = _getBalance(poolKey.currency0);
            balance1 = _getBalance(poolKey.currency1);
        } else {
            // Standard case: transfer input tokens separately
            balance0 = _receiveTokens(poolKey.currency0, params.amount0Desired);
            balance1 = _receiveTokens(poolKey.currency1, params.amount1Desired);

            // If swap source is provided, execute swap
            if (params.swapSourceAmount > 0) {
                uint256 swapBalance = _receiveTokens(params.swapSourceCurrency, params.swapSourceAmount);
                _executeOptimalSwap(
                    params.swapSourceCurrency,
                    poolKey,
                    tickLower,
                    tickUpper,
                    swapBalance,
                    params.swapData,
                    params.maxSwapSlippage
                );

                balance0 = _getBalance(poolKey.currency0);
                balance1 = _getBalance(poolKey.currency1);
            }
        }

        // Calculate liquidity
        (uint160 sqrtPriceX96,,,) = poolManager.getSlot0(poolKey.toId());
        liquidity = LiquidityAmounts.getLiquidityForAmounts(
            sqrtPriceX96,
            TickMath.getSqrtPriceAtTick(tickLower),
            TickMath.getSqrtPriceAtTick(tickUpper),
            balance0,
            balance1
        );

        // Increase liquidity
        (amount0, amount1) = _increaseLiquidity(
            params.tokenId,
            liquidity,
            params.amount0Max,
            params.amount1Max
        );

        // Refund excess
        address owner = IERC721(address(positionManager)).ownerOf(params.tokenId);
        _refundExcess(poolKey.currency0, owner, balance0 - amount0);
        _refundExcess(poolKey.currency1, owner, balance1 - amount1);

        emit LiquidityIncreased(params.tokenId, liquidity, amount0, amount1);
    }

    /// @inheritdoc IV4Utils
    function decreaseAndSwap(DecreaseAndSwapParams calldata params)
        external
        override
        nonReentrant
        whenNotPaused
        checkDeadline(params.deadline)
        onlyPositionOwnerOrApproved(params.tokenId)
        returns (uint256 amount)
    {
        (PoolKey memory poolKey,,, uint128 currentLiquidity) = getPositionInfo(params.tokenId);
        address owner = IERC721(address(positionManager)).ownerOf(params.tokenId);

        // Decrease liquidity
        (uint256 amount0, uint256 amount1) = _decreaseLiquidity(
            params.tokenId,
            params.liquidity,
            params.amount0Min,
            params.amount1Min
        );

        emit LiquidityDecreased(params.tokenId, params.liquidity, amount0, amount1);

        // Only collect fees if position still has liquidity after decrease
        // (cannot call DECREASE_LIQUIDITY with delta=0 on empty positions)
        if (currentLiquidity > params.liquidity) {
            (uint256 fees0, uint256 fees1) = _collectFees(params.tokenId, address(this));
            amount0 += fees0;
            amount1 += fees1;
        }

        // Swap to target currency
        if (!(poolKey.currency0 == params.targetCurrency) && amount0 > 0) {
            amount += _swapToTarget(poolKey.currency0, params.targetCurrency, amount0, params.swapData, params.maxSwapSlippage);
        } else {
            amount += amount0;
        }

        if (!(poolKey.currency1 == params.targetCurrency) && amount1 > 0) {
            amount += _swapToTarget(poolKey.currency1, params.targetCurrency, amount1, params.swapData, params.maxSwapSlippage);
        } else {
            amount += amount1;
        }

        // Transfer to owner
        _transferCurrency(params.targetCurrency, owner, amount);
    }

    /// @inheritdoc IV4Utils
    function collectAndSwap(CollectAndSwapParams calldata params)
        external
        override
        nonReentrant
        whenNotPaused
        checkDeadline(params.deadline)
        onlyPositionOwnerOrApproved(params.tokenId)
        returns (uint256 amount)
    {
        (PoolKey memory poolKey,,,) = getPositionInfo(params.tokenId);
        address owner = IERC721(address(positionManager)).ownerOf(params.tokenId);

        // Collect fees
        (uint256 amount0, uint256 amount1) = _collectFees(params.tokenId, address(this));

        emit FeesCollected(params.tokenId, amount0, amount1);

        // Swap to target
        if (!(poolKey.currency0 == params.targetCurrency) && amount0 > 0) {
            amount += _swapToTarget(poolKey.currency0, params.targetCurrency, amount0, params.swapData, params.maxSwapSlippage);
        } else {
            amount += amount0;
        }

        if (!(poolKey.currency1 == params.targetCurrency) && amount1 > 0) {
            amount += _swapToTarget(poolKey.currency1, params.targetCurrency, amount1, params.swapData, params.maxSwapSlippage);
        } else {
            amount += amount1;
        }

        // Transfer to owner
        _transferCurrency(params.targetCurrency, owner, amount);
    }

    /// @inheritdoc IV4Utils
    function collectFees(CollectFeesParams calldata params)
        external
        override
        nonReentrant
        whenNotPaused
        checkDeadline(params.deadline)
        onlyPositionOwnerOrApproved(params.tokenId)
        returns (uint256 amount0, uint256 amount1)
    {
        (PoolKey memory poolKey,,,) = getPositionInfo(params.tokenId);
        address owner = IERC721(address(positionManager)).ownerOf(params.tokenId);

        // Collect fees - tokens go to this contract first
        (amount0, amount1) = _collectFees(params.tokenId, address(this));

        emit FeesCollected(params.tokenId, amount0, amount1);

        // Transfer both tokens to owner
        _transferCurrency(poolKey.currency0, owner, amount0);
        _transferCurrency(poolKey.currency1, owner, amount1);
    }

    /// @inheritdoc IV4Utils
    function decreaseLiquidity(DecreaseLiquidityParams calldata params)
        external
        override
        nonReentrant
        whenNotPaused
        checkDeadline(params.deadline)
        onlyPositionOwnerOrApproved(params.tokenId)
        returns (uint256 amount0, uint256 amount1)
    {
        (PoolKey memory poolKey,,, uint128 currentLiquidity) = getPositionInfo(params.tokenId);
        address owner = IERC721(address(positionManager)).ownerOf(params.tokenId);

        // Use all liquidity if 0 is specified
        uint128 liquidityToRemove = params.liquidity == 0 ? currentLiquidity : params.liquidity;

        // Decrease liquidity - tokens go to this contract first
        (amount0, amount1) = _decreaseLiquidity(
            params.tokenId,
            liquidityToRemove,
            params.amount0Min,
            params.amount1Min
        );

        emit LiquidityDecreased(params.tokenId, liquidityToRemove, amount0, amount1);

        // Collect any accumulated fees as well (only if position still has liquidity)
        if (currentLiquidity > liquidityToRemove) {
            (uint256 fees0, uint256 fees1) = _collectFees(params.tokenId, address(this));
            amount0 += fees0;
            amount1 += fees1;
            if (fees0 > 0 || fees1 > 0) {
                emit FeesCollected(params.tokenId, fees0, fees1);
            }
        }

        // Transfer both tokens to owner
        _transferCurrency(poolKey.currency0, owner, amount0);
        _transferCurrency(poolKey.currency1, owner, amount1);
    }

    /// @inheritdoc IV4Utils
    function exitToStablecoin(ExitToStablecoinParams calldata params)
        external
        override
        nonReentrant
        whenNotPaused
        checkDeadline(params.deadline)
        onlyPositionOwnerOrApproved(params.tokenId)
        returns (uint256 amount)
    {
        (PoolKey memory poolKey,,, uint128 currentLiquidity) = getPositionInfo(params.tokenId);
        address owner = IERC721(address(positionManager)).ownerOf(params.tokenId);

        // Use all liquidity if 0 is specified
        uint128 liquidityToRemove = params.liquidity == 0 ? currentLiquidity : params.liquidity;

        // Decrease liquidity
        (uint256 amount0, uint256 amount1) = _decreaseLiquidity(
            params.tokenId,
            liquidityToRemove,
            0, // No minimum for decrease - slippage protection is on final amount
            0
        );

        emit LiquidityDecreased(params.tokenId, liquidityToRemove, amount0, amount1);

        // Collect any accumulated fees as well (only if position still has liquidity)
        if (currentLiquidity > liquidityToRemove) {
            (uint256 fees0, uint256 fees1) = _collectFees(params.tokenId, address(this));
            amount0 += fees0;
            amount1 += fees1;
        }

        // Swap token0 to stablecoin if not already the stablecoin
        if (!(poolKey.currency0 == params.targetStablecoin) && amount0 > 0) {
            if (params.swapData0.length > 0) {
                amount += _swapToTarget(poolKey.currency0, params.targetStablecoin, amount0, params.swapData0, params.maxSwapSlippage);
            } else {
                // No swap data - try internal pool swap
                amount += _internalSwapToStable(poolKey.currency0, params.targetStablecoin, amount0);
            }
        } else {
            amount += amount0;
        }

        // Swap token1 to stablecoin if not already the stablecoin
        if (!(poolKey.currency1 == params.targetStablecoin) && amount1 > 0) {
            if (params.swapData1.length > 0) {
                amount += _swapToTarget(poolKey.currency1, params.targetStablecoin, amount1, params.swapData1, params.maxSwapSlippage);
            } else {
                // No swap data - try internal pool swap
                amount += _internalSwapToStable(poolKey.currency1, params.targetStablecoin, amount1);
            }
        } else {
            amount += amount1;
        }

        // Validate minimum output
        require(amount >= params.minAmountOut, "Insufficient output");

        // Transfer stablecoin to owner
        _transferCurrency(params.targetStablecoin, owner, amount);
    }

    /// @notice Internal swap to stablecoin without external router
    /// @dev Falls back to zero if no direct pool exists
    function _internalSwapToStable(
        Currency fromCurrency,
        Currency toStablecoin,
        uint256 amount
    ) internal returns (uint256) {
        // If currencies are the same, return amount directly
        if (fromCurrency == toStablecoin) return amount;

        // For now, if no swap data provided and currencies differ, just return 0
        // User should provide swap data for proper conversion
        // In future, could implement direct pool lookup and swap
        return 0;
    }

    /// @inheritdoc IV4Utils
    function moveRange(MoveRangeParams calldata params)
        external
        override
        nonReentrant
        whenNotPaused
        checkDeadline(params.deadline)
        onlyPositionOwnerOrApproved(params.tokenId)
        returns (uint256 newTokenId, uint128 liquidity)
    {
        (PoolKey memory poolKey, int24 oldTickLower, int24 oldTickUpper, uint128 oldLiquidity) =
            getPositionInfo(params.tokenId);
        address owner = IERC721(address(positionManager)).ownerOf(params.tokenId);

        uint128 liquidityToMove = params.liquidityToMove == 0 ? oldLiquidity : params.liquidityToMove;

        // Decrease liquidity from old position (accept any amount)
        (uint256 amount0, uint256 amount1) = _decreaseLiquidity(
            params.tokenId,
            liquidityToMove,
            0, // No minimum for decrease - slippage protection is on the mint
            0
        );

        // Only collect fees if position still has liquidity after decrease
        // (cannot call DECREASE_LIQUIDITY with delta=0 on empty positions)
        if (oldLiquidity > liquidityToMove) {
            (uint256 fees0, uint256 fees1) = _collectFees(params.tokenId, address(this));
            amount0 += fees0;
            amount1 += fees1;
        }

        // Execute swap if needed for optimal ratio
        if (params.swapData.length > 0) {
            _executeOptimalSwap(
                poolKey.currency0, // Use token0 as reference
                poolKey,
                params.newTickLower,
                params.newTickUpper,
                0, // No additional amount
                params.swapData,
                params.maxSwapSlippage
            );
        } else {
            // Auto-swap: if no external swap data provided, perform internal swap through PoolManager
            // This handles the case of moving from out-of-range (single token) to in-range (both tokens)
            _autoSwapForRange(poolKey, params.newTickLower, params.newTickUpper, params.maxSwapSlippage);
        }

        // Calculate new liquidity
        (uint160 sqrtPriceX96,,,) = poolManager.getSlot0(poolKey.toId());
        uint256 balance0 = _getBalance(poolKey.currency0);
        uint256 balance1 = _getBalance(poolKey.currency1);

        liquidity = LiquidityAmounts.getLiquidityForAmounts(
            sqrtPriceX96,
            TickMath.getSqrtPriceAtTick(params.newTickLower),
            TickMath.getSqrtPriceAtTick(params.newTickUpper),
            balance0,
            balance1
        );

        // Mint new position
        (newTokenId, amount0, amount1) = _mintPosition(
            poolKey,
            params.newTickLower,
            params.newTickUpper,
            liquidity,
            params.amount0Max,
            params.amount1Max,
            owner
        );

        // Refund any excess
        _refundExcess(poolKey.currency0, owner, balance0 - amount0);
        _refundExcess(poolKey.currency1, owner, balance1 - amount1);

        emit RangeMoved(params.tokenId, newTokenId, params.newTickLower, params.newTickUpper);
    }

    /// @inheritdoc IV4Utils
    function unwrapWETH9(uint256 minAmount, address recipient) external payable override {
        uint256 balance = IERC20(WETH9).balanceOf(address(this));
        if (balance < minAmount) revert InsufficientAmount();

        if (balance > 0) {
            // Unwrap WETH
            (bool success,) = WETH9.call(abi.encodeWithSignature("withdraw(uint256)", balance));
            require(success, "WETH unwrap failed");

            // Transfer ETH
            (success,) = recipient.call{value: balance}("");
            require(success, "ETH transfer failed");
        }
    }

    /// @inheritdoc IV4Utils
    function sweepToken(Currency currency, uint256 minAmount, address recipient) external payable override {
        uint256 balance = _getBalance(currency);
        if (balance < minAmount) revert InsufficientAmount();

        if (balance > 0) {
            _transferCurrency(currency, recipient, balance);
        }
    }

    /// @inheritdoc IV4Utils
    function refundETH() external payable override {
        if (address(this).balance > 0) {
            (bool success,) = msg.sender.call{value: address(this).balance}("");
            require(success, "ETH refund failed");
        }
    }

    /// @inheritdoc IV4Utils
    function setProtocolFee(uint256 newFee) external override onlyOwner {
        require(newFee <= MAX_PROTOCOL_FEE, "Fee too high");
        emit ProtocolFeeUpdated(protocolFee, newFee);
        protocolFee = newFee;
    }

    /// @inheritdoc IV4Utils
    function withdrawFees(Currency currency, address recipient) external override onlyOwner {
        uint256 amount = accumulatedFees[currency];
        require(amount > 0, "No fees");

        accumulatedFees[currency] = 0;
        _transferCurrency(currency, recipient, amount);

        emit FeesWithdrawn(recipient, currency, amount);
    }

    // ============ Internal Functions ============

    function _receiveTokens(Currency currency, uint256 amount) internal returns (uint256) {
        if (amount == 0) return 0;

        if (currency.isAddressZero()) {
            return msg.value;
        } else {
            IERC20 token = IERC20(Currency.unwrap(currency));
            uint256 balanceBefore = token.balanceOf(address(this));
            token.safeTransferFrom(msg.sender, address(this), amount);
            return token.balanceOf(address(this)) - balanceBefore;
        }
    }

    function _getBalance(Currency currency) internal view returns (uint256) {
        if (currency.isAddressZero()) {
            return address(this).balance;
        } else {
            return IERC20(Currency.unwrap(currency)).balanceOf(address(this));
        }
    }

    /// @notice Take protocol fee from swap output
    /// @param currency The currency to take fee from
    /// @param amount The amount before fee
    /// @return amountAfterFee The amount after fee deduction
    function _takeSwapFee(Currency currency, uint256 amount) internal returns (uint256 amountAfterFee) {
        if (amount == 0 || protocolFee == 0) return amount;

        uint256 fee = amount * protocolFee / 10000;
        accumulatedFees[currency] += fee;
        amountAfterFee = amount - fee;

        emit SwapFeeTaken(currency, fee);
    }

    function _refundExcess(Currency currency, address to, uint256 amount) internal {
        if (amount > 0) {
            _transferCurrency(currency, to, amount);
        }
    }

    function _executeOptimalSwap(
        Currency sourceCurrency,
        PoolKey memory poolKey,
        int24 tickLower,
        int24 tickUpper,
        uint256 sourceAmount,
        bytes memory swapData,
        uint256 maxSlippage
    ) internal returns (uint256 amountAfterFee) {
        if (swapData.length == 0) return 0;

        // Decode swap router and data
        (address router, bytes memory routerData) = abi.decode(swapData, (address, bytes));
        if (!approvedRouters[router]) revert RouterNotApproved();

        Currency toCurrency = sourceCurrency == poolKey.currency0 ? poolKey.currency1 : poolKey.currency0;
        uint256 balanceBefore = _getBalance(toCurrency);

        // Execute swap
        SwapLib.SwapParams memory swapParams = SwapLib.SwapParams({
            fromCurrency: sourceCurrency,
            toCurrency: toCurrency,
            amountIn: sourceAmount > 0 ? sourceAmount : _getBalance(sourceCurrency),
            minAmountOut: 0, // Will be validated by overall slippage
            router: router,
            swapData: routerData,
            weth9: WETH9 // Pass WETH9 for wrapping native ETH
        });

        SwapLib.executeSwap(swapParams);

        // Take protocol fee on swap output and return adjusted amount
        uint256 swapOutput = _getBalance(toCurrency) - balanceBefore;
        return _takeSwapFee(toCurrency, swapOutput);
    }

    function _swapToTarget(
        Currency fromCurrency,
        Currency toCurrency,
        uint256 amount,
        bytes memory swapData,
        uint256 /* maxSlippage */ // Unused - slippage protection handled by router swap data
    ) internal returns (uint256) {
        if (fromCurrency == toCurrency) return amount;
        if (swapData.length == 0) return 0;

        (address router, bytes memory routerData) = abi.decode(swapData, (address, bytes));
        if (!approvedRouters[router]) revert RouterNotApproved();

        // NOTE: minAmountOut is set to 0 because:
        // 1. The swap data from aggregators (0x, 1inch, etc.) already includes slippage protection
        // 2. The previous calculation (amount * (10000 - maxSlippage) / 10000) was incorrect
        //    because it used input token amounts (e.g., ETH with 18 decimals) to calculate
        //    expected output (e.g., USDC with 6 decimals) without price conversion
        // 3. Setting minAmountOut=0 lets the aggregator's built-in slippage protection work correctly
        SwapLib.SwapParams memory swapParams = SwapLib.SwapParams({
            fromCurrency: fromCurrency,
            toCurrency: toCurrency,
            amountIn: amount,
            minAmountOut: 0, // Slippage protection handled by aggregator swap data
            router: router,
            swapData: routerData,
            weth9: WETH9 // Pass WETH9 for wrapping native ETH
        });

        uint256 swapOutput = SwapLib.executeSwap(swapParams);

        // Take protocol fee on swap output
        return _takeSwapFee(toCurrency, swapOutput);
    }

    /// @notice Automatically swap tokens through the pool to achieve optimal ratio for a new range
    /// @dev Used when moving from out-of-range (single token) to in-range (needs both tokens)
    function _autoSwapForRange(
        PoolKey memory poolKey,
        int24 newTickLower,
        int24 newTickUpper,
        uint256 maxSlippage
    ) internal {
        uint256 balance0 = _getBalance(poolKey.currency0);
        uint256 balance1 = _getBalance(poolKey.currency1);

        // Get current price and calculate target amounts for the new range
        (uint160 sqrtPriceX96, int24 currentTick,,) = poolManager.getSlot0(poolKey.toId());

        // If current tick is in the new range, we need both tokens
        if (currentTick >= newTickLower && currentTick < newTickUpper) {
            // Calculate what ratio we need
            // For a position in range, the ratio depends on where the current price is within the range
            // Simplified: we swap approximately half to get both tokens

            if (balance0 > 0 && balance1 == 0) {
                // We only have token0, need to swap some for token1
                // Calculate amount to swap (approximately half, adjusted for price impact)
                uint256 swapAmount = balance0 / 2;
                if (swapAmount > 0) {
                    // Perform swap inside unlock callback
                    bytes memory callbackData = abi.encode(poolKey, true, int256(swapAmount));
                    poolManager.unlock(callbackData);
                }
            } else if (balance1 > 0 && balance0 == 0) {
                // We only have token1, need to swap some for token0
                uint256 swapAmount = balance1 / 2;
                if (swapAmount > 0) {
                    // Perform swap inside unlock callback
                    bytes memory callbackData = abi.encode(poolKey, false, int256(swapAmount));
                    poolManager.unlock(callbackData);
                }
            }
            // If we have both tokens, no swap needed
        }
        // If current tick is outside new range, no swap needed (position will be single-sided)
    }

    /// @notice Callback from PoolManager.unlock() - performs the actual swap
    /// @param data Encoded swap parameters (poolKey, zeroForOne, amountIn)
    /// @return Empty bytes
    function unlockCallback(bytes calldata data) external override returns (bytes memory) {
        require(msg.sender == address(poolManager), "Only PoolManager");

        (PoolKey memory poolKey, bool zeroForOne, int256 amountIn) = abi.decode(data, (PoolKey, bool, int256));

        // Calculate minimum output with slippage protection
        uint160 sqrtPriceLimitX96 = zeroForOne
            ? TickMath.MIN_SQRT_PRICE + 1
            : TickMath.MAX_SQRT_PRICE - 1;

        SwapParams memory swapParams = SwapParams({
            zeroForOne: zeroForOne,
            amountSpecified: -amountIn, // Negative = exact input (exactIn)
            sqrtPriceLimitX96: sqrtPriceLimitX96
        });

        // Execute swap through PoolManager
        BalanceDelta delta = poolManager.swap(poolKey, swapParams, "");

        // In V4, delta interpretation:
        // - Negative = we owe to PoolManager (need to settle/pay)
        // - Positive = PoolManager owes us (need to take/receive)

        // Handle token0 delta
        int256 delta0 = delta.amount0();
        if (delta0 < 0) {
            // We owe token0 to PoolManager - settle it
            _settleToPoolManager(poolKey.currency0, uint256(-delta0));
        } else if (delta0 > 0) {
            // PoolManager owes us token0 - take it
            _takeFromPoolManager(poolKey.currency0, uint256(delta0));
            // Take protocol fee on received tokens (using _takeSwapFee for consistency)
            _takeSwapFee(poolKey.currency0, uint256(delta0));
        }

        // Handle token1 delta
        int256 delta1 = delta.amount1();
        if (delta1 < 0) {
            // We owe token1 to PoolManager - settle it
            _settleToPoolManager(poolKey.currency1, uint256(-delta1));
        } else if (delta1 > 0) {
            // PoolManager owes us token1 - take it
            _takeFromPoolManager(poolKey.currency1, uint256(delta1));
            // Take protocol fee on received tokens (using _takeSwapFee for consistency)
            _takeSwapFee(poolKey.currency1, uint256(delta1));
        }

        return "";
    }

    /// @notice Settle tokens to the PoolManager
    function _settleToPoolManager(Currency currency, uint256 amount) internal {
        if (currency.isAddressZero()) {
            poolManager.settle{value: amount}();
        } else {
            // ERC20 - must sync, transfer, then settle
            poolManager.sync(currency);
            IERC20(Currency.unwrap(currency)).safeTransfer(address(poolManager), amount);
            poolManager.settle();
        }
    }

    /// @notice Take tokens from the PoolManager
    function _takeFromPoolManager(Currency currency, uint256 amount) internal {
        poolManager.take(currency, address(this), amount);
    }

    function _mintPosition(
        PoolKey memory poolKey,
        int24 tickLower,
        int24 tickUpper,
        uint128 liquidity,
        uint256 amount0Max,
        uint256 amount1Max,
        address recipient
    ) internal returns (uint256 tokenId, uint256 amount0, uint256 amount1) {
        // Get current balances before transfer
        uint256 balance0Before = _getBalance(poolKey.currency0);
        uint256 balance1Before = _getBalance(poolKey.currency1);

        // Transfer tokens to PositionManager (not PoolManager)
        // PositionManager will then handle the settlement using its own balance
        address pmAddr = address(positionManager);

        if (!poolKey.currency0.isAddressZero() && balance0Before > 0) {
            IERC20(Currency.unwrap(poolKey.currency0)).safeTransfer(pmAddr, balance0Before);
        }
        if (!poolKey.currency1.isAddressZero() && balance1Before > 0) {
            IERC20(Currency.unwrap(poolKey.currency1)).safeTransfer(pmAddr, balance1Before);
        }

        // Encode mint action with SETTLE using OPEN_DELTA (0) and payerIsUser=false
        // OPEN_DELTA = 0, which tells PositionManager to settle exactly the debt amount
        // payerIsUser = false means PositionManager uses its own balance
        bytes memory actions = abi.encodePacked(
            uint8(Actions.MINT_POSITION),
            uint8(Actions.SETTLE),
            uint8(Actions.SETTLE),
            uint8(Actions.SWEEP),
            uint8(Actions.SWEEP)
        );
        bytes[] memory params = new bytes[](5);
        params[0] = abi.encode(
            poolKey,
            tickLower,
            tickUpper,
            liquidity,
            amount0Max,
            amount1Max,
            recipient,
            ""
        );
        // SETTLE params: (currency, amount, payerIsUser)
        // Using OPEN_DELTA (0) to settle exactly the debt amount
        // payerIsUser = false means PositionManager uses its own balance
        params[1] = abi.encode(poolKey.currency0, uint256(0), false);
        params[2] = abi.encode(poolKey.currency1, uint256(0), false);
        // SWEEP remaining tokens back to this contract for refund handling
        params[3] = abi.encode(poolKey.currency0, address(this));
        params[4] = abi.encode(poolKey.currency1, address(this));

        // Execute mint - slippage validation happens inside PositionManager
        uint256 ethValue = poolKey.currency0.isAddressZero() || poolKey.currency1.isAddressZero()
            ? address(this).balance
            : 0;

        positionManager.modifyLiquidities{value: ethValue}(
            abi.encode(actions, params),
            block.timestamp
        );

        // Get the newly minted token ID
        tokenId = positionManager.nextTokenId() - 1;

        // Calculate actual amounts used by checking remaining balances
        uint256 balance0After = _getBalance(poolKey.currency0);
        uint256 balance1After = _getBalance(poolKey.currency1);

        // Amount used = what we sent - what was swept back
        amount0 = balance0Before > balance0After ? balance0Before - balance0After : 0;
        amount1 = balance1Before > balance1After ? balance1Before - balance1After : 0;
    }

    function _increaseLiquidity(
        uint256 tokenId,
        uint128 liquidity,
        uint256 amount0Max,
        uint256 amount1Max
    ) internal returns (uint256 amount0, uint256 amount1) {
        (PoolKey memory poolKey,,,) = getPositionInfo(tokenId);

        // Get current balances before transfer
        uint256 balance0Before = _getBalance(poolKey.currency0);
        uint256 balance1Before = _getBalance(poolKey.currency1);

        // Transfer tokens to PositionManager (not PoolManager)
        // PositionManager will then handle the settlement using its own balance
        address pmAddr = address(positionManager);

        if (!poolKey.currency0.isAddressZero() && balance0Before > 0) {
            IERC20(Currency.unwrap(poolKey.currency0)).safeTransfer(pmAddr, balance0Before);
        }
        if (!poolKey.currency1.isAddressZero() && balance1Before > 0) {
            IERC20(Currency.unwrap(poolKey.currency1)).safeTransfer(pmAddr, balance1Before);
        }

        // Encode increase action with SETTLE using OPEN_DELTA (0) and payerIsUser=false
        bytes memory actions = abi.encodePacked(
            uint8(Actions.INCREASE_LIQUIDITY),
            uint8(Actions.SETTLE),
            uint8(Actions.SETTLE),
            uint8(Actions.SWEEP),
            uint8(Actions.SWEEP)
        );
        bytes[] memory params = new bytes[](5);
        params[0] = abi.encode(tokenId, liquidity, amount0Max, amount1Max, "");
        // SETTLE params: (currency, amount, payerIsUser)
        // Using OPEN_DELTA (0) to settle exactly the debt amount
        params[1] = abi.encode(poolKey.currency0, uint256(0), false);
        params[2] = abi.encode(poolKey.currency1, uint256(0), false);
        // SWEEP remaining tokens back to this contract
        params[3] = abi.encode(poolKey.currency0, address(this));
        params[4] = abi.encode(poolKey.currency1, address(this));

        uint256 ethValue = poolKey.currency0.isAddressZero() || poolKey.currency1.isAddressZero()
            ? address(this).balance
            : 0;

        positionManager.modifyLiquidities{value: ethValue}(
            abi.encode(actions, params),
            block.timestamp
        );

        // Calculate actual amounts used by checking remaining balances
        uint256 balance0After = _getBalance(poolKey.currency0);
        uint256 balance1After = _getBalance(poolKey.currency1);

        amount0 = balance0Before > balance0After ? balance0Before - balance0After : 0;
        amount1 = balance1Before > balance1After ? balance1Before - balance1After : 0;
    }

    function _decreaseLiquidity(
        uint256 tokenId,
        uint128 liquidity,
        uint256 amount0Min,
        uint256 amount1Min
    ) internal returns (uint256 amount0, uint256 amount1) {
        (PoolKey memory poolKey,,,) = getPositionInfo(tokenId);

        // Encode decrease action with TAKE_PAIR to receive tokens
        bytes memory actions = abi.encodePacked(
            uint8(Actions.DECREASE_LIQUIDITY),
            uint8(Actions.TAKE_PAIR)
        );
        bytes[] memory params = new bytes[](2);
        params[0] = abi.encode(tokenId, liquidity, amount0Min, amount1Min, "");
        params[1] = abi.encode(poolKey.currency0, poolKey.currency1, address(this));

        uint256 balance0Before = _getBalance(poolKey.currency0);
        uint256 balance1Before = _getBalance(poolKey.currency1);

        positionManager.modifyLiquidities(
            abi.encode(actions, params),
            block.timestamp
        );

        // PositionManager validates slippage internally using SlippageCheck
        amount0 = _getBalance(poolKey.currency0) - balance0Before;
        amount1 = _getBalance(poolKey.currency1) - balance1Before;
    }

    function _collectFees(uint256 tokenId, address recipient) internal returns (uint256 amount0, uint256 amount1) {
        (PoolKey memory poolKey,,,) = getPositionInfo(tokenId);

        // In V4, fees are collected by decreasing liquidity by 0 and then taking the tokens
        bytes memory actions = abi.encodePacked(
            uint8(Actions.DECREASE_LIQUIDITY),
            uint8(Actions.TAKE_PAIR)
        );
        bytes[] memory params = new bytes[](2);
        params[0] = abi.encode(tokenId, 0, 0, 0, ""); // Decrease by 0 to collect fees
        params[1] = abi.encode(poolKey.currency0, poolKey.currency1, recipient);

        uint256 balance0Before = _getBalance(poolKey.currency0);
        uint256 balance1Before = _getBalance(poolKey.currency1);

        positionManager.modifyLiquidities(abi.encode(actions, params), block.timestamp);

        amount0 = _getBalance(poolKey.currency0) - balance0Before;
        amount1 = _getBalance(poolKey.currency1) - balance1Before;
    }
}
