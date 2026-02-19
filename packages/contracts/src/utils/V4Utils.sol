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
import { PositionValueLib } from "../libraries/PositionValueLib.sol";

/// @title V4Utils
/// @notice Utility contract for atomic operations on Uniswap V4 positions
contract V4Utils is V4Base, Multicall, IV4Utils, IUnlockCallback {
    using SafeERC20 for IERC20;
    using CurrencyLibrary for Currency;
    using PoolIdLibrary for PoolKey;
    using StateLibrary for IPoolManager;

    string public constant VERSION = "1.2.0";

    uint256 public constant MAX_SLIPPAGE = 5000;
    uint256 public override protocolFee = 65;
    uint256 public constant MAX_PROTOCOL_FEE = 1000;
    uint256 public constant FEE_CHANGE_COOLDOWN = 24 hours;

    mapping(Currency => uint256) public override accumulatedFees;
    uint256 public lastFeeChangeTime;

    uint256[47] private __gap;

    // Custom errors (replacing string requires for bytecode savings)
    error SwapDataRequired();
    error SlippageExceedsMax();
    error InsufficientETH();
    error InsufficientOutput();
    error FeeTooHigh();
    error FeeCooldown();
    error NoFees();
    error OnlyPoolManager();
    error CallFailed();
    error UnexpectedOwner();

    constructor(
        address _poolManager,
        address _positionManager,
        address _weth9
    ) V4Base(_poolManager, _positionManager, _weth9) {}

    function initialize(address _owner) external initializer {
        __V4Base_init(_owner);
        protocolFee = 65; // 0.65%
    }

    /// @notice Re-initialize for upgrades (sets storage values that were missing in v1)
    function initializeV2() external reinitializer(2) {
        if (protocolFee == 0) protocolFee = 65;
    }

    // ============ Shared Internal: Swap + Receive ============

    /// @dev Consolidated swap+receive logic used by swapAndMint and swapAndIncreaseLiquidity
    function _handleSwapAndReceive(
        PoolKey memory poolKey,
        uint256 amount0Desired,
        uint256 amount1Desired,
        Currency swapSourceCurrency,
        uint256 swapSourceAmount,
        bytes memory swapData,
        uint256 maxSwapSlippage
    ) internal returns (uint256 balance0, uint256 balance1) {
        balance0 = poolKey.currency0.isAddressZero() ? msg.value : _receiveTokens(poolKey.currency0, amount0Desired);
        balance1 = poolKey.currency1.isAddressZero() ? msg.value : _receiveTokens(poolKey.currency1, amount1Desired);

        if (swapSourceAmount > 0) {
            if (!swapSourceCurrency.isAddressZero()) _receiveTokens(swapSourceCurrency, swapSourceAmount);
            Currency tgt = swapSourceCurrency == poolKey.currency0 ? poolKey.currency1 : poolKey.currency0;
            _routerSwap(swapSourceCurrency, tgt, swapSourceAmount, swapData, poolKey, maxSwapSlippage);
            // Use _getAvailableBalance to exclude accumulated protocol fees from swap
            balance0 = _getAvailableBalance(poolKey.currency0);
            balance1 = _getAvailableBalance(poolKey.currency1);
        }
    }

    /// @dev Shared decrease-with-slippage logic for moveRange and exitToStablecoin
    function _decreaseWithSlippage(
        uint256 tokenId,
        PoolKey memory poolKey,
        int24 tickLower,
        int24 tickUpper,
        uint128 liquidity,
        uint256 maxSwapSlippage
    ) internal returns (uint256 amount0, uint256 amount1) {
        (uint256 exp0, uint256 exp1) = PositionValueLib.getAmountsForLiquidity(
            poolManager, poolKey, tickLower, tickUpper, liquidity
        );
        uint256 ds = maxSwapSlippage > 0 ? maxSwapSlippage : 500;
        if (ds > 500) ds = 500;
        (amount0, amount1) = _decreaseLiquidity(tokenId, liquidity, exp0 * (10000 - ds) / 10000, exp1 * (10000 - ds) / 10000);
    }

    // ============ External Functions ============

    /// @inheritdoc IV4Utils
    function swapAndMint(SwapAndMintParams calldata params)
        external payable override nonReentrant whenNotPaused checkDeadline(params.deadline)
        returns (uint256 tokenId, uint128 liquidity, uint256 amount0, uint256 amount1)
    {
        if (params.maxSwapSlippage > MAX_SLIPPAGE) revert SlippageExceedsMax();

        (uint256 balance0, uint256 balance1) = _handleSwapAndReceive(
            params.poolKey, params.amount0Desired, params.amount1Desired,
            params.swapSourceCurrency, params.swapSourceAmount,
            params.swapData, params.maxSwapSlippage
        );

        (uint160 sqrtPriceX96,,,) = poolManager.getSlot0(params.poolKey.toId());
        liquidity = LiquidityAmounts.getLiquidityForAmounts(
            sqrtPriceX96,
            TickMath.getSqrtPriceAtTick(params.tickLower),
            TickMath.getSqrtPriceAtTick(params.tickUpper),
            balance0, balance1
        );

        (tokenId, amount0, amount1) = _mintPosition(
            params.poolKey, params.tickLower, params.tickUpper,
            liquidity, params.amount0Max, params.amount1Max, params.recipient
        );

        _refundExcess(params.poolKey.currency0, params.recipient, balance0 - amount0);
        _refundExcess(params.poolKey.currency1, params.recipient, balance1 - amount1);
        emit PositionMinted(tokenId, params.recipient, params.poolKey, params.tickLower, params.tickUpper, liquidity);
    }

    /// @inheritdoc IV4Utils
    function swapAndIncreaseLiquidity(SwapAndIncreaseParams calldata params)
        external payable override nonReentrant whenNotPaused checkDeadline(params.deadline)
        onlyPositionOwnerOrApproved(params.tokenId)
        returns (uint128 liquidity, uint256 amount0, uint256 amount1)
    {
        if (params.maxSwapSlippage > MAX_SLIPPAGE) revert SlippageExceedsMax();

        (PoolKey memory poolKey, int24 tickLower, int24 tickUpper,) = getPositionInfo(params.tokenId);

        (uint256 balance0, uint256 balance1) = _handleSwapAndReceive(
            poolKey, params.amount0Desired, params.amount1Desired,
            params.swapSourceCurrency, params.swapSourceAmount,
            params.swapData, params.maxSwapSlippage
        );

        (uint160 sqrtPriceX96,,,) = poolManager.getSlot0(poolKey.toId());
        liquidity = LiquidityAmounts.getLiquidityForAmounts(
            sqrtPriceX96,
            TickMath.getSqrtPriceAtTick(tickLower),
            TickMath.getSqrtPriceAtTick(tickUpper),
            balance0, balance1
        );

        (amount0, amount1) = _increaseLiquidity(params.tokenId, liquidity, params.amount0Max, params.amount1Max);

        address owner = IERC721(address(positionManager)).ownerOf(params.tokenId);
        _refundExcess(poolKey.currency0, owner, balance0 - amount0);
        _refundExcess(poolKey.currency1, owner, balance1 - amount1);
        emit LiquidityIncreased(params.tokenId, liquidity, amount0, amount1);
    }

    /// @inheritdoc IV4Utils
    function decreaseAndSwap(DecreaseAndSwapParams calldata params)
        external override nonReentrant whenNotPaused checkDeadline(params.deadline)
        onlyPositionOwnerOrApproved(params.tokenId)
        returns (uint256 amount)
    {
        if (params.maxSwapSlippage > MAX_SLIPPAGE) revert SlippageExceedsMax();

        (PoolKey memory poolKey,,, uint128 currentLiquidity) = getPositionInfo(params.tokenId);
        address owner = IERC721(address(positionManager)).ownerOf(params.tokenId);

        (uint256 amount0, uint256 amount1) = _decreaseLiquidity(
            params.tokenId, params.liquidity, params.amount0Min, params.amount1Min
        );
        emit LiquidityDecreased(params.tokenId, params.liquidity, amount0, amount1);

        if (currentLiquidity > params.liquidity) {
            (uint256 fees0, uint256 fees1) = _decreaseLiquidity(params.tokenId, 0, 0, 0);
            amount0 += fees0;
            amount1 += fees1;
        }

        if (!(poolKey.currency0 == params.targetCurrency) && amount0 > 0) {
            amount += _routerSwap(poolKey.currency0, params.targetCurrency, amount0, params.swapData, poolKey, params.maxSwapSlippage);
        } else {
            amount += amount0;
        }
        if (!(poolKey.currency1 == params.targetCurrency) && amount1 > 0) {
            amount += _routerSwap(poolKey.currency1, params.targetCurrency, amount1, params.swapData, poolKey, params.maxSwapSlippage);
        } else {
            amount += amount1;
        }

        _transferCurrency(params.targetCurrency, owner, amount);
    }

    /// @inheritdoc IV4Utils
    function collectAndSwap(CollectAndSwapParams calldata params)
        external override nonReentrant whenNotPaused checkDeadline(params.deadline)
        onlyPositionOwnerOrApproved(params.tokenId)
        returns (uint256 amount)
    {
        if (params.maxSwapSlippage > MAX_SLIPPAGE) revert SlippageExceedsMax();

        (PoolKey memory poolKey,,,) = getPositionInfo(params.tokenId);
        address owner = IERC721(address(positionManager)).ownerOf(params.tokenId);

        (uint256 amount0, uint256 amount1) = _decreaseLiquidity(params.tokenId, 0, 0, 0);
        emit FeesCollected(params.tokenId, amount0, amount1);

        if (!(poolKey.currency0 == params.targetCurrency) && amount0 > 0) {
            amount += _routerSwap(poolKey.currency0, params.targetCurrency, amount0, params.swapData, poolKey, params.maxSwapSlippage);
        } else {
            amount += amount0;
        }
        if (!(poolKey.currency1 == params.targetCurrency) && amount1 > 0) {
            amount += _routerSwap(poolKey.currency1, params.targetCurrency, amount1, params.swapData, poolKey, params.maxSwapSlippage);
        } else {
            amount += amount1;
        }

        _transferCurrency(params.targetCurrency, owner, amount);
    }

    /// @inheritdoc IV4Utils
    function collectFees(CollectFeesParams calldata params)
        external override nonReentrant whenNotPaused checkDeadline(params.deadline)
        onlyPositionOwnerOrApproved(params.tokenId)
        returns (uint256 amount0, uint256 amount1)
    {
        (PoolKey memory poolKey,,,) = getPositionInfo(params.tokenId);
        address owner = IERC721(address(positionManager)).ownerOf(params.tokenId);

        (amount0, amount1) = _decreaseLiquidity(params.tokenId, 0, 0, 0);
        emit FeesCollected(params.tokenId, amount0, amount1);

        _transferCurrency(poolKey.currency0, owner, amount0);
        _transferCurrency(poolKey.currency1, owner, amount1);
    }

    /// @inheritdoc IV4Utils
    function decreaseLiquidity(DecreaseLiquidityParams calldata params)
        external override nonReentrant whenNotPaused checkDeadline(params.deadline)
        onlyPositionOwnerOrApproved(params.tokenId)
        returns (uint256 amount0, uint256 amount1)
    {
        (PoolKey memory poolKey,,, uint128 currentLiquidity) = getPositionInfo(params.tokenId);
        address owner = IERC721(address(positionManager)).ownerOf(params.tokenId);

        uint128 liquidityToRemove = params.liquidity == 0 ? currentLiquidity : params.liquidity;

        (amount0, amount1) = _decreaseLiquidity(params.tokenId, liquidityToRemove, params.amount0Min, params.amount1Min);
        emit LiquidityDecreased(params.tokenId, liquidityToRemove, amount0, amount1);

        if (currentLiquidity > liquidityToRemove) {
            (uint256 fees0, uint256 fees1) = _decreaseLiquidity(params.tokenId, 0, 0, 0);
            amount0 += fees0;
            amount1 += fees1;
            if (fees0 > 0 || fees1 > 0) emit FeesCollected(params.tokenId, fees0, fees1);
        }

        _transferCurrency(poolKey.currency0, owner, amount0);
        _transferCurrency(poolKey.currency1, owner, amount1);
    }

    /// @inheritdoc IV4Utils
    function exitToStablecoin(ExitToStablecoinParams calldata params)
        external override nonReentrant whenNotPaused checkDeadline(params.deadline)
        onlyPositionOwnerOrApproved(params.tokenId)
        returns (uint256 amount)
    {
        if (params.maxSwapSlippage > MAX_SLIPPAGE) revert SlippageExceedsMax();

        (PoolKey memory poolKey, int24 tickLower, int24 tickUpper, uint128 currentLiquidity) = getPositionInfo(params.tokenId);
        address owner = IERC721(address(positionManager)).ownerOf(params.tokenId);

        uint128 liquidityToRemove = params.liquidity == 0 ? currentLiquidity : params.liquidity;

        (uint256 amount0, uint256 amount1) = _decreaseWithSlippage(
            params.tokenId, poolKey, tickLower, tickUpper, liquidityToRemove, params.maxSwapSlippage
        );
        emit LiquidityDecreased(params.tokenId, liquidityToRemove, amount0, amount1);

        if (currentLiquidity > liquidityToRemove) {
            (uint256 fees0, uint256 fees1) = _decreaseLiquidity(params.tokenId, 0, 0, 0);
            amount0 += fees0;
            amount1 += fees1;
        }

        if (!(poolKey.currency0 == params.targetStablecoin) && amount0 > 0) {
            if (params.swapData0.length == 0) revert SwapDataRequired();
            amount += _routerSwap(poolKey.currency0, params.targetStablecoin, amount0, params.swapData0, poolKey, params.maxSwapSlippage);
        } else {
            amount += amount0;
        }
        if (!(poolKey.currency1 == params.targetStablecoin) && amount1 > 0) {
            if (params.swapData1.length == 0) revert SwapDataRequired();
            amount += _routerSwap(poolKey.currency1, params.targetStablecoin, amount1, params.swapData1, poolKey, params.maxSwapSlippage);
        } else {
            amount += amount1;
        }

        if (amount < params.minAmountOut) revert InsufficientOutput();
        _transferCurrency(params.targetStablecoin, owner, amount);
    }

    /// @inheritdoc IV4Utils
    function moveRange(MoveRangeParams calldata params)
        external override nonReentrant whenNotPaused checkDeadline(params.deadline)
        onlyPositionOwnerOrApproved(params.tokenId)
        returns (uint256 newTokenId, uint128 liquidity)
    {
        if (params.maxSwapSlippage > MAX_SLIPPAGE) revert SlippageExceedsMax();

        (PoolKey memory poolKey, int24 oldTickLower, int24 oldTickUpper, uint128 oldLiquidity) = getPositionInfo(params.tokenId);
        address owner = IERC721(address(positionManager)).ownerOf(params.tokenId);

        uint128 liquidityToMove = params.liquidityToMove == 0 ? oldLiquidity : params.liquidityToMove;

        (uint256 amount0, uint256 amount1) = _decreaseWithSlippage(
            params.tokenId, poolKey, oldTickLower, oldTickUpper, liquidityToMove, params.maxSwapSlippage
        );

        if (oldLiquidity > liquidityToMove) {
            (uint256 fees0, uint256 fees1) = _decreaseLiquidity(params.tokenId, 0, 0, 0);
            amount0 += fees0;
            amount1 += fees1;
        }

        if (params.swapData.length > 0) {
            _routerSwap(poolKey.currency0, poolKey.currency1, 0, params.swapData, poolKey, params.maxSwapSlippage);
        } else {
            _autoSwapForRange(poolKey, params.newTickLower, params.newTickUpper, params.maxSwapSlippage);
        }

        (uint160 sqrtPriceX96,,,) = poolManager.getSlot0(poolKey.toId());
        uint256 balance0 = _getAvailableBalance(poolKey.currency0);
        uint256 balance1 = _getAvailableBalance(poolKey.currency1);

        liquidity = LiquidityAmounts.getLiquidityForAmounts(
            sqrtPriceX96,
            TickMath.getSqrtPriceAtTick(params.newTickLower),
            TickMath.getSqrtPriceAtTick(params.newTickUpper),
            balance0, balance1
        );

        (newTokenId, amount0, amount1) = _mintPosition(
            poolKey, params.newTickLower, params.newTickUpper, liquidity, params.amount0Max, params.amount1Max, owner
        );

        _refundExcess(poolKey.currency0, owner, balance0 - amount0);
        _refundExcess(poolKey.currency1, owner, balance1 - amount1);
        emit RangeMoved(params.tokenId, newTokenId, params.newTickLower, params.newTickUpper);
    }

    /// @inheritdoc IV4Utils
    function setProtocolFee(uint256 newFee) external override onlyOwner {
        if (newFee > MAX_PROTOCOL_FEE) revert FeeTooHigh();
        // Skip cooldown for first change (lastFeeChangeTime == 0 means never changed)
        if (lastFeeChangeTime > 0) {
            if (block.timestamp < lastFeeChangeTime + FEE_CHANGE_COOLDOWN) revert FeeCooldown();
        }
        emit ProtocolFeeUpdated(protocolFee, newFee);
        protocolFee = newFee;
        lastFeeChangeTime = block.timestamp;
    }

    /// @inheritdoc IV4Utils
    function withdrawFees(Currency currency, address recipient) external override onlyOwner {
        uint256 amount = accumulatedFees[currency];
        if (amount == 0) revert NoFees();
        accumulatedFees[currency] = 0;
        _transferCurrency(currency, recipient, amount);
        emit FeesWithdrawn(recipient, currency, amount);
    }


    // ============ Internal Functions ============

    function _getAvailableBalance(Currency currency) internal view returns (uint256) {
        uint256 total = _getBalance(currency);
        uint256 reserved = accumulatedFees[currency];
        return total > reserved ? total - reserved : 0;
    }

    function _receiveTokens(Currency currency, uint256 amount) internal returns (uint256) {
        if (amount == 0) return 0;
        if (currency.isAddressZero()) {
            if (msg.value < amount) revert InsufficientETH();
            return msg.value;
        } else {
            IERC20 token = IERC20(Currency.unwrap(currency));
            uint256 balanceBefore = token.balanceOf(address(this));
            token.safeTransferFrom(msg.sender, address(this), amount);
            return token.balanceOf(address(this)) - balanceBefore;
        }
    }

    function _getBalance(Currency currency) internal view returns (uint256) {
        if (currency.isAddressZero()) return address(this).balance;
        return IERC20(Currency.unwrap(currency)).balanceOf(address(this));
    }

    function _takeSwapFee(Currency currency, uint256 amount) internal returns (uint256) {
        if (amount == 0 || protocolFee == 0) return amount;
        uint256 fee = amount * protocolFee / 10000;
        accumulatedFees[currency] += fee;
        emit SwapFeeTaken(currency, fee);
        return amount - fee;
    }

    function _refundExcess(Currency currency, address to, uint256 amount) internal {
        if (amount > 0) _transferCurrency(currency, to, amount);
    }

    function _routerSwap(
        Currency fromCurrency,
        Currency toCurrency,
        uint256 amountIn,
        bytes memory swapData,
        PoolKey memory poolKey,
        uint256 maxSlippage
    ) internal returns (uint256) {
        if (fromCurrency == toCurrency) return amountIn;
        if (swapData.length == 0) return 0;

        (address router, bytes memory routerData) = abi.decode(swapData, (address, bytes));
        if (!approvedRouters[router]) revert RouterNotApproved();

        uint256 srcBal = _getAvailableBalance(fromCurrency);
        uint256 dstBal = _getBalance(toCurrency);
        uint256 swapAmt = amountIn > 0 ? amountIn : srcBal;

        SwapLib.executeSwap(SwapLib.SwapParams({
            fromCurrency: fromCurrency,
            toCurrency: toCurrency,
            amountIn: swapAmt,
            minAmountOut: 0,
            router: router,
            swapData: routerData,
            weth9: WETH9
        }));

        uint256 consumed = srcBal - _getAvailableBalance(fromCurrency);
        uint256 output = _getBalance(toCurrency) - dstBal;

        if (consumed > 0 && maxSlippage < 10000) {
            (uint160 sqrtPriceX96,,,) = poolManager.getSlot0(poolKey.toId());
            bool zeroForOne = fromCurrency == poolKey.currency0;
            uint256 minOut = SwapLib.calculateMinOutput(consumed, sqrtPriceX96, maxSlippage, zeroForOne);
            if (output < minOut) revert SwapLib.SlippageExceeded(minOut, output);
        }

        return _takeSwapFee(toCurrency, output);
    }

    function _autoSwapForRange(PoolKey memory poolKey, int24 newTickLower, int24 newTickUpper, uint256 maxSlippage) internal {
        uint256 balance0 = _getAvailableBalance(poolKey.currency0);
        uint256 balance1 = _getAvailableBalance(poolKey.currency1);

        (uint160 sqrtPriceX96, int24 currentTick,,) = poolManager.getSlot0(poolKey.toId());

        if (currentTick >= newTickLower && currentTick < newTickUpper) {
            (bool zeroForOne, uint256 swapAmount) = PositionValueLib.calculateSwapForOptimalRatio(
                balance0, balance1, sqrtPriceX96, newTickLower, newTickUpper
            );
            if (swapAmount > 0) {
                poolManager.unlock(abi.encode(poolKey, zeroForOne, int256(swapAmount), maxSlippage));
            }
        }
    }

    function unlockCallback(bytes calldata data) external override returns (bytes memory) {
        if (msg.sender != address(poolManager)) revert OnlyPoolManager();

        (PoolKey memory poolKey, bool zeroForOne, int256 amountIn, uint256 maxSlippage) =
            abi.decode(data, (PoolKey, bool, int256, uint256));

        (uint160 sqrtPriceX96,,,) = poolManager.getSlot0(poolKey.toId());

        BalanceDelta delta = poolManager.swap(poolKey, SwapParams({
            zeroForOne: zeroForOne,
            amountSpecified: -amountIn,
            sqrtPriceLimitX96: zeroForOne ? TickMath.MIN_SQRT_PRICE + 1 : TickMath.MAX_SQRT_PRICE - 1
        }), "");

        if (maxSlippage < 10000) {
            uint256 minOutput = SwapLib.calculateMinOutput(uint256(amountIn), sqrtPriceX96, maxSlippage, zeroForOne);
            int256 outputDelta = zeroForOne ? int256(delta.amount1()) : int256(delta.amount0());
            if (outputDelta > 0 && uint256(outputDelta) < minOutput) revert SlippageExceedsMax();
        }

        int256 delta0 = delta.amount0();
        if (delta0 < 0) { _settleToPoolManager(poolKey.currency0, uint256(-delta0)); }
        else if (delta0 > 0) { poolManager.take(poolKey.currency0, address(this), uint256(delta0)); }

        int256 delta1 = delta.amount1();
        if (delta1 < 0) { _settleToPoolManager(poolKey.currency1, uint256(-delta1)); }
        else if (delta1 > 0) { poolManager.take(poolKey.currency1, address(this), uint256(delta1)); }

        return "";
    }

    function _settleToPoolManager(Currency currency, uint256 amount) internal {
        if (currency.isAddressZero()) {
            poolManager.settle{value: amount}();
        } else {
            poolManager.sync(currency);
            IERC20(Currency.unwrap(currency)).safeTransfer(address(poolManager), amount);
            poolManager.settle();
        }
    }

    /// @dev Shared helper: transfer tokens to PM, encode settle/sweep, call modifyLiquidities
    /// @dev Uses _getAvailableBalance to exclude accumulated protocol fees from transfer
    function _transferAndModify(
        PoolKey memory poolKey, bytes memory actions, bytes memory actionParam0
    ) internal returns (uint256 amount0, uint256 amount1) {
        uint256 b0 = _getAvailableBalance(poolKey.currency0);
        uint256 b1 = _getAvailableBalance(poolKey.currency1);

        address pm = address(positionManager);
        if (!poolKey.currency0.isAddressZero() && b0 > 0)
            IERC20(Currency.unwrap(poolKey.currency0)).safeTransfer(pm, b0);
        if (!poolKey.currency1.isAddressZero() && b1 > 0)
            IERC20(Currency.unwrap(poolKey.currency1)).safeTransfer(pm, b1);

        bytes[] memory params = new bytes[](5);
        params[0] = actionParam0;
        params[1] = abi.encode(poolKey.currency0, uint256(0), false);
        params[2] = abi.encode(poolKey.currency1, uint256(0), false);
        params[3] = abi.encode(poolKey.currency0, address(this));
        params[4] = abi.encode(poolKey.currency1, address(this));

        uint256 ethValue;
        if (poolKey.currency0.isAddressZero() || poolKey.currency1.isAddressZero()) {
            uint256 nb = address(this).balance;
            uint256 r = accumulatedFees[Currency.wrap(address(0))];
            ethValue = nb > r ? nb - r : 0;
        }

        positionManager.modifyLiquidities{value: ethValue}(abi.encode(actions, params), block.timestamp);

        uint256 a0 = _getAvailableBalance(poolKey.currency0);
        uint256 a1 = _getAvailableBalance(poolKey.currency1);
        amount0 = b0 > a0 ? b0 - a0 : 0;
        amount1 = b1 > a1 ? b1 - a1 : 0;
    }

    function _mintPosition(
        PoolKey memory poolKey, int24 tickLower, int24 tickUpper,
        uint128 liquidity, uint256 amount0Max, uint256 amount1Max, address recipient
    ) internal returns (uint256 tokenId, uint256 amount0, uint256 amount1) {
        (amount0, amount1) = _transferAndModify(
            poolKey,
            abi.encodePacked(uint8(Actions.MINT_POSITION), uint8(Actions.SETTLE), uint8(Actions.SETTLE), uint8(Actions.SWEEP), uint8(Actions.SWEEP)),
            abi.encode(poolKey, tickLower, tickUpper, liquidity, amount0Max, amount1Max, recipient, "")
        );
        tokenId = positionManager.nextTokenId() - 1;
        if (IERC721(address(positionManager)).ownerOf(tokenId) != recipient) revert UnexpectedOwner();
    }

    function _increaseLiquidity(
        uint256 tokenId, uint128 liquidity, uint256 amount0Max, uint256 amount1Max
    ) internal returns (uint256 amount0, uint256 amount1) {
        (PoolKey memory poolKey,,,) = getPositionInfo(tokenId);
        (amount0, amount1) = _transferAndModify(
            poolKey,
            abi.encodePacked(uint8(Actions.INCREASE_LIQUIDITY), uint8(Actions.SETTLE), uint8(Actions.SETTLE), uint8(Actions.SWEEP), uint8(Actions.SWEEP)),
            abi.encode(tokenId, liquidity, amount0Max, amount1Max, "")
        );
    }

    function _decreaseLiquidity(
        uint256 tokenId, uint128 liquidity, uint256 amount0Min, uint256 amount1Min
    ) internal returns (uint256 amount0, uint256 amount1) {
        (PoolKey memory poolKey,,,) = getPositionInfo(tokenId);

        bytes[] memory params = new bytes[](2);
        params[0] = abi.encode(tokenId, liquidity, amount0Min, amount1Min, "");
        params[1] = abi.encode(poolKey.currency0, poolKey.currency1, address(this));

        uint256 b0 = _getBalance(poolKey.currency0);
        uint256 b1 = _getBalance(poolKey.currency1);

        positionManager.modifyLiquidities(
            abi.encode(abi.encodePacked(uint8(Actions.DECREASE_LIQUIDITY), uint8(Actions.TAKE_PAIR)), params),
            block.timestamp
        );

        amount0 = _getBalance(poolKey.currency0) - b0;
        amount1 = _getBalance(poolKey.currency1) - b1;
    }
}
