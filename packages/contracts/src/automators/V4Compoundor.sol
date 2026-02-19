// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import { IPoolManager } from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import { PoolKey } from "@uniswap/v4-core/src/types/PoolKey.sol";
import { PoolId, PoolIdLibrary } from "@uniswap/v4-core/src/types/PoolId.sol";
import { Currency, CurrencyLibrary } from "@uniswap/v4-core/src/types/Currency.sol";
import { BalanceDelta } from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import { StateLibrary } from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import { TickMath } from "@uniswap/v4-core/src/libraries/TickMath.sol";
import { FullMath } from "@uniswap/v4-core/src/libraries/FullMath.sol";
import { FixedPoint128 } from "@uniswap/v4-core/src/libraries/FixedPoint128.sol";
import { IPositionManager } from "@uniswap/v4-periphery/src/interfaces/IPositionManager.sol";
import { Actions } from "@uniswap/v4-periphery/src/libraries/Actions.sol";
import { IERC721 } from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import { V4Base } from "../base/V4Base.sol";
import { IV4Compoundor } from "../interfaces/IV4Compoundor.sol";
import { SwapLib } from "../libraries/SwapLib.sol";
import { LiquidityAmounts } from "@uniswap/v4-periphery/src/libraries/LiquidityAmounts.sol";
import { PositionValueLib } from "../libraries/PositionValueLib.sol";

/// @title V4Compoundor
/// @notice Automated fee compounding for Uniswap V4 positions
/// @dev Allows external callers to compound fees in exchange for a reward
contract V4Compoundor is V4Base, IV4Compoundor {
    using SafeERC20 for IERC20;
    using CurrencyLibrary for Currency;
    using PoolIdLibrary for PoolKey;
    using StateLibrary for IPoolManager;

    /// @notice Contract version
    string public constant VERSION = "1.1.0";

    /// @notice Protocol fee in basis points (0.65%)
    uint256 public override protocolFee = 65;

    /// @dev Deprecated: was callerReward. Kept as placeholder to preserve storage layout.
    uint256 private __deprecated_callerReward;

    /// @notice Maximum protocol fee (10%)
    uint256 public constant MAX_PROTOCOL_FEE = 1000;

    /// @notice Cooldown period between protocol fee changes
    uint256 public constant FEE_CHANGE_COOLDOWN = 24 hours;

    /// @notice Minimum compound interval (5 minutes)
    uint32 public constant MIN_COMPOUND_INTERVAL = 300;

    /// @notice Compound configurations by token ID
    mapping(uint256 => CompoundConfig) public configs;

    /// @notice Last compound time by token ID
    mapping(uint256 => uint256) public lastCompoundTime;

    /// @notice Accumulated protocol fees by currency
    mapping(Currency => uint256) public accumulatedFees;

    /// @notice Maximum slippage for compound swaps (basis points, default 2%)
    uint256 public maxCompoundSlippage = 200;

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
        maxCompoundSlippage = 200; // 2%
    }

    /// @notice Re-initialize for upgrades (sets storage values that were missing in v1)
    function initializeV2() external reinitializer(2) {
        if (protocolFee == 0) protocolFee = 65;
        if (maxCompoundSlippage == 0) maxCompoundSlippage = 200;
    }

    /// @inheritdoc IV4Compoundor
    function registerPosition(uint256 tokenId, CompoundConfig calldata config)
        external
        override
        onlyPositionOwnerOrApproved(tokenId)
    {
        require(config.minCompoundInterval >= MIN_COMPOUND_INTERVAL, "Interval too short");

        configs[tokenId] = config;
        configs[tokenId].enabled = true;

        emit PositionRegistered(tokenId, msg.sender);
    }

    /// @inheritdoc IV4Compoundor
    function unregisterPosition(uint256 tokenId)
        external
        override
        onlyPositionOwnerOrApproved(tokenId)
    {
        delete configs[tokenId];
        emit PositionUnregistered(tokenId, msg.sender);
    }

    /// @inheritdoc IV4Compoundor
    function updateConfig(uint256 tokenId, CompoundConfig calldata config)
        external
        override
        onlyPositionOwnerOrApproved(tokenId)
    {
        require(config.minCompoundInterval >= MIN_COMPOUND_INTERVAL, "Interval too short");
        configs[tokenId] = config;
        emit ConfigUpdated(tokenId, msg.sender);
    }

    /// @inheritdoc IV4Compoundor
    function autoCompound(uint256 tokenId, bytes calldata swapData, uint256 deadline)
        external
        override
        nonReentrant
        whenNotPaused
        checkDeadline(deadline)
        returns (CompoundResult memory result)
    {
        CompoundConfig memory config = configs[tokenId];
        require(config.enabled, "Not registered");
        require(
            block.timestamp >= lastCompoundTime[tokenId] + config.minCompoundInterval,
            "Too soon"
        );

        // H-02: External swap data can only be provided by position owner or approved operators
        if (swapData.length > 0) {
            address owner = IERC721(address(positionManager)).ownerOf(tokenId);
            if (
                msg.sender != owner &&
                !IERC721(address(positionManager)).isApprovedForAll(owner, msg.sender) &&
                IERC721(address(positionManager)).getApproved(tokenId) != msg.sender &&
                !operatorApprovals[owner][msg.sender]
            ) {
                revert NotAuthorized();
            }
        }

        // Execute compound
        result = _compound(tokenId, swapData, true);

        // Update last compound time
        lastCompoundTime[tokenId] = block.timestamp;

        emit AutoCompounded(
            tokenId,
            msg.sender,
            result.amount0Compounded,
            result.amount1Compounded,
            result.fee0,
            result.fee1,
            result.liquidityAdded
        );
    }

    /// @inheritdoc IV4Compoundor
    function selfCompound(uint256 tokenId, bytes calldata swapData, uint256 deadline)
        external
        override
        nonReentrant
        whenNotPaused
        checkDeadline(deadline)
        onlyPositionOwnerOrApproved(tokenId)
        returns (CompoundResult memory result)
    {
        // Execute compound without taking fees
        result = _compound(tokenId, swapData, false);

        lastCompoundTime[tokenId] = block.timestamp;

        emit AutoCompounded(
            tokenId,
            msg.sender,
            result.amount0Compounded,
            result.amount1Compounded,
            0,
            0,
            result.liquidityAdded
        );
    }

    /// @inheritdoc IV4Compoundor
    function isCompoundProfitable(uint256 tokenId)
        public
        view
        override
        returns (bool profitable, uint256 estimatedReward)
    {
        CompoundConfig memory config = configs[tokenId];
        if (!config.enabled) return (false, 0);

        // Get pending fees
        (uint256 amount0, uint256 amount1) = getPendingFees(tokenId);

        // I-04: Check each token independently (they may have different decimals)
        estimatedReward = 0;
        profitable = amount0 >= config.minRewardAmount || amount1 >= config.minRewardAmount;
    }

    /// @inheritdoc IV4Compoundor
    function getConfig(uint256 tokenId)
        external
        view
        override
        returns (CompoundConfig memory config)
    {
        return configs[tokenId];
    }

    /// @inheritdoc IV4Compoundor
    function getPendingFees(uint256 tokenId)
        public
        view
        override
        returns (uint256 amount0, uint256 amount1)
    {
        // Get position info
        (PoolKey memory poolKey, int24 tickLower, int24 tickUpper, uint128 liquidity) =
            getPositionInfo(tokenId);

        if (liquidity == 0) return (0, 0);

        // Get poolId
        PoolId poolId = poolKey.toId();

        // Get the position's stored fee growth (from last interaction)
        (, uint256 feeGrowthInside0LastX128, uint256 feeGrowthInside1LastX128) =
            poolManager.getPositionInfo(poolId, address(positionManager), tickLower, tickUpper, bytes32(tokenId));

        // Get current fee growth inside the tick range
        (uint256 feeGrowthInside0X128, uint256 feeGrowthInside1X128) =
            poolManager.getFeeGrowthInside(poolId, tickLower, tickUpper);

        // Calculate uncollected fees
        amount0 = FullMath.mulDiv(
            feeGrowthInside0X128 - feeGrowthInside0LastX128,
            liquidity,
            FixedPoint128.Q128
        );

        amount1 = FullMath.mulDiv(
            feeGrowthInside1X128 - feeGrowthInside1LastX128,
            liquidity,
            FixedPoint128.Q128
        );
    }

    /// @inheritdoc IV4Compoundor
    function getLastCompoundTime(uint256 tokenId)
        external
        view
        override
        returns (uint256 timestamp)
    {
        return lastCompoundTime[tokenId];
    }

    /// @inheritdoc IV4Compoundor
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

    /// @notice Set maximum slippage for compound swaps
    /// @param newSlippage New slippage in basis points (max 1000 = 10%)
    function setMaxCompoundSlippage(uint256 newSlippage) external onlyOwner {
        require(newSlippage <= 1000, "Slippage too high");
        maxCompoundSlippage = newSlippage;
    }

    /// @inheritdoc IV4Compoundor
    function withdrawFees(Currency currency, address recipient) external override onlyOwner {
        uint256 amount = accumulatedFees[currency];
        require(amount > 0, "No fees");

        accumulatedFees[currency] = 0;
        _transferCurrency(currency, recipient, amount);

        emit FeesWithdrawn(recipient, currency, amount);
    }

    /// @inheritdoc IV4Compoundor
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

    // ============ Internal Functions ============

    /// @notice Get available balance excluding accumulated protocol fees
    function _getAvailableBalance(Currency currency) internal view returns (uint256) {
        uint256 total = _getBalance(currency);
        uint256 reserved = accumulatedFees[currency];
        return total > reserved ? total - reserved : 0;
    }

    function _compound(
        uint256 tokenId,
        bytes calldata swapData,
        bool takeFees
    ) internal returns (CompoundResult memory result) {
        (PoolKey memory poolKey, int24 tickLower, int24 tickUpper, uint128 currentLiquidity) =
            getPositionInfo(tokenId);

        // Collect fees to this contract
        (uint256 collected0, uint256 collected1) = _collectFees(tokenId);

        if (collected0 == 0 && collected1 == 0) {
            return result;
        }

        // Calculate and deduct protocol fee
        if (takeFees) {
            uint256 fee0 = collected0 * protocolFee / 10000;
            uint256 fee1 = collected1 * protocolFee / 10000;

            // Accumulate protocol fees (no caller reward)
            accumulatedFees[poolKey.currency0] += fee0;
            accumulatedFees[poolKey.currency1] += fee1;

            collected0 -= fee0;
            collected1 -= fee1;

            result.fee0 = fee0;
            result.fee1 = fee1;
        }

        // Execute swap if needed to optimize ratio
        if (swapData.length > 0) {
            _executeOptimalSwap(poolKey, tickLower, tickUpper, swapData);
            collected0 = _getAvailableBalance(poolKey.currency0);
            collected1 = _getAvailableBalance(poolKey.currency1);
        }

        // Report post-swap amounts so events reflect actual compounded token split
        result.amount0Compounded = collected0;
        result.amount1Compounded = collected1;

        // Calculate liquidity to add based on collected amounts
        (uint160 sqrtPriceX96,,,) = poolManager.getSlot0(poolKey.toId());
        uint160 sqrtPriceAX96 = TickMath.getSqrtPriceAtTick(tickLower);
        uint160 sqrtPriceBX96 = TickMath.getSqrtPriceAtTick(tickUpper);

        result.liquidityAdded = LiquidityAmounts.getLiquidityForAmounts(
            sqrtPriceX96,
            sqrtPriceAX96,
            sqrtPriceBX96,
            collected0,
            collected1
        );

        if (result.liquidityAdded > 0) {
            // Add liquidity back to position
            _increaseLiquidity(tokenId, result.liquidityAdded, collected0, collected1);
        }

        // Return any remaining dust to position owner (excluding accumulated fees)
        address owner = IERC721(address(positionManager)).ownerOf(tokenId);
        uint256 remaining0 = _getAvailableBalance(poolKey.currency0);
        uint256 remaining1 = _getAvailableBalance(poolKey.currency1);

        if (remaining0 > 0) {
            _transferCurrency(poolKey.currency0, owner, remaining0);
        }
        if (remaining1 > 0) {
            _transferCurrency(poolKey.currency1, owner, remaining1);
        }
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

    function _increaseLiquidity(
        uint256 tokenId,
        uint128 liquidity,
        uint256 amount0Max,
        uint256 amount1Max
    ) internal {
        (PoolKey memory poolKey,,,) = getPositionInfo(tokenId);

        // Get current available balances (excluding protocol fees)
        uint256 balance0 = _getAvailableBalance(poolKey.currency0);
        uint256 balance1 = _getAvailableBalance(poolKey.currency1);

        // Transfer ERC20 tokens to PositionManager (not native ETH)
        address pmAddr = address(positionManager);

        if (!poolKey.currency0.isAddressZero() && balance0 > 0) {
            IERC20(Currency.unwrap(poolKey.currency0)).safeTransfer(pmAddr, balance0);
        }
        if (!poolKey.currency1.isAddressZero() && balance1 > 0) {
            IERC20(Currency.unwrap(poolKey.currency1)).safeTransfer(pmAddr, balance1);
        }

        // Determine if we have native ETH
        bool currency0IsNative = poolKey.currency0.isAddressZero();
        bool currency1IsNative = poolKey.currency1.isAddressZero();

        bytes memory actions = abi.encodePacked(
            uint8(Actions.INCREASE_LIQUIDITY),
            uint8(Actions.SETTLE),
            uint8(Actions.SETTLE),
            uint8(Actions.SWEEP),
            uint8(Actions.SWEEP)
        );
        bytes[] memory params = new bytes[](5);
        params[0] = abi.encode(tokenId, liquidity, amount0Max, amount1Max, "");
        params[1] = abi.encode(poolKey.currency0, uint256(0), currency0IsNative);
        params[2] = abi.encode(poolKey.currency1, uint256(0), currency1IsNative);
        params[3] = abi.encode(poolKey.currency0, address(this));
        params[4] = abi.encode(poolKey.currency1, address(this));

        uint256 ethValue;
        if (currency0IsNative || currency1IsNative) {
            Currency nativeCurrency = Currency.wrap(address(0));
            uint256 nativeBal = address(this).balance;
            uint256 reserved = accumulatedFees[nativeCurrency];
            ethValue = nativeBal > reserved ? nativeBal - reserved : 0;
        }

        positionManager.modifyLiquidities{value: ethValue}(
            abi.encode(actions, params),
            block.timestamp
        );
    }

    function _executeOptimalSwap(
        PoolKey memory poolKey,
        int24 tickLower,
        int24 tickUpper,
        bytes calldata swapData
    ) internal {
        if (swapData.length == 0) return;

        (address router, bytes memory routerData) = abi.decode(swapData, (address, bytes));
        if (!approvedRouters[router]) revert RouterNotApproved();

        // Calculate optimal ratio and swap
        (uint160 sqrtPriceX96,,,) = poolManager.getSlot0(poolKey.toId());
        uint256 balance0 = _getAvailableBalance(poolKey.currency0);
        uint256 balance1 = _getAvailableBalance(poolKey.currency1);

        (bool zeroForOne, uint256 swapAmount) = PositionValueLib.calculateSwapForOptimalRatio(
            balance0,
            balance1,
            sqrtPriceX96,
            tickLower,
            tickUpper
        );

        if (swapAmount > 0) {
            // Calculate minimum output using price-based slippage protection
            uint256 minAmountOut = SwapLib.calculateMinOutput(swapAmount, sqrtPriceX96, maxCompoundSlippage, zeroForOne);

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
}
