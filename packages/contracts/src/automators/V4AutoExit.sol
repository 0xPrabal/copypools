// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import { IPoolManager } from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import { PoolKey } from "@uniswap/v4-core/src/types/PoolKey.sol";
import { PoolId, PoolIdLibrary } from "@uniswap/v4-core/src/types/PoolId.sol";
import { Currency, CurrencyLibrary } from "@uniswap/v4-core/src/types/Currency.sol";
import { StateLibrary } from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import { TickMath } from "@uniswap/v4-core/src/libraries/TickMath.sol";
import { IPositionManager } from "@uniswap/v4-periphery/src/interfaces/IPositionManager.sol";
import { Actions } from "@uniswap/v4-periphery/src/libraries/Actions.sol";
import { IERC721 } from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import { V4Base } from "../base/V4Base.sol";
import { IV4AutoExit } from "../interfaces/IV4AutoExit.sol";
import { SwapLib } from "../libraries/SwapLib.sol";
import { PositionValueLib } from "../libraries/PositionValueLib.sol";

/// @title V4AutoExit
/// @notice Automated position exit for Uniswap V4 positions
/// @dev Supports stop-loss, take-profit, and out-of-range exit triggers.
///      Bots call executeExit() when conditions are met. Owners can selfExit() without protocol fee.
contract V4AutoExit is V4Base, IV4AutoExit {
    using SafeERC20 for IERC20;
    using CurrencyLibrary for Currency;
    using PoolIdLibrary for PoolKey;
    using StateLibrary for IPoolManager;

    // ============ Constants ============

    /// @notice Contract version
    string public constant VERSION = "1.0.0";

    /// @notice Minimum exit interval (5 minutes)
    uint32 public constant MIN_EXIT_INTERVAL = 300;

    /// @notice Maximum protocol fee (10%)
    uint256 public constant MAX_PROTOCOL_FEE = 1000;

    /// @notice Cooldown period between protocol fee changes
    uint256 public constant FEE_CHANGE_COOLDOWN = 24 hours;

    // ============ State Variables ============

    /// @notice Protocol fee in basis points (0.65%)
    uint256 public override protocolFee = 65;

    /// @notice Exit configurations by token ID
    mapping(uint256 => ExitConfig) private _exitConfigs;

    /// @notice Configuration timestamp by token ID
    mapping(uint256 => uint256) private _configTimestamp;

    /// @notice Accumulated protocol fees by currency
    mapping(Currency => uint256) public override accumulatedFees;

    /// @notice Last protocol fee change timestamp
    uint256 public lastFeeChangeTime;

    /// @notice Storage gap for upgrades
    uint256[43] private __gap;

    // ============ Constructor & Initializers ============

    constructor(
        address _poolManager,
        address _positionManager,
        address _weth9
    ) V4Base(_poolManager, _positionManager, _weth9) {}

    /// @notice Initialize the contract
    function initialize(address _owner) external initializer {
        __V4Base_init(_owner);
        protocolFee = 65; // 0.65% - must set in initialize for proxy storage
    }

    /// @notice Re-initialize for upgrades (sets storage values that were missing in v1)
    function initializeV2() external reinitializer(2) {
        if (protocolFee == 0) protocolFee = 65;
    }

    // ============ User Configuration ============

    /// @inheritdoc IV4AutoExit
    function configureExit(uint256 tokenId, ExitConfig calldata config)
        external
        override
        onlyPositionOwnerOrApproved(tokenId)
    {
        _validateExitConfig(config);

        // Validate position has liquidity
        (,,, uint128 liquidity) = getPositionInfo(tokenId);
        if (liquidity == 0) revert NoLiquidity();

        _exitConfigs[tokenId] = config;
        _exitConfigs[tokenId].enabled = true;
        _configTimestamp[tokenId] = block.timestamp;

        address posOwner = IERC721(address(positionManager)).ownerOf(tokenId);
        emit ExitConfigured(
            tokenId,
            posOwner,
            config.triggerTickLower,
            config.triggerTickUpper,
            config.exitOnRangeExit
        );
    }

    /// @inheritdoc IV4AutoExit
    function removeExit(uint256 tokenId)
        external
        override
        onlyPositionOwnerOrApproved(tokenId)
    {
        delete _exitConfigs[tokenId];
        delete _configTimestamp[tokenId];
        emit ExitRemoved(tokenId);
    }

    /// @inheritdoc IV4AutoExit
    function updateExitConfig(uint256 tokenId, ExitConfig calldata config)
        external
        override
        onlyPositionOwnerOrApproved(tokenId)
    {
        _validateExitConfig(config);

        _exitConfigs[tokenId] = config;
        _exitConfigs[tokenId].enabled = true;
        // Reset config timestamp so minExitInterval applies from update
        _configTimestamp[tokenId] = block.timestamp;
    }

    // ============ Bot Execution ============

    /// @inheritdoc IV4AutoExit
    function executeExit(uint256 tokenId, bytes calldata swapData, uint256 deadline)
        external
        override
        nonReentrant
        whenNotPaused
        checkDeadline(deadline)
        returns (ExitResult memory result)
    {
        result = _exit(tokenId, swapData, true);
    }

    /// @inheritdoc IV4AutoExit
    function selfExit(uint256 tokenId, bytes calldata swapData, uint256 deadline)
        external
        override
        nonReentrant
        whenNotPaused
        checkDeadline(deadline)
        onlyPositionOwnerOrApproved(tokenId)
        returns (ExitResult memory result)
    {
        result = _exit(tokenId, swapData, false);
    }

    // ============ View Functions ============

    /// @inheritdoc IV4AutoExit
    function checkExit(uint256 tokenId)
        public
        view
        override
        returns (bool needsExit, uint8 reason)
    {
        ExitConfig memory config = _exitConfigs[tokenId];
        if (!config.enabled) return (false, 0);

        (PoolKey memory poolKey, int24 tickLower, int24 tickUpper,) = getPositionInfo(tokenId);
        (, int24 currentTick,,) = poolManager.getSlot0(poolKey.toId());

        // Check stop-loss: currentTick <= triggerTickLower
        if (currentTick <= config.triggerTickLower) {
            return (true, 1);
        }

        // Check take-profit: currentTick >= triggerTickUpper
        if (currentTick >= config.triggerTickUpper) {
            return (true, 2);
        }

        // Check out-of-range
        if (config.exitOnRangeExit) {
            if (currentTick < tickLower || currentTick >= tickUpper) {
                return (true, 3);
            }
        }

        return (false, 0);
    }

    /// @inheritdoc IV4AutoExit
    function batchCheckExit(uint256[] calldata tokenIds)
        external
        view
        override
        returns (bool[] memory results)
    {
        results = new bool[](tokenIds.length);
        for (uint256 i = 0; i < tokenIds.length; i++) {
            (results[i],) = checkExit(tokenIds[i]);
        }
    }

    /// @inheritdoc IV4AutoExit
    function getExitConfig(uint256 tokenId) external view override returns (ExitConfig memory) {
        return _exitConfigs[tokenId];
    }

    /// @inheritdoc IV4AutoExit
    function getConfigTimestamp(uint256 tokenId) external view override returns (uint256) {
        return _configTimestamp[tokenId];
    }

    // ============ Protocol Fee Management ============

    /// @inheritdoc IV4AutoExit
    function setProtocolFee(uint256 newFee) external override onlyOwner {
        require(newFee <= MAX_PROTOCOL_FEE, "Fee too high");
        if (lastFeeChangeTime > 0) {
            require(block.timestamp >= lastFeeChangeTime + FEE_CHANGE_COOLDOWN, "Fee change cooldown");
        }
        emit ProtocolFeeUpdated(protocolFee, newFee);
        protocolFee = newFee;
        lastFeeChangeTime = block.timestamp;
    }

    /// @inheritdoc IV4AutoExit
    function withdrawFees(Currency currency, address recipient) external override onlyOwner {
        uint256 amount = accumulatedFees[currency];
        require(amount > 0, "No fees");

        accumulatedFees[currency] = 0;
        _transferCurrency(currency, recipient, amount);

        emit FeesWithdrawn(recipient, currency, amount);
    }

    /// @inheritdoc IV4AutoExit
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

    // ============ Internal Functions ============

    /// @notice Validate exit configuration
    function _validateExitConfig(ExitConfig calldata config) internal pure {
        require(config.minExitInterval >= MIN_EXIT_INTERVAL, "Interval too short");

        // At least one trigger must be active
        bool hasTickTrigger = config.triggerTickLower > TickMath.MIN_TICK
            || config.triggerTickUpper < TickMath.MAX_TICK;
        require(hasTickTrigger || config.exitOnRangeExit, "No triggers set");

        // If both tick triggers are set, upper must be > lower
        if (config.triggerTickLower > TickMath.MIN_TICK && config.triggerTickUpper < TickMath.MAX_TICK) {
            if (config.triggerTickUpper <= config.triggerTickLower) revert InvalidTriggerTicks();
        }
    }

    /// @notice Core exit logic shared by executeExit and selfExit
    function _exit(
        uint256 tokenId,
        bytes calldata swapData,
        bool takeFees
    ) internal returns (ExitResult memory result) {
        ExitConfig memory config = _exitConfigs[tokenId];
        if (!config.enabled) revert ExitNotConfigured();

        // Check exit conditions
        (bool needsExit, uint8 reason) = checkExit(tokenId);
        if (!needsExit) revert ExitConditionsNotMet();

        // Check cooldown (minExitInterval from configuration time)
        if (block.timestamp < _configTimestamp[tokenId] + config.minExitInterval) {
            revert ExitTooSoon();
        }

        (PoolKey memory poolKey, int24 tickLower, int24 tickUpper, uint128 liquidity) =
            getPositionInfo(tokenId);
        if (liquidity == 0) revert NoLiquidity();

        address posOwner = IERC721(address(positionManager)).ownerOf(tokenId);

        // H-01: External swap data can only be provided by position owner or approved operators
        if (swapData.length > 0) {
            if (
                msg.sender != posOwner &&
                !IERC721(address(positionManager)).isApprovedForAll(posOwner, msg.sender) &&
                IERC721(address(positionManager)).getApproved(tokenId) != msg.sender &&
                !operatorApprovals[posOwner][msg.sender]
            ) {
                revert NotAuthorized();
            }
        }

        // Step 1: Collect pending fees (try-catch to handle positions with no accumulated fees)
        uint256 collected0;
        uint256 collected1;
        try this.collectFeesExternal(tokenId) returns (uint256 c0, uint256 c1) {
            collected0 = c0;
            collected1 = c1;
        } catch {
            collected0 = 0;
            collected1 = 0;
        }

        // Step 2: Remove ALL liquidity with slippage protection
        uint256 amount0;
        uint256 amount1;
        {
            (uint256 expected0, uint256 expected1) = PositionValueLib.getAmountsForLiquidity(
                poolManager, poolKey, tickLower, tickUpper, liquidity
            );
            uint256 decreaseSlippage = config.maxSwapSlippage > 0 ? config.maxSwapSlippage : 500;
            if (decreaseSlippage > 500) decreaseSlippage = 500; // Cap at 5%
            uint256 amount0Min = expected0 * (10000 - decreaseSlippage) / 10000;
            uint256 amount1Min = expected1 * (10000 - decreaseSlippage) / 10000;
            (amount0, amount1) = _decreaseLiquidity(tokenId, liquidity, amount0Min, amount1Min);
        }
        amount0 += collected0;
        amount1 += collected1;

        result.liquidityRemoved = liquidity;
        result.exitReason = reason;

        // Step 3: Take protocol fee (only for bot-triggered exits)
        if (takeFees && protocolFee > 0) {
            uint256 fee0 = amount0 * protocolFee / 10000;
            uint256 fee1 = amount1 * protocolFee / 10000;
            accumulatedFees[poolKey.currency0] += fee0;
            accumulatedFees[poolKey.currency1] += fee1;
            amount0 -= fee0;
            amount1 -= fee1;
            result.fee0 = fee0;
            result.fee1 = fee1;
        }

        // Step 4: If exitToken is configured, swap non-exit-token to exit token
        if (!config.exitToken.isAddressZero() && swapData.length > 0) {
            _executeExitSwap(poolKey, config.exitToken, swapData, config.maxSwapSlippage);
            // Recalculate available balances after swap
            amount0 = _getAvailableBalance(poolKey.currency0);
            amount1 = _getAvailableBalance(poolKey.currency1);
        }

        // Step 5: Transfer all proceeds to owner
        if (amount0 > 0) _transferCurrency(poolKey.currency0, posOwner, amount0);
        if (amount1 > 0) _transferCurrency(poolKey.currency1, posOwner, amount1);

        // Handle cross-pair exit token (exitToken is neither pool token)
        if (!config.exitToken.isAddressZero() &&
            Currency.unwrap(config.exitToken) != Currency.unwrap(poolKey.currency0) &&
            Currency.unwrap(config.exitToken) != Currency.unwrap(poolKey.currency1)) {
            uint256 exitAmount = _getAvailableBalance(config.exitToken);
            if (exitAmount > 0) _transferCurrency(config.exitToken, posOwner, exitAmount);
        }

        result.amount0Received = amount0;
        result.amount1Received = amount1;

        // Step 6: Clean up config (exit is one-time)
        delete _exitConfigs[tokenId];
        delete _configTimestamp[tokenId];

        emit ExitExecuted(
            tokenId,
            posOwner,
            reason,
            amount0,
            amount1,
            result.fee0,
            result.fee1,
            liquidity
        );
    }

    /// @notice Collect fees by decreasing liquidity by 0
    function _collectFees(uint256 tokenId) internal returns (uint256 amount0, uint256 amount1) {
        (PoolKey memory poolKey,,,) = getPositionInfo(tokenId);

        bytes memory actions = abi.encodePacked(
            uint8(Actions.DECREASE_LIQUIDITY),
            uint8(Actions.TAKE_PAIR)
        );
        bytes[] memory params = new bytes[](2);
        params[0] = abi.encode(tokenId, 0, 0, 0, "");
        params[1] = abi.encode(poolKey.currency0, poolKey.currency1, address(this));

        uint256 balance0Before = _getBalance(poolKey.currency0);
        uint256 balance1Before = _getBalance(poolKey.currency1);

        positionManager.modifyLiquidities(abi.encode(actions, params), block.timestamp);

        amount0 = _getBalance(poolKey.currency0) - balance0Before;
        amount1 = _getBalance(poolKey.currency1) - balance1Before;
    }

    /// @notice Remove all liquidity from a position
    function _decreaseLiquidity(
        uint256 tokenId,
        uint128 liquidity,
        uint256 amount0Min,
        uint256 amount1Min
    ) internal returns (uint256 amount0, uint256 amount1) {
        (PoolKey memory poolKey,,,) = getPositionInfo(tokenId);

        bytes memory actions = abi.encodePacked(
            uint8(Actions.DECREASE_LIQUIDITY),
            uint8(Actions.TAKE_PAIR)
        );
        bytes[] memory params = new bytes[](2);
        params[0] = abi.encode(tokenId, liquidity, amount0Min, amount1Min, "");
        params[1] = abi.encode(poolKey.currency0, poolKey.currency1, address(this));

        uint256 balance0Before = _getBalance(poolKey.currency0);
        uint256 balance1Before = _getBalance(poolKey.currency1);

        positionManager.modifyLiquidities(abi.encode(actions, params), block.timestamp);

        amount0 = _getBalance(poolKey.currency0) - balance0Before;
        amount1 = _getBalance(poolKey.currency1) - balance1Before;
    }

    /// @notice Execute swap to convert to exit token
    function _executeExitSwap(
        PoolKey memory poolKey,
        Currency exitToken,
        bytes calldata swapData,
        uint256 maxSlippage
    ) internal {
        (address router, bytes memory routerData) = abi.decode(swapData, (address, bytes));
        if (!approvedRouters[router]) revert RouterNotApproved();

        (uint160 sqrtPriceX96,,,) = poolManager.getSlot0(poolKey.toId());

        if (Currency.unwrap(exitToken) == Currency.unwrap(poolKey.currency0)) {
            // Swap all token1 → token0
            uint256 amount1 = _getAvailableBalance(poolKey.currency1);
            if (amount1 > 0) {
                uint256 minOut = SwapLib.calculateMinOutput(amount1, sqrtPriceX96, maxSlippage, false);
                SwapLib.executeSwap(SwapLib.SwapParams({
                    fromCurrency: poolKey.currency1,
                    toCurrency: poolKey.currency0,
                    amountIn: amount1,
                    minAmountOut: minOut,
                    router: router,
                    swapData: routerData,
                    weth9: WETH9
                }));
            }
        } else if (Currency.unwrap(exitToken) == Currency.unwrap(poolKey.currency1)) {
            // Swap all token0 → token1
            uint256 amount0 = _getAvailableBalance(poolKey.currency0);
            if (amount0 > 0) {
                uint256 minOut = SwapLib.calculateMinOutput(amount0, sqrtPriceX96, maxSlippage, true);
                SwapLib.executeSwap(SwapLib.SwapParams({
                    fromCurrency: poolKey.currency0,
                    toCurrency: poolKey.currency1,
                    amountIn: amount0,
                    minAmountOut: minOut,
                    router: router,
                    swapData: routerData,
                    weth9: WETH9
                }));
            }
        } else {
            // Cross-pair exit: swap both pool tokens to exitToken via router
            uint256 amount0 = _getAvailableBalance(poolKey.currency0);
            if (amount0 > 0) {
                SwapLib.executeSwap(SwapLib.SwapParams({
                    fromCurrency: poolKey.currency0,
                    toCurrency: exitToken,
                    amountIn: amount0,
                    minAmountOut: 0,
                    router: router,
                    swapData: routerData,
                    weth9: WETH9
                }));
            }
            uint256 amount1 = _getAvailableBalance(poolKey.currency1);
            if (amount1 > 0) {
                SwapLib.executeSwap(SwapLib.SwapParams({
                    fromCurrency: poolKey.currency1,
                    toCurrency: exitToken,
                    amountIn: amount1,
                    minAmountOut: 0,
                    router: router,
                    swapData: routerData,
                    weth9: WETH9
                }));
            }
        }
    }

    /// @notice Get total balance of a currency held by this contract
    function _getBalance(Currency currency) internal view returns (uint256) {
        if (currency.isAddressZero()) {
            return address(this).balance;
        }
        return IERC20(Currency.unwrap(currency)).balanceOf(address(this));
    }

    /// @notice Get available balance excluding accumulated protocol fees
    function _getAvailableBalance(Currency currency) internal view returns (uint256) {
        uint256 total = _getBalance(currency);
        uint256 reserved = accumulatedFees[currency];
        return total > reserved ? total - reserved : 0;
    }
}
