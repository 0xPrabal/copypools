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
    string public constant VERSION = "1.0.0";

    /// @notice Protocol fee in basis points (2%)
    uint256 public override protocolFee = 200;

    /// @notice Caller reward in basis points (from protocol fee)
    uint256 public override callerReward = 100;

    /// @notice Maximum protocol fee (10%)
    uint256 public constant MAX_PROTOCOL_FEE = 1000;

    /// @notice Minimum compound interval (5 minutes)
    uint32 public constant MIN_COMPOUND_INTERVAL = 300;

    /// @notice Compound configurations by token ID
    mapping(uint256 => CompoundConfig) public configs;

    /// @notice Last compound time by token ID
    mapping(uint256 => uint256) public lastCompoundTime;

    /// @notice Accumulated protocol fees by currency
    mapping(Currency => uint256) public accumulatedFees;

    /// @notice Storage gap for upgrades
    uint256[45] private __gap;

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
    }

    /// @inheritdoc IV4Compoundor
    function autoCompound(uint256 tokenId, bytes calldata swapData)
        external
        override
        nonReentrant
        whenNotPaused
        returns (CompoundResult memory result)
    {
        CompoundConfig memory config = configs[tokenId];
        require(config.enabled, "Not registered");
        require(
            block.timestamp >= lastCompoundTime[tokenId] + config.minCompoundInterval,
            "Too soon"
        );

        // Verify profitable for caller
        (bool profitable,) = isCompoundProfitable(tokenId);
        require(profitable, "Not profitable");

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
    function selfCompound(uint256 tokenId, bytes calldata swapData)
        external
        override
        nonReentrant
        whenNotPaused
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

        // Calculate reward value
        // In production, this would use oracle prices
        estimatedReward = (amount0 + amount1) * callerReward / 10000;

        // Check if reward meets minimum
        profitable = estimatedReward >= config.minRewardAmount;
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
        // The salt for PositionManager positions is the tokenId
        (, uint256 feeGrowthInside0LastX128, uint256 feeGrowthInside1LastX128) =
            poolManager.getPositionInfo(poolId, address(positionManager), tickLower, tickUpper, bytes32(tokenId));

        // Get current fee growth inside the tick range
        (uint256 feeGrowthInside0X128, uint256 feeGrowthInside1X128) =
            poolManager.getFeeGrowthInside(poolId, tickLower, tickUpper);

        // Calculate uncollected fees
        // uncollectedFees = (feeGrowthInside_current - feeGrowthInside_last) * liquidity / Q128
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
        emit ProtocolFeeUpdated(protocolFee, newFee);
        protocolFee = newFee;
    }

    /// @inheritdoc IV4Compoundor
    function setCallerReward(uint256 newReward) external override onlyOwner {
        require(newReward <= protocolFee, "Reward exceeds fee");
        emit CallerRewardUpdated(callerReward, newReward);
        callerReward = newReward;
    }

    /// @inheritdoc IV4Compoundor
    function withdrawFees(Currency currency, address recipient) external override onlyOwner {
        uint256 amount = accumulatedFees[currency];
        require(amount > 0, "No fees");

        accumulatedFees[currency] = 0;
        _transferCurrency(currency, recipient, amount);

        emit FeesWithdrawn(recipient, currency, amount);
    }

    // ============ Internal Functions ============

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

            // Pay caller reward
            uint256 reward0 = collected0 * callerReward / 10000;
            uint256 reward1 = collected1 * callerReward / 10000;

            _transferCurrency(poolKey.currency0, msg.sender, reward0);
            _transferCurrency(poolKey.currency1, msg.sender, reward1);

            // Accumulate protocol portion (minus caller reward)
            accumulatedFees[poolKey.currency0] += fee0 - reward0;
            accumulatedFees[poolKey.currency1] += fee1 - reward1;

            collected0 -= fee0;
            collected1 -= fee1;

            result.fee0 = fee0;
            result.fee1 = fee1;
        }

        result.amount0Compounded = collected0;
        result.amount1Compounded = collected1;

        // Execute swap if needed to optimize ratio
        if (swapData.length > 0) {
            _executeOptimalSwap(poolKey, tickLower, tickUpper, swapData);
            collected0 = _getBalance(poolKey.currency0);
            collected1 = _getBalance(poolKey.currency1);
        }

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
            // Use collected amounts as max - this is what we actually have available
            _increaseLiquidity(tokenId, result.liquidityAdded, collected0, collected1);
        }

        // Return any remaining dust to position owner
        address owner = IERC721(address(positionManager)).ownerOf(tokenId);
        uint256 remaining0 = _getBalance(poolKey.currency0);
        uint256 remaining1 = _getBalance(poolKey.currency1);

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

        // Get current balances
        uint256 balance0 = _getBalance(poolKey.currency0);
        uint256 balance1 = _getBalance(poolKey.currency1);

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

        // For native ETH: use payerIsUser=true with msg.value
        // For ERC20: use payerIsUser=false (already transferred to PM)
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
        // For native ETH: payerIsUser=true uses msg.value
        // For ERC20: payerIsUser=false uses PM's balance (pre-transferred)
        params[1] = abi.encode(poolKey.currency0, uint256(0), currency0IsNative);
        params[2] = abi.encode(poolKey.currency1, uint256(0), currency1IsNative);
        // SWEEP remaining tokens back to this contract
        params[3] = abi.encode(poolKey.currency0, address(this));
        params[4] = abi.encode(poolKey.currency1, address(this));

        uint256 ethValue = (currency0IsNative || currency1IsNative)
            ? address(this).balance
            : 0;

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
        uint256 balance0 = _getBalance(poolKey.currency0);
        uint256 balance1 = _getBalance(poolKey.currency1);

        (bool zeroForOne, uint256 swapAmount) = PositionValueLib.calculateSwapForOptimalRatio(
            balance0,
            balance1,
            sqrtPriceX96,
            tickLower,
            tickUpper
        );

        if (swapAmount > 0) {
            SwapLib.SwapParams memory swapParams = SwapLib.SwapParams({
                fromCurrency: zeroForOne ? poolKey.currency0 : poolKey.currency1,
                toCurrency: zeroForOne ? poolKey.currency1 : poolKey.currency0,
                amountIn: swapAmount,
                minAmountOut: 0,
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
