// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import { IPoolManager } from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import { IUnlockCallback } from "@uniswap/v4-core/src/interfaces/callback/IUnlockCallback.sol";
import { PoolKey } from "@uniswap/v4-core/src/types/PoolKey.sol";
import { PoolId, PoolIdLibrary } from "@uniswap/v4-core/src/types/PoolId.sol";
import { Currency, CurrencyLibrary } from "@uniswap/v4-core/src/types/Currency.sol";
import { BalanceDelta } from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import { SwapParams } from "@uniswap/v4-core/src/types/PoolOperation.sol";
import { StateLibrary } from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import { TickMath } from "@uniswap/v4-core/src/libraries/TickMath.sol";
import { IPositionManager } from "@uniswap/v4-periphery/src/interfaces/IPositionManager.sol";
import { Actions } from "@uniswap/v4-periphery/src/libraries/Actions.sol";
import { IERC721 } from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import { V4Base } from "../base/V4Base.sol";
import { IV4AutoRange } from "../interfaces/IV4AutoRange.sol";
import { SwapLib } from "../libraries/SwapLib.sol";
import { LiquidityAmounts } from "@uniswap/v4-periphery/src/libraries/LiquidityAmounts.sol";
import { PositionValueLib } from "../libraries/PositionValueLib.sol";

/// @title V4AutoRange
/// @notice Automated position rebalancing for Uniswap V4
/// @dev Automatically rebalances positions when they go out of range
contract V4AutoRange is V4Base, IV4AutoRange, IUnlockCallback {
    using SafeERC20 for IERC20;
    using CurrencyLibrary for Currency;
    using PoolIdLibrary for PoolKey;
    using StateLibrary for IPoolManager;

    /// @notice Contract version
    string public constant VERSION = "1.3.0";

    /// @notice Error when calculated liquidity is zero (usually means swap is needed)
    error ZeroLiquidityAfterRebalance();

    /// @notice Error when internal swap fails
    error InternalSwapFailed();

    /// @notice Minimum rebalance interval (1 hour)
    uint32 public constant MIN_REBALANCE_INTERVAL = 3600;

    /// @notice Maximum protocol fee (10%)
    uint256 public constant MAX_PROTOCOL_FEE = 1000;

    /// @notice Cooldown period between protocol fee changes
    uint256 public constant FEE_CHANGE_COOLDOWN = 24 hours;

    /// @notice Protocol fee for rebalancing (0.65%)
    uint256 public protocolFee = 65;

    /// @notice Range configurations by token ID
    mapping(uint256 => RangeConfig) public rangeConfigs;

    /// @notice Last rebalance time by token ID
    mapping(uint256 => uint256) public lastRebalanceTime;

    /// @notice Mapping from old token ID to new token ID after rebalance
    mapping(uint256 => uint256) public rebalancedTo;

    /// @notice Accumulated protocol fees by currency
    mapping(Currency => uint256) public accumulatedFees;

    /// @notice Last protocol fee change timestamp
    uint256 public lastFeeChangeTime;

    /// @notice Storage gap for upgrades
    uint256[43] private __gap;

    /// @notice Constructor
    constructor(
        address _poolManager,
        address _positionManager,
        address _weth9
    ) V4Base(_poolManager, _positionManager, _weth9) {}

    /// @notice Initialize the contract
    function initialize(address _owner) external initializer {
        __V4Base_init(_owner);
        protocolFee = 65; // 0.65%
    }

    /// @notice Re-initialize for upgrades (sets storage values that were missing in v1)
    function initializeV2() external reinitializer(2) {
        if (protocolFee == 0) protocolFee = 65;
    }

    /// @inheritdoc IV4AutoRange
    function configureRange(uint256 tokenId, RangeConfig calldata config)
        external
        override
        onlyPositionOwnerOrApproved(tokenId)
    {
        require(config.minRebalanceInterval >= MIN_REBALANCE_INTERVAL, "Interval too short");
        require(config.lowerDelta > 0 && config.upperDelta > 0, "Invalid deltas");

        // L-06: Validate tick spacing alignment
        (PoolKey memory poolKey,,,) = getPositionInfo(tokenId);
        int24 tickSpacing = poolKey.tickSpacing;
        require(config.lowerDelta % tickSpacing == 0, "lowerDelta not aligned");
        require(config.upperDelta % tickSpacing == 0, "upperDelta not aligned");

        rangeConfigs[tokenId] = config;
        rangeConfigs[tokenId].enabled = true;

        emit RangeConfigured(
            tokenId,
            msg.sender,
            config.lowerDelta,
            config.upperDelta,
            config.rebalanceThreshold
        );
    }

    /// @inheritdoc IV4AutoRange
    function removeRange(uint256 tokenId)
        external
        override
        onlyPositionOwnerOrApproved(tokenId)
    {
        delete rangeConfigs[tokenId];
        emit RangeRemoved(tokenId);
    }

    /// @inheritdoc IV4AutoRange
    function updateRangeConfig(uint256 tokenId, RangeConfig calldata config)
        external
        override
        onlyPositionOwnerOrApproved(tokenId)
    {
        require(config.minRebalanceInterval >= MIN_REBALANCE_INTERVAL, "Interval too short");
        require(config.lowerDelta > 0 && config.upperDelta > 0, "Invalid deltas");

        // L-06: Validate tick spacing alignment
        (PoolKey memory poolKey,,,) = getPositionInfo(tokenId);
        int24 tickSpacing = poolKey.tickSpacing;
        require(config.lowerDelta % tickSpacing == 0, "lowerDelta not aligned");
        require(config.upperDelta % tickSpacing == 0, "upperDelta not aligned");

        rangeConfigs[tokenId] = config;
    }

    /// @inheritdoc IV4AutoRange
    function executeRebalance(uint256 tokenId, bytes calldata swapData, uint256 deadline)
        external
        override
        nonReentrant
        whenNotPaused
        checkDeadline(deadline)
        returns (RebalanceResult memory result)
    {
        RangeConfig memory config = rangeConfigs[tokenId];
        require(config.enabled, "Not configured");
        require(
            block.timestamp >= lastRebalanceTime[tokenId] + config.minRebalanceInterval,
            "Too soon"
        );

        // Check rebalance conditions
        (bool needsRebalance, uint8 reason) = checkRebalance(tokenId);
        require(needsRebalance, "Rebalance not needed");

        (PoolKey memory poolKey, int24 oldTickLower, int24 oldTickUpper, uint128 oldLiquidity) =
            getPositionInfo(tokenId);

        address owner = IERC721(address(positionManager)).ownerOf(tokenId);

        // H-01: External swap data can only be provided by position owner or approved operators
        if (swapData.length > 0) {
            if (
                msg.sender != owner &&
                !IERC721(address(positionManager)).isApprovedForAll(owner, msg.sender) &&
                IERC721(address(positionManager)).getApproved(tokenId) != msg.sender &&
                !operatorApprovals[owner][msg.sender]
            ) {
                revert NotAuthorized();
            }
        }

        // Collect fees first if configured (wrapped in try-catch to handle positions with no fees)
        uint256 collected0;
        uint256 collected1;
        if (config.collectFeesOnRebalance) {
            try this.collectFeesExternal(tokenId) returns (uint256 c0, uint256 c1) {
                collected0 = c0;
                collected1 = c1;
            } catch {
                // Fee collection failed (e.g., NoLiquidityToReceiveFees when out of range)
                // Continue rebalance without collected fees
                collected0 = 0;
                collected1 = 0;
            }
        }

        // M-NEW-01: Calculate expected amounts for slippage protection on decrease step
        uint256 amount0;
        uint256 amount1;
        {
            (uint256 expected0, uint256 expected1) = PositionValueLib.getAmountsForLiquidity(
                poolManager, poolKey, oldTickLower, oldTickUpper, oldLiquidity
            );
            uint256 decreaseSlippage = config.maxSwapSlippage > 0 ? config.maxSwapSlippage : 500;
            if (decreaseSlippage > 500) decreaseSlippage = 500; // Cap at 5%
            uint256 amount0Min = expected0 * (10000 - decreaseSlippage) / 10000;
            uint256 amount1Min = expected1 * (10000 - decreaseSlippage) / 10000;
            (amount0, amount1) = _decreaseLiquidity(tokenId, oldLiquidity, amount0Min, amount1Min);
        }
        amount0 += collected0;
        amount1 += collected1;

        // Calculate new range
        (int24 newTickLower, int24 newTickUpper) = calculateOptimalRange(tokenId);

        // Get current price info
        (uint160 sqrtPriceX96, int24 currentTick,,) = poolManager.getSlot0(poolKey.toId());

        // M-04: Track pre-swap balances to charge fee only on swap output
        uint256 preSwap0 = amount0;
        uint256 preSwap1 = amount1;

        // Execute swap for optimal ratio
        if (swapData.length > 0) {
            // External router swap
            _executeOptimalSwap(poolKey, newTickLower, newTickUpper, amount0, amount1, swapData, config.maxSwapSlippage);
            // M-NEW-01: Use _getAvailableBalance to exclude previously accumulated protocol fees
            amount0 = _getAvailableBalance(poolKey.currency0);
            amount1 = _getAvailableBalance(poolKey.currency1);
        } else {
            // Check if internal swap is needed
            // If new range spans current tick, we need both tokens
            bool needsBothTokens = currentTick >= newTickLower && currentTick < newTickUpper;
            bool hasOnlyToken0 = amount0 > 0 && amount1 == 0;
            bool hasOnlyToken1 = amount1 > 0 && amount0 == 0;

            if (needsBothTokens && (hasOnlyToken0 || hasOnlyToken1)) {
                // Perform internal pool swap to get the required token
                (amount0, amount1) = _executeInternalSwap(
                    poolKey,
                    currentTick,
                    sqrtPriceX96,
                    newTickLower,
                    newTickUpper,
                    amount0,
                    amount1,
                    config.maxSwapSlippage
                );
            }
        }

        // M-04: Take protocol fee only on swap output (token amounts that increased)
        uint256 fee0 = amount0 > preSwap0 ? (amount0 - preSwap0) * protocolFee / 10000 : 0;
        uint256 fee1 = amount1 > preSwap1 ? (amount1 - preSwap1) * protocolFee / 10000 : 0;
        accumulatedFees[poolKey.currency0] += fee0;
        accumulatedFees[poolKey.currency1] += fee1;
        amount0 -= fee0;
        amount1 -= fee1;

        // Re-fetch price after potential swap (price may have moved)
        (sqrtPriceX96, currentTick,,) = poolManager.getSlot0(poolKey.toId());

        // CRITICAL: Recalculate optimal range based on NEW tick after swap
        // The swap moves the price, so we need to center the range on the new tick
        {
            int24 tickSpacing = poolKey.tickSpacing;
            int24 nearestTick = _floorDiv(currentTick, tickSpacing) * tickSpacing;
            newTickLower = nearestTick - (config.lowerDelta / tickSpacing) * tickSpacing;
            newTickUpper = nearestTick + (config.upperDelta / tickSpacing) * tickSpacing;

            // Ensure valid range
            if (newTickLower < TickMath.MIN_TICK) newTickLower = TickMath.MIN_TICK;
            if (newTickUpper > TickMath.MAX_TICK) newTickUpper = TickMath.MAX_TICK;
        }

        // Calculate new liquidity
        result.liquidity = LiquidityAmounts.getLiquidityForAmounts(
            sqrtPriceX96,
            TickMath.getSqrtPriceAtTick(newTickLower),
            TickMath.getSqrtPriceAtTick(newTickUpper),
            amount0,
            amount1
        );

        // Ensure we have non-zero liquidity
        if (result.liquidity == 0) {
            revert ZeroLiquidityAfterRebalance();
        }

        // Mint new position
        result.newTokenId = _mintPosition(poolKey, newTickLower, newTickUpper, result.liquidity, owner);
        result.newTickLower = newTickLower;
        result.newTickUpper = newTickUpper;
        result.fee0 = fee0;
        result.fee1 = fee1;

        // Update mappings
        lastRebalanceTime[result.newTokenId] = block.timestamp;
        rebalancedTo[tokenId] = result.newTokenId;

        // Transfer config to new position
        rangeConfigs[result.newTokenId] = config;
        delete rangeConfigs[tokenId];

        // Transfer any remaining dust to owner (excluding accumulated fees)
        uint256 remaining0 = _getAvailableBalance(poolKey.currency0);
        uint256 remaining1 = _getAvailableBalance(poolKey.currency1);
        if (remaining0 > 0) _transferCurrency(poolKey.currency0, owner, remaining0);
        if (remaining1 > 0) _transferCurrency(poolKey.currency1, owner, remaining1);

        emit Rebalanced(
            tokenId,
            result.newTokenId,
            newTickLower,
            newTickUpper,
            result.liquidity,
            fee0,
            fee1
        );

        // L-05: Burn the old empty position NFT (best-effort, won't revert rebalance on failure)
        try this.burnPositionExternal(tokenId) {} catch {}
    }

    /// @inheritdoc IV4AutoRange
    function checkRebalance(uint256 tokenId)
        public
        view
        override
        returns (bool needsRebalance, uint8 reason)
    {
        RangeConfig memory config = rangeConfigs[tokenId];
        if (!config.enabled) {
            return (false, 0);
        }

        (PoolKey memory poolKey, int24 tickLower, int24 tickUpper,) = getPositionInfo(tokenId);
        (, int24 currentTick,,) = poolManager.getSlot0(poolKey.toId());

        // Check if out of range
        if (currentTick < tickLower) {
            return (true, 1); // Below range
        } else if (currentTick >= tickUpper) {
            return (true, 2); // Above range
        }

        // Check threshold-based rebalance
        if (config.rebalanceThreshold > 0) {
            int24 rangeWidth = tickUpper - tickLower;
            int24 thresholdTicks = int24(int256(rangeWidth) * int256(uint256(config.rebalanceThreshold)) / 10000);

            if (currentTick < tickLower + thresholdTicks) {
                return (true, 1);
            } else if (currentTick > tickUpper - thresholdTicks) {
                return (true, 2);
            }
        }

        return (false, 0);
    }

    /// @inheritdoc IV4AutoRange
    function getRangeConfig(uint256 tokenId)
        external
        view
        override
        returns (RangeConfig memory config)
    {
        return rangeConfigs[tokenId];
    }

    /// @inheritdoc IV4AutoRange
    function getLastRebalanceTime(uint256 tokenId)
        external
        view
        override
        returns (uint256 timestamp)
    {
        return lastRebalanceTime[tokenId];
    }

    /// @inheritdoc IV4AutoRange
    function batchCheckRebalance(uint256[] calldata tokenIds)
        external
        view
        override
        returns (bool[] memory results)
    {
        results = new bool[](tokenIds.length);
        for (uint256 i = 0; i < tokenIds.length; i++) {
            (results[i],) = checkRebalance(tokenIds[i]);
        }
    }

    /// @inheritdoc IV4AutoRange
    function calculateOptimalRange(uint256 tokenId)
        public
        view
        override
        returns (int24 tickLower, int24 tickUpper)
    {
        RangeConfig memory config = rangeConfigs[tokenId];
        (PoolKey memory poolKey,,,) = getPositionInfo(tokenId);
        (, int24 currentTick,,) = poolManager.getSlot0(poolKey.toId());

        // Round to tick spacing
        int24 tickSpacing = poolKey.tickSpacing;
        int24 nearestTick = _floorDiv(currentTick, tickSpacing) * tickSpacing;

        tickLower = nearestTick - (config.lowerDelta / tickSpacing) * tickSpacing;
        tickUpper = nearestTick + (config.upperDelta / tickSpacing) * tickSpacing;

        // Ensure valid range
        if (tickLower < TickMath.MIN_TICK) tickLower = TickMath.MIN_TICK;
        if (tickUpper > TickMath.MAX_TICK) tickUpper = TickMath.MAX_TICK;
    }

    /// @inheritdoc IV4AutoRange
    function getPositionStatus(uint256 tokenId)
        external
        view
        override
        returns (bool inRange, int24 currentTick, int24 tickLower, int24 tickUpper)
    {
        (PoolKey memory poolKey, int24 _tickLower, int24 _tickUpper,) = getPositionInfo(tokenId);
        (, currentTick,,) = poolManager.getSlot0(poolKey.toId());

        tickLower = _tickLower;
        tickUpper = _tickUpper;
        inRange = currentTick >= tickLower && currentTick < tickUpper;
    }

    /// @inheritdoc IV4AutoRange
    function setProtocolFee(uint256 newFee) external override onlyOwner {
        require(newFee <= MAX_PROTOCOL_FEE, "Fee too high");
        // Skip cooldown for first change (lastFeeChangeTime == 0 means never changed)
        if (lastFeeChangeTime > 0) {
            require(block.timestamp >= lastFeeChangeTime + FEE_CHANGE_COOLDOWN, "Fee change cooldown");
        }
        emit ProtocolFeeUpdated(protocolFee, newFee);
        protocolFee = newFee;
        lastFeeChangeTime = block.timestamp;
    }

    /// @inheritdoc IV4AutoRange
    function withdrawFees(Currency currency, address recipient) external override onlyOwner {
        uint256 amount = accumulatedFees[currency];
        require(amount > 0, "No fees");

        accumulatedFees[currency] = 0;
        _transferCurrency(currency, recipient, amount);

        emit FeesWithdrawn(recipient, currency, amount);
    }

    /// @inheritdoc IV4AutoRange
    function batchWithdrawFees(Currency[] calldata currencies, address recipient) external override onlyOwner {
        for (uint256 i = 0; i < currencies.length; i++) {
            uint256 amount = accumulatedFees[currencies[i]];
            if (amount > 0) {
                accumulatedFees[currencies[i]] = 0;
                _transferCurrency(currencies[i], recipient, amount);
                emit FeesWithdrawn(recipient, currencies[i], amount);
            }
        }
    }

    // ============ External Helper for Try-Catch ============

    /// @notice External wrapper for fee collection to enable try-catch pattern
    /// @dev Only callable by this contract itself
    function collectFeesExternal(uint256 tokenId) external returns (uint256 amount0, uint256 amount1) {
        require(msg.sender == address(this), "Only self");
        return _collectFees(tokenId);
    }

    /// @notice External wrapper for position burn to enable try-catch pattern
    /// @dev Only callable by this contract itself
    function burnPositionExternal(uint256 tokenId) external {
        require(msg.sender == address(this), "Only self");
        _burnPosition(tokenId);
    }

    // ============ Internal Functions ============

    /// @notice Get available balance excluding accumulated protocol fees
    function _getAvailableBalance(Currency currency) internal view returns (uint256) {
        uint256 total = _getBalance(currency);
        uint256 reserved = accumulatedFees[currency];
        return total > reserved ? total - reserved : 0;
    }

    /// @notice Burn an empty position NFT after rebalance
    function _burnPosition(uint256 tokenId) internal {
        (PoolKey memory poolKey,,,) = getPositionInfo(tokenId);

        bytes memory actions = abi.encodePacked(
            uint8(Actions.BURN_POSITION),
            uint8(Actions.TAKE_PAIR)
        );
        bytes[] memory params = new bytes[](2);
        params[0] = abi.encode(tokenId, 0, 0, "");
        params[1] = abi.encode(poolKey.currency0, poolKey.currency1, address(this));

        positionManager.modifyLiquidities(abi.encode(actions, params), block.timestamp);
    }

    function _collectFees(uint256 tokenId) internal returns (uint256 amount0, uint256 amount1) {
        (PoolKey memory poolKey,,,) = getPositionInfo(tokenId);

        // In V4, fees are collected by decreasing liquidity by 0 and then taking the tokens
        bytes memory actions = abi.encodePacked(
            uint8(Actions.DECREASE_LIQUIDITY),
            uint8(Actions.TAKE_PAIR)
        );
        bytes[] memory params = new bytes[](2);
        params[0] = abi.encode(tokenId, 0, 0, 0, ""); // Decrease by 0 to collect fees
        params[1] = abi.encode(poolKey.currency0, poolKey.currency1, address(this));

        uint256 balance0Before = _getBalance(poolKey.currency0);
        uint256 balance1Before = _getBalance(poolKey.currency1);

        positionManager.modifyLiquidities(abi.encode(actions, params), block.timestamp);

        amount0 = _getBalance(poolKey.currency0) - balance0Before;
        amount1 = _getBalance(poolKey.currency1) - balance1Before;
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

    function _mintPosition(
        PoolKey memory poolKey,
        int24 tickLower,
        int24 tickUpper,
        uint128 liquidity,
        address recipient
    ) internal returns (uint256 tokenId) {
        // Get current balances to calculate max amounts
        uint256 balance0 = _getAvailableBalance(poolKey.currency0);
        uint256 balance1 = _getAvailableBalance(poolKey.currency1);

        // Transfer tokens to PositionManager (not PoolManager)
        // PositionManager will then handle the settlement using its own balance
        address pmAddr = address(positionManager);

        if (!poolKey.currency0.isAddressZero() && balance0 > 0) {
            IERC20(Currency.unwrap(poolKey.currency0)).safeTransfer(pmAddr, balance0);
        }
        if (!poolKey.currency1.isAddressZero() && balance1 > 0) {
            IERC20(Currency.unwrap(poolKey.currency1)).safeTransfer(pmAddr, balance1);
        }

        // Encode mint action with SETTLE using OPEN_DELTA (0) and payerIsUser=false
        bytes memory actions = abi.encodePacked(
            uint8(Actions.MINT_POSITION),
            uint8(Actions.SETTLE),
            uint8(Actions.SETTLE),
            uint8(Actions.SWEEP),
            uint8(Actions.SWEEP)
        );
        bytes[] memory params = new bytes[](5);
        params[0] = abi.encode(poolKey, tickLower, tickUpper, liquidity, balance0, balance1, recipient, "");
        // SETTLE params: (currency, amount, payerIsUser)
        // Using OPEN_DELTA (0) to settle exactly the debt amount
        params[1] = abi.encode(poolKey.currency0, uint256(0), false);
        params[2] = abi.encode(poolKey.currency1, uint256(0), false);
        // SWEEP remaining tokens back to this contract
        params[3] = abi.encode(poolKey.currency0, address(this));
        params[4] = abi.encode(poolKey.currency1, address(this));

        uint256 ethValue;
        if (poolKey.currency0.isAddressZero() || poolKey.currency1.isAddressZero()) {
            Currency nativeCurrency = Currency.wrap(address(0));
            uint256 nativeBal = address(this).balance;
            uint256 reserved = accumulatedFees[nativeCurrency];
            ethValue = nativeBal > reserved ? nativeBal - reserved : 0;
        }

        positionManager.modifyLiquidities{value: ethValue}(
            abi.encode(actions, params),
            block.timestamp
        );

        // PositionManager validates slippage internally using SlippageCheck
        tokenId = positionManager.nextTokenId() - 1;

        // M-06: Verify minted token belongs to expected recipient
        require(IERC721(address(positionManager)).ownerOf(tokenId) == recipient, "Unexpected token owner");
    }

    function _executeOptimalSwap(
        PoolKey memory poolKey,
        int24 tickLower,
        int24 tickUpper,
        uint256 amount0,
        uint256 amount1,
        bytes calldata swapData,
        uint256 maxSlippage
    ) internal {
        (address router, bytes memory routerData) = abi.decode(swapData, (address, bytes));
        if (!approvedRouters[router]) revert RouterNotApproved();

        (uint160 sqrtPriceX96,,,) = poolManager.getSlot0(poolKey.toId());

        (bool zeroForOne, uint256 swapAmount) = PositionValueLib.calculateSwapForOptimalRatio(
            amount0,
            amount1,
            sqrtPriceX96,
            tickLower,
            tickUpper
        );

        if (swapAmount > 0) {
            // Use price-based slippage calculation (not simple percentage)
            uint256 minAmountOut = SwapLib.calculateMinOutput(swapAmount, sqrtPriceX96, maxSlippage, zeroForOne);

            SwapLib.SwapParams memory swapParams = SwapLib.SwapParams({
                fromCurrency: zeroForOne ? poolKey.currency0 : poolKey.currency1,
                toCurrency: zeroForOne ? poolKey.currency1 : poolKey.currency0,
                amountIn: swapAmount,
                minAmountOut: minAmountOut,
                router: router,
                swapData: routerData,
                weth9: WETH9
            });

            SwapLib.executeSwap(swapParams);
        }
    }

    function _getBalance(Currency currency) internal view returns (uint256) {
        if (currency.isAddressZero()) {
            return address(this).balance;
        }
        return IERC20(Currency.unwrap(currency)).balanceOf(address(this));
    }

    /// @notice Execute an internal swap using the pool's native swap
    /// @dev Used when no external router swap data is provided but a swap is needed
    function _executeInternalSwap(
        PoolKey memory poolKey,
        int24 currentTick,
        uint160 sqrtPriceX96,
        int24 newTickLower,
        int24 newTickUpper,
        uint256 amount0,
        uint256 amount1,
        uint256 maxSlippage
    ) internal returns (uint256 newAmount0, uint256 newAmount1) {
        // L-NEW-01: Use PositionValueLib for optimal ratio instead of clamped heuristic
        (bool zeroForOne, uint256 swapAmount) = PositionValueLib.calculateSwapForOptimalRatio(
            amount0, amount1, sqrtPriceX96, newTickLower, newTickUpper
        );

        if (swapAmount == 0) {
            return (amount0, amount1);
        }

        // Calculate minimum output using price-based slippage protection
        uint256 minOutput = SwapLib.calculateMinOutput(swapAmount, sqrtPriceX96, maxSlippage, zeroForOne);

        // Execute swap through the pool
        // Use _getAvailableBalance consistently to exclude accumulated protocol fees
        uint256 balance0Before = _getAvailableBalance(poolKey.currency0);
        uint256 balance1Before = _getAvailableBalance(poolKey.currency1);

        // Perform the swap using PoolManager's swap function
        _performPoolSwap(poolKey, zeroForOne, int256(swapAmount), minOutput);

        // Use _getAvailableBalance to exclude previously accumulated protocol fees
        newAmount0 = _getAvailableBalance(poolKey.currency0);
        newAmount1 = _getAvailableBalance(poolKey.currency1);

        // Verify we got some output (both sides use _getAvailableBalance for consistency)
        if (zeroForOne && newAmount1 <= balance1Before) {
            revert InternalSwapFailed();
        }
        if (!zeroForOne && newAmount0 <= balance0Before) {
            revert InternalSwapFailed();
        }
    }

    /// @notice Perform a swap through the PoolManager
    /// @dev This uses the unlock pattern to execute the swap atomically
    function _performPoolSwap(
        PoolKey memory poolKey,
        bool zeroForOne,
        int256 amountSpecified,
        uint256 minOutput
    ) internal {
        // Encode swap parameters for the unlock callback
        bytes memory swapCallbackData = abi.encode(
            poolKey,
            zeroForOne,
            amountSpecified,
            minOutput
        );

        // Transfer input token to PoolManager if needed
        Currency inputCurrency = zeroForOne ? poolKey.currency0 : poolKey.currency1;
        uint256 inputAmount = uint256(amountSpecified);

        if (!inputCurrency.isAddressZero()) {
            // H-04: Use forceApprove instead of safeIncreaseAllowance to prevent allowance accumulation
            address poolManagerAddr = address(poolManager);
            IERC20(Currency.unwrap(inputCurrency)).forceApprove(poolManagerAddr, inputAmount);
        }

        // Execute swap via unlock
        // The swap will be executed inside unlockCallback
        poolManager.unlock(swapCallbackData);

        // Reset approval to prevent leftover allowance
        if (!inputCurrency.isAddressZero()) {
            IERC20(Currency.unwrap(inputCurrency)).forceApprove(address(poolManager), 0);
        }
    }

    /// @notice Callback from PoolManager.unlock for executing swaps
    /// @dev This is called by PoolManager during unlock
    function unlockCallback(bytes calldata data) external returns (bytes memory) {
        require(msg.sender == address(poolManager), "Only PoolManager");

        (PoolKey memory poolKey, bool zeroForOne, int256 amountSpecified, uint256 minOutput) =
            abi.decode(data, (PoolKey, bool, int256, uint256));

        // Execute the swap
        // In V4: negative amountSpecified = exact input
        BalanceDelta delta = poolManager.swap(
            poolKey,
            SwapParams({
                zeroForOne: zeroForOne,
                amountSpecified: -amountSpecified, // Negative = exact input in V4
                sqrtPriceLimitX96: zeroForOne ? TickMath.MIN_SQRT_PRICE + 1 : TickMath.MAX_SQRT_PRICE - 1
            }),
            ""
        );

        // H-NEW-01: Enforce slippage protection on internal swap output
        if (minOutput > 0) {
            int128 outputDelta = zeroForOne ? delta.amount1() : delta.amount0();
            require(outputDelta > 0 && uint256(int256(outputDelta)) >= minOutput, "Slippage exceeded");
        }

        // Get the delta amounts
        int128 delta0 = delta.amount0();
        int128 delta1 = delta.amount1();

        // Settle what we owe (negative deltas)
        if (delta0 < 0) {
            uint256 amountToSettle = uint256(int256(-delta0));
            if (poolKey.currency0.isAddressZero()) {
                poolManager.settle{value: amountToSettle}();
            } else {
                poolManager.sync(poolKey.currency0);
                IERC20(Currency.unwrap(poolKey.currency0)).safeTransfer(address(poolManager), amountToSettle);
                poolManager.settle();
            }
        }

        if (delta1 < 0) {
            uint256 amountToSettle = uint256(int256(-delta1));
            if (poolKey.currency1.isAddressZero()) {
                poolManager.settle{value: amountToSettle}();
            } else {
                poolManager.sync(poolKey.currency1);
                IERC20(Currency.unwrap(poolKey.currency1)).safeTransfer(address(poolManager), amountToSettle);
                poolManager.settle();
            }
        }

        // Take what we're owed (positive deltas)
        if (delta0 > 0) {
            uint256 amountToTake = uint256(int256(delta0));
            poolManager.take(poolKey.currency0, address(this), amountToTake);
        }

        if (delta1 > 0) {
            uint256 amountToTake = uint256(int256(delta1));
            poolManager.take(poolKey.currency1, address(this), amountToTake);
        }

        return "";
    }
}
