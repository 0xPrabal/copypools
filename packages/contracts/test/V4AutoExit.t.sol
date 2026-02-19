// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import { Test, console2 } from "forge-std/Test.sol";
import { BaseTest, MockERC20 } from "./BaseTest.sol";
import { Currency, CurrencyLibrary } from "@uniswap/v4-core/src/types/Currency.sol";
import { PoolKey } from "@uniswap/v4-core/src/types/PoolKey.sol";
import { TickMath } from "@uniswap/v4-core/src/libraries/TickMath.sol";
import { PoolId, PoolIdLibrary } from "@uniswap/v4-core/src/types/PoolId.sol";

import { V4AutoExit } from "../src/automators/V4AutoExit.sol";
import { IV4AutoExit } from "../src/interfaces/IV4AutoExit.sol";
import { ERC1967Proxy } from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";

/// @title V4AutoExitTest
/// @notice Comprehensive tests for V4AutoExit contract
contract V4AutoExitTest is BaseTest {
    using CurrencyLibrary for Currency;
    using PoolIdLibrary for PoolKey;

    V4AutoExit public autoExit;
    V4AutoExit public autoExitImpl;

    address public bot;

    function setUp() public override {
        super.setUp();

        bot = makeAddr("bot");
        vm.deal(bot, 10 ether);

        // Deploy V4AutoExit implementation
        autoExitImpl = new V4AutoExit(
            address(poolManager),
            address(positionManager),
            address(weth)
        );

        // Deploy proxy
        bytes memory initData = abi.encodeWithSelector(V4AutoExit.initialize.selector, owner);
        address proxy = deployProxy(address(autoExitImpl), initData);
        autoExit = V4AutoExit(payable(proxy));

        // Setup router approval
        vm.prank(owner);
        autoExit.setRouterApproval(address(router), true);

        // Approve tokens
        approveTokens(user1, address(autoExit), type(uint256).max);
        approveTokens(user2, address(autoExit), type(uint256).max);

        labelAddresses();
        vm.label(address(autoExit), "V4AutoExit");
        vm.label(bot, "Bot");
    }

    // ============ Initialization Tests ============

    function test_Initialize_SetsOwner() public view {
        assertEq(autoExit.owner(), owner);
    }

    function test_Initialize_SetsPoolManager() public view {
        assertEq(address(autoExit.poolManager()), address(poolManager));
    }

    function test_Initialize_SetsPositionManager() public view {
        assertEq(address(autoExit.positionManager()), address(positionManager));
    }

    function test_Initialize_CannotReinitialize() public {
        vm.expectRevert();
        autoExit.initialize(user1);
    }

    function test_DefaultProtocolFee() public view {
        assertEq(autoExit.protocolFee(), 65); // 0.65%
    }

    function test_Version() public view {
        assertEq(autoExit.VERSION(), "1.0.0");
    }

    // ============ ConfigureExit Tests ============

    function test_ConfigureExit_AsOwner() public {
        uint256 tokenId = _createPosition(user1);

        IV4AutoExit.ExitConfig memory config = _defaultStopLossConfig();

        vm.prank(user1);
        autoExit.configureExit(tokenId, config);

        IV4AutoExit.ExitConfig memory stored = autoExit.getExitConfig(tokenId);
        assertTrue(stored.enabled);
        assertEq(stored.triggerTickLower, -200);
        assertEq(stored.triggerTickUpper, TickMath.MAX_TICK);
        assertFalse(stored.exitOnRangeExit);
        assertEq(stored.maxSwapSlippage, 500);
        assertEq(stored.minExitInterval, 300);
    }

    function test_ConfigureExit_EmitsEvent() public {
        uint256 tokenId = _createPosition(user1);
        IV4AutoExit.ExitConfig memory config = _defaultStopLossConfig();

        vm.expectEmit(true, true, false, true);
        emit IV4AutoExit.ExitConfigured(tokenId, user1, -200, TickMath.MAX_TICK, false);

        vm.prank(user1);
        autoExit.configureExit(tokenId, config);
    }

    function test_ConfigureExit_WithStopLossOnly() public {
        uint256 tokenId = _createPosition(user1);

        IV4AutoExit.ExitConfig memory config = IV4AutoExit.ExitConfig({
            enabled: true,
            triggerTickLower: -200,
            triggerTickUpper: TickMath.MAX_TICK, // disabled
            exitOnRangeExit: false,
            exitToken: Currency.wrap(address(0)),
            maxSwapSlippage: 500,
            minExitInterval: 300
        });

        vm.prank(user1);
        autoExit.configureExit(tokenId, config);

        IV4AutoExit.ExitConfig memory stored = autoExit.getExitConfig(tokenId);
        assertTrue(stored.enabled);
        assertEq(stored.triggerTickLower, -200);
    }

    function test_ConfigureExit_WithTakeProfitOnly() public {
        uint256 tokenId = _createPosition(user1);

        IV4AutoExit.ExitConfig memory config = IV4AutoExit.ExitConfig({
            enabled: true,
            triggerTickLower: TickMath.MIN_TICK, // disabled
            triggerTickUpper: 200,
            exitOnRangeExit: false,
            exitToken: Currency.wrap(address(0)),
            maxSwapSlippage: 500,
            minExitInterval: 300
        });

        vm.prank(user1);
        autoExit.configureExit(tokenId, config);

        IV4AutoExit.ExitConfig memory stored = autoExit.getExitConfig(tokenId);
        assertTrue(stored.enabled);
        assertEq(stored.triggerTickUpper, 200);
    }

    function test_ConfigureExit_WithRangeExitOnly() public {
        uint256 tokenId = _createPosition(user1);

        IV4AutoExit.ExitConfig memory config = IV4AutoExit.ExitConfig({
            enabled: true,
            triggerTickLower: TickMath.MIN_TICK,
            triggerTickUpper: TickMath.MAX_TICK,
            exitOnRangeExit: true,
            exitToken: Currency.wrap(address(0)),
            maxSwapSlippage: 500,
            minExitInterval: 300
        });

        vm.prank(user1);
        autoExit.configureExit(tokenId, config);

        IV4AutoExit.ExitConfig memory stored = autoExit.getExitConfig(tokenId);
        assertTrue(stored.exitOnRangeExit);
    }

    function test_ConfigureExit_WithAllTriggers() public {
        uint256 tokenId = _createPosition(user1);

        IV4AutoExit.ExitConfig memory config = IV4AutoExit.ExitConfig({
            enabled: true,
            triggerTickLower: -300,
            triggerTickUpper: 300,
            exitOnRangeExit: true,
            exitToken: Currency.wrap(address(0)),
            maxSwapSlippage: 500,
            minExitInterval: 300
        });

        vm.prank(user1);
        autoExit.configureExit(tokenId, config);

        IV4AutoExit.ExitConfig memory stored = autoExit.getExitConfig(tokenId);
        assertTrue(stored.enabled);
        assertEq(stored.triggerTickLower, -300);
        assertEq(stored.triggerTickUpper, 300);
        assertTrue(stored.exitOnRangeExit);
    }

    function test_ConfigureExit_WithExitToken() public {
        uint256 tokenId = _createPosition(user1);

        IV4AutoExit.ExitConfig memory config = IV4AutoExit.ExitConfig({
            enabled: true,
            triggerTickLower: -200,
            triggerTickUpper: TickMath.MAX_TICK,
            exitOnRangeExit: false,
            exitToken: poolKey.currency0,
            maxSwapSlippage: 500,
            minExitInterval: 300
        });

        vm.prank(user1);
        autoExit.configureExit(tokenId, config);

        IV4AutoExit.ExitConfig memory stored = autoExit.getExitConfig(tokenId);
        assertEq(Currency.unwrap(stored.exitToken), Currency.unwrap(poolKey.currency0));
    }

    function test_ConfigureExit_WithOperator() public {
        uint256 tokenId = _createPosition(user1);

        vm.prank(user1);
        autoExit.setOperatorApproval(operator, true);

        IV4AutoExit.ExitConfig memory config = _defaultStopLossConfig();

        vm.prank(operator);
        autoExit.configureExit(tokenId, config);

        assertTrue(autoExit.getExitConfig(tokenId).enabled);
    }

    function test_ConfigureExit_SetsConfigTimestamp() public {
        uint256 tokenId = _createPosition(user1);
        IV4AutoExit.ExitConfig memory config = _defaultStopLossConfig();

        vm.warp(1000);
        vm.prank(user1);
        autoExit.configureExit(tokenId, config);

        assertEq(autoExit.getConfigTimestamp(tokenId), 1000);
    }

    function test_ConfigureExit_RevertIfNotOwner() public {
        uint256 tokenId = _createPosition(user1);
        IV4AutoExit.ExitConfig memory config = _defaultStopLossConfig();

        vm.prank(user2);
        vm.expectRevert();
        autoExit.configureExit(tokenId, config);
    }

    function test_ConfigureExit_RevertIfNoTriggers() public {
        uint256 tokenId = _createPosition(user1);

        IV4AutoExit.ExitConfig memory config = IV4AutoExit.ExitConfig({
            enabled: true,
            triggerTickLower: TickMath.MIN_TICK,
            triggerTickUpper: TickMath.MAX_TICK,
            exitOnRangeExit: false,
            exitToken: Currency.wrap(address(0)),
            maxSwapSlippage: 500,
            minExitInterval: 300
        });

        vm.prank(user1);
        vm.expectRevert("No triggers set");
        autoExit.configureExit(tokenId, config);
    }

    function test_ConfigureExit_RevertIfIntervalTooShort() public {
        uint256 tokenId = _createPosition(user1);

        IV4AutoExit.ExitConfig memory config = IV4AutoExit.ExitConfig({
            enabled: true,
            triggerTickLower: -200,
            triggerTickUpper: TickMath.MAX_TICK,
            exitOnRangeExit: false,
            exitToken: Currency.wrap(address(0)),
            maxSwapSlippage: 500,
            minExitInterval: 100 // Below MIN_EXIT_INTERVAL of 300
        });

        vm.prank(user1);
        vm.expectRevert("Interval too short");
        autoExit.configureExit(tokenId, config);
    }

    function test_ConfigureExit_RevertIfInvalidTriggerTicks() public {
        uint256 tokenId = _createPosition(user1);

        IV4AutoExit.ExitConfig memory config = IV4AutoExit.ExitConfig({
            enabled: true,
            triggerTickLower: 200,   // lower > upper = invalid
            triggerTickUpper: -200,
            exitOnRangeExit: false,
            exitToken: Currency.wrap(address(0)),
            maxSwapSlippage: 500,
            minExitInterval: 300
        });

        vm.prank(user1);
        vm.expectRevert(IV4AutoExit.InvalidTriggerTicks.selector);
        autoExit.configureExit(tokenId, config);
    }

    function test_ConfigureExit_RevertIfNoLiquidity() public {
        // Create position with zero liquidity
        uint256 tokenId = positionManager.mintPosition(user1, poolKey, TICK_LOWER, TICK_UPPER, 0);

        IV4AutoExit.ExitConfig memory config = _defaultStopLossConfig();

        vm.prank(user1);
        vm.expectRevert(IV4AutoExit.NoLiquidity.selector);
        autoExit.configureExit(tokenId, config);
    }

    // ============ RemoveExit Tests ============

    function test_RemoveExit_AsOwner() public {
        uint256 tokenId = _configureExitPosition(user1);

        vm.prank(user1);
        autoExit.removeExit(tokenId);

        IV4AutoExit.ExitConfig memory stored = autoExit.getExitConfig(tokenId);
        assertFalse(stored.enabled);
        assertEq(autoExit.getConfigTimestamp(tokenId), 0);
    }

    function test_RemoveExit_EmitsEvent() public {
        uint256 tokenId = _configureExitPosition(user1);

        vm.expectEmit(true, false, false, false);
        emit IV4AutoExit.ExitRemoved(tokenId);

        vm.prank(user1);
        autoExit.removeExit(tokenId);
    }

    function test_RemoveExit_RevertIfNotOwner() public {
        uint256 tokenId = _configureExitPosition(user1);

        vm.prank(user2);
        vm.expectRevert();
        autoExit.removeExit(tokenId);
    }

    // ============ UpdateExitConfig Tests ============

    function test_UpdateExitConfig_UpdatesStorage() public {
        uint256 tokenId = _configureExitPosition(user1);

        IV4AutoExit.ExitConfig memory newConfig = IV4AutoExit.ExitConfig({
            enabled: true,
            triggerTickLower: -400,
            triggerTickUpper: 400,
            exitOnRangeExit: true,
            exitToken: Currency.wrap(address(0)),
            maxSwapSlippage: 300,
            minExitInterval: 600
        });

        vm.prank(user1);
        autoExit.updateExitConfig(tokenId, newConfig);

        IV4AutoExit.ExitConfig memory stored = autoExit.getExitConfig(tokenId);
        assertEq(stored.triggerTickLower, -400);
        assertEq(stored.triggerTickUpper, 400);
        assertTrue(stored.exitOnRangeExit);
        assertEq(stored.maxSwapSlippage, 300);
    }

    function test_UpdateExitConfig_ResetsConfigTimestamp() public {
        vm.warp(1000);
        uint256 tokenId = _configureExitPosition(user1);
        assertEq(autoExit.getConfigTimestamp(tokenId), 1000);

        vm.warp(2000);
        IV4AutoExit.ExitConfig memory newConfig = _defaultStopLossConfig();
        vm.prank(user1);
        autoExit.updateExitConfig(tokenId, newConfig);

        assertEq(autoExit.getConfigTimestamp(tokenId), 2000);
    }

    function test_UpdateExitConfig_RevertIfNotOwner() public {
        uint256 tokenId = _configureExitPosition(user1);
        IV4AutoExit.ExitConfig memory newConfig = _defaultStopLossConfig();

        vm.prank(user2);
        vm.expectRevert();
        autoExit.updateExitConfig(tokenId, newConfig);
    }

    // ============ CheckExit Tests ============

    function test_CheckExit_NotConfigured() public {
        uint256 tokenId = _createPosition(user1);

        (bool needsExit, uint8 reason) = autoExit.checkExit(tokenId);
        assertFalse(needsExit);
        assertEq(reason, 0);
    }

    function test_CheckExit_StopLoss_Triggered() public {
        uint256 tokenId = _configureExitPosition(user1);

        // Move price below triggerTickLower (-200)
        uint160 sqrtPrice = TickMath.getSqrtPriceAtTick(-300);
        poolManager.setSlot0(poolKey.toId(), sqrtPrice, -300);

        (bool needsExit, uint8 reason) = autoExit.checkExit(tokenId);
        assertTrue(needsExit);
        assertEq(reason, 1); // stopLoss
    }

    function test_CheckExit_StopLoss_NotTriggered() public {
        uint256 tokenId = _configureExitPosition(user1);

        // Price stays at 0, triggerTickLower is -200 → no trigger
        (bool needsExit,) = autoExit.checkExit(tokenId);
        assertFalse(needsExit);
    }

    function test_CheckExit_TakeProfit_Triggered() public {
        uint256 tokenId = _createPosition(user1);

        IV4AutoExit.ExitConfig memory config = IV4AutoExit.ExitConfig({
            enabled: true,
            triggerTickLower: TickMath.MIN_TICK,
            triggerTickUpper: 200,
            exitOnRangeExit: false,
            exitToken: Currency.wrap(address(0)),
            maxSwapSlippage: 500,
            minExitInterval: 300
        });
        vm.prank(user1);
        autoExit.configureExit(tokenId, config);

        // Move price above triggerTickUpper (200)
        uint160 sqrtPrice = TickMath.getSqrtPriceAtTick(300);
        poolManager.setSlot0(poolKey.toId(), sqrtPrice, 300);

        (bool needsExit, uint8 reason) = autoExit.checkExit(tokenId);
        assertTrue(needsExit);
        assertEq(reason, 2); // takeProfit
    }

    function test_CheckExit_TakeProfit_NotTriggered() public {
        uint256 tokenId = _createPosition(user1);

        IV4AutoExit.ExitConfig memory config = IV4AutoExit.ExitConfig({
            enabled: true,
            triggerTickLower: TickMath.MIN_TICK,
            triggerTickUpper: 200,
            exitOnRangeExit: false,
            exitToken: Currency.wrap(address(0)),
            maxSwapSlippage: 500,
            minExitInterval: 300
        });
        vm.prank(user1);
        autoExit.configureExit(tokenId, config);

        // Price at 0, take-profit at 200 → no trigger
        (bool needsExit,) = autoExit.checkExit(tokenId);
        assertFalse(needsExit);
    }

    function test_CheckExit_RangeExit_BelowRange() public {
        uint256 tokenId = _createPosition(user1);

        IV4AutoExit.ExitConfig memory config = IV4AutoExit.ExitConfig({
            enabled: true,
            triggerTickLower: TickMath.MIN_TICK,
            triggerTickUpper: TickMath.MAX_TICK,
            exitOnRangeExit: true,
            exitToken: Currency.wrap(address(0)),
            maxSwapSlippage: 500,
            minExitInterval: 300
        });
        vm.prank(user1);
        autoExit.configureExit(tokenId, config);

        // Move price below position range (TICK_LOWER = -120)
        uint160 sqrtPrice = TickMath.getSqrtPriceAtTick(-200);
        poolManager.setSlot0(poolKey.toId(), sqrtPrice, -200);

        (bool needsExit, uint8 reason) = autoExit.checkExit(tokenId);
        assertTrue(needsExit);
        assertEq(reason, 3); // outOfRange
    }

    function test_CheckExit_RangeExit_AboveRange() public {
        uint256 tokenId = _createPosition(user1);

        IV4AutoExit.ExitConfig memory config = IV4AutoExit.ExitConfig({
            enabled: true,
            triggerTickLower: TickMath.MIN_TICK,
            triggerTickUpper: TickMath.MAX_TICK,
            exitOnRangeExit: true,
            exitToken: Currency.wrap(address(0)),
            maxSwapSlippage: 500,
            minExitInterval: 300
        });
        vm.prank(user1);
        autoExit.configureExit(tokenId, config);

        // Move price above position range (TICK_UPPER = 120)
        uint160 sqrtPrice = TickMath.getSqrtPriceAtTick(200);
        poolManager.setSlot0(poolKey.toId(), sqrtPrice, 200);

        (bool needsExit, uint8 reason) = autoExit.checkExit(tokenId);
        assertTrue(needsExit);
        assertEq(reason, 3); // outOfRange
    }

    function test_CheckExit_RangeExit_InRange() public {
        uint256 tokenId = _createPosition(user1);

        IV4AutoExit.ExitConfig memory config = IV4AutoExit.ExitConfig({
            enabled: true,
            triggerTickLower: TickMath.MIN_TICK,
            triggerTickUpper: TickMath.MAX_TICK,
            exitOnRangeExit: true,
            exitToken: Currency.wrap(address(0)),
            maxSwapSlippage: 500,
            minExitInterval: 300
        });
        vm.prank(user1);
        autoExit.configureExit(tokenId, config);

        // Price at 0, position range [-120, 120] → in range
        (bool needsExit,) = autoExit.checkExit(tokenId);
        assertFalse(needsExit);
    }

    function test_CheckExit_PriorityOrder() public {
        // Stop-loss should be checked before take-profit before range exit
        uint256 tokenId = _createPosition(user1);

        IV4AutoExit.ExitConfig memory config = IV4AutoExit.ExitConfig({
            enabled: true,
            triggerTickLower: -200,
            triggerTickUpper: 300,
            exitOnRangeExit: true,
            exitToken: Currency.wrap(address(0)),
            maxSwapSlippage: 500,
            minExitInterval: 300
        });
        vm.prank(user1);
        autoExit.configureExit(tokenId, config);

        // Move price below stop-loss AND out of range → should return reason 1 (stopLoss)
        uint160 sqrtPrice = TickMath.getSqrtPriceAtTick(-300);
        poolManager.setSlot0(poolKey.toId(), sqrtPrice, -300);

        (bool needsExit, uint8 reason) = autoExit.checkExit(tokenId);
        assertTrue(needsExit);
        assertEq(reason, 1); // stopLoss takes priority
    }

    // ============ BatchCheckExit Tests ============

    function test_BatchCheckExit_MultiplePositions() public {
        uint256 token1 = _configureExitPosition(user1);
        uint256 token2 = _configureExitPosition(user1);

        // Move price below triggerTickLower (-200)
        uint160 sqrtPrice = TickMath.getSqrtPriceAtTick(-300);
        poolManager.setSlot0(poolKey.toId(), sqrtPrice, -300);

        uint256[] memory tokenIds = new uint256[](2);
        tokenIds[0] = token1;
        tokenIds[1] = token2;

        bool[] memory results = autoExit.batchCheckExit(tokenIds);
        assertTrue(results[0]);
        assertTrue(results[1]);
    }

    function test_BatchCheckExit_EmptyArray() public view {
        uint256[] memory tokenIds = new uint256[](0);
        bool[] memory results = autoExit.batchCheckExit(tokenIds);
        assertEq(results.length, 0);
    }

    // ============ ExecuteExit Tests ============

    function test_ExecuteExit_StopLoss_NoSwap() public {
        vm.warp(1000);
        uint256 tokenId = _configureExitPosition(user1);

        // Move price below stop-loss
        uint160 sqrtPrice = TickMath.getSqrtPriceAtTick(-300);
        poolManager.setSlot0(poolKey.toId(), sqrtPrice, -300);

        // Wait for exit interval
        vm.warp(1000 + 301);

        uint256 user1Token0Before = token0.balanceOf(user1);
        uint256 user1Token1Before = token1.balanceOf(user1);

        vm.prank(bot);
        IV4AutoExit.ExitResult memory result = autoExit.executeExit(tokenId, "", block.timestamp + 1 hours);

        assertEq(result.exitReason, 1); // stopLoss
        assertGt(result.liquidityRemoved, 0);

        // User should have received tokens
        uint256 user1Token0After = token0.balanceOf(user1);
        uint256 user1Token1After = token1.balanceOf(user1);
        assertTrue(
            user1Token0After > user1Token0Before || user1Token1After > user1Token1Before,
            "User should receive at least one token"
        );
    }

    function test_ExecuteExit_TakeProfit_NoSwap() public {
        vm.warp(1000);
        uint256 tokenId = _createPosition(user1);

        IV4AutoExit.ExitConfig memory config = IV4AutoExit.ExitConfig({
            enabled: true,
            triggerTickLower: TickMath.MIN_TICK,
            triggerTickUpper: 200,
            exitOnRangeExit: false,
            exitToken: Currency.wrap(address(0)),
            maxSwapSlippage: 500,
            minExitInterval: 300
        });
        vm.prank(user1);
        autoExit.configureExit(tokenId, config);

        // Move price above take-profit
        uint160 sqrtPrice = TickMath.getSqrtPriceAtTick(300);
        poolManager.setSlot0(poolKey.toId(), sqrtPrice, 300);

        vm.warp(1000 + 301);

        vm.prank(bot);
        IV4AutoExit.ExitResult memory result = autoExit.executeExit(tokenId, "", block.timestamp + 1 hours);

        assertEq(result.exitReason, 2); // takeProfit
        assertGt(result.liquidityRemoved, 0);
    }

    function test_ExecuteExit_RangeExit_NoSwap() public {
        vm.warp(1000);
        uint256 tokenId = _createPosition(user1);

        IV4AutoExit.ExitConfig memory config = IV4AutoExit.ExitConfig({
            enabled: true,
            triggerTickLower: TickMath.MIN_TICK,
            triggerTickUpper: TickMath.MAX_TICK,
            exitOnRangeExit: true,
            exitToken: Currency.wrap(address(0)),
            maxSwapSlippage: 500,
            minExitInterval: 300
        });
        vm.prank(user1);
        autoExit.configureExit(tokenId, config);

        // Move price out of range
        uint160 sqrtPrice = TickMath.getSqrtPriceAtTick(200);
        poolManager.setSlot0(poolKey.toId(), sqrtPrice, 200);

        vm.warp(1000 + 301);

        vm.prank(bot);
        IV4AutoExit.ExitResult memory result = autoExit.executeExit(tokenId, "", block.timestamp + 1 hours);

        assertEq(result.exitReason, 3); // outOfRange
    }

    function test_ExecuteExit_WithExitToken_SwapToToken0() public {
        vm.warp(1000);
        uint256 tokenId = _createPosition(user1);

        IV4AutoExit.ExitConfig memory config = IV4AutoExit.ExitConfig({
            enabled: true,
            triggerTickLower: -200,
            triggerTickUpper: TickMath.MAX_TICK,
            exitOnRangeExit: false,
            exitToken: poolKey.currency0,
            maxSwapSlippage: 500,
            minExitInterval: 300
        });
        vm.prank(user1);
        autoExit.configureExit(tokenId, config);

        // Move price below stop-loss
        uint160 sqrtPrice = TickMath.getSqrtPriceAtTick(-300);
        poolManager.setSlot0(poolKey.toId(), sqrtPrice, -300);

        vm.warp(1000 + 301);

        bytes memory swapData = getRouterCallData(address(token1), address(token0), 0, 0);

        vm.prank(user1); // Owner provides swap data
        IV4AutoExit.ExitResult memory result = autoExit.executeExit(tokenId, swapData, block.timestamp + 1 hours);

        assertEq(result.exitReason, 1);
        assertGt(result.liquidityRemoved, 0);
    }

    function test_ExecuteExit_WithExitToken_SwapToToken1() public {
        vm.warp(1000);
        uint256 tokenId = _createPosition(user1);

        IV4AutoExit.ExitConfig memory config = IV4AutoExit.ExitConfig({
            enabled: true,
            triggerTickLower: -200,
            triggerTickUpper: TickMath.MAX_TICK,
            exitOnRangeExit: false,
            exitToken: poolKey.currency1,
            maxSwapSlippage: 500,
            minExitInterval: 300
        });
        vm.prank(user1);
        autoExit.configureExit(tokenId, config);

        uint160 sqrtPrice = TickMath.getSqrtPriceAtTick(-300);
        poolManager.setSlot0(poolKey.toId(), sqrtPrice, -300);

        vm.warp(1000 + 301);

        bytes memory swapData = getRouterCallData(address(token0), address(token1), 0, 0);

        vm.prank(user1);
        IV4AutoExit.ExitResult memory result = autoExit.executeExit(tokenId, swapData, block.timestamp + 1 hours);

        assertEq(result.exitReason, 1);
        assertGt(result.liquidityRemoved, 0);
    }

    function test_ExecuteExit_WithFeeCollection() public {
        vm.warp(1000);
        uint256 tokenId = _configureExitPosition(user1);

        // Add fees to position
        positionManager.addFees(tokenId, 10e18, 10e18);

        // Move price below stop-loss
        uint160 sqrtPrice = TickMath.getSqrtPriceAtTick(-300);
        poolManager.setSlot0(poolKey.toId(), sqrtPrice, -300);

        vm.warp(1000 + 301);

        uint256 user1Token0Before = token0.balanceOf(user1);
        uint256 user1Token1Before = token1.balanceOf(user1);

        vm.prank(bot);
        autoExit.executeExit(tokenId, "", block.timestamp + 1 hours);

        // User should receive fees + liquidity tokens (minus protocol fee)
        uint256 user1Token0After = token0.balanceOf(user1);
        uint256 user1Token1After = token1.balanceOf(user1);
        assertTrue(user1Token0After > user1Token0Before || user1Token1After > user1Token1Before);
    }

    function test_ExecuteExit_ProtocolFeeTaken() public {
        vm.warp(1000);
        uint256 tokenId = _configureExitPosition(user1);

        uint160 sqrtPrice = TickMath.getSqrtPriceAtTick(-300);
        poolManager.setSlot0(poolKey.toId(), sqrtPrice, -300);

        vm.warp(1000 + 301);

        vm.prank(bot);
        IV4AutoExit.ExitResult memory result = autoExit.executeExit(tokenId, "", block.timestamp + 1 hours);

        // Protocol fee should be taken (0.65%)
        // At least one of fee0/fee1 should be > 0 since there was liquidity
        assertTrue(result.fee0 > 0 || result.fee1 > 0, "Protocol fee should be taken");

        // Check accumulated fees in contract
        uint256 accFee0 = autoExit.accumulatedFees(poolKey.currency0);
        uint256 accFee1 = autoExit.accumulatedFees(poolKey.currency1);
        assertEq(accFee0, result.fee0);
        assertEq(accFee1, result.fee1);
    }

    function test_ExecuteExit_TransfersToOwner() public {
        vm.warp(1000);
        uint256 tokenId = _configureExitPosition(user1);

        uint160 sqrtPrice = TickMath.getSqrtPriceAtTick(-300);
        poolManager.setSlot0(poolKey.toId(), sqrtPrice, -300);

        vm.warp(1000 + 301);

        uint256 user1Token0Before = token0.balanceOf(user1);
        uint256 user1Token1Before = token1.balanceOf(user1);

        vm.prank(bot);
        IV4AutoExit.ExitResult memory result = autoExit.executeExit(tokenId, "", block.timestamp + 1 hours);

        uint256 user1Token0After = token0.balanceOf(user1);
        uint256 user1Token1After = token1.balanceOf(user1);

        // Check that received amounts match what was transferred
        assertEq(user1Token0After - user1Token0Before, result.amount0Received);
        assertEq(user1Token1After - user1Token1Before, result.amount1Received);
    }

    function test_ExecuteExit_ConfigDeletedAfterExit() public {
        vm.warp(1000);
        uint256 tokenId = _configureExitPosition(user1);

        uint160 sqrtPrice = TickMath.getSqrtPriceAtTick(-300);
        poolManager.setSlot0(poolKey.toId(), sqrtPrice, -300);

        vm.warp(1000 + 301);

        vm.prank(bot);
        autoExit.executeExit(tokenId, "", block.timestamp + 1 hours);

        // Config should be deleted
        IV4AutoExit.ExitConfig memory stored = autoExit.getExitConfig(tokenId);
        assertFalse(stored.enabled);
        assertEq(autoExit.getConfigTimestamp(tokenId), 0);
    }

    function test_ExecuteExit_EmitsEvent() public {
        vm.warp(1000);
        uint256 tokenId = _configureExitPosition(user1);

        uint160 sqrtPrice = TickMath.getSqrtPriceAtTick(-300);
        poolManager.setSlot0(poolKey.toId(), sqrtPrice, -300);

        vm.warp(1000 + 301);

        vm.expectEmit(true, true, false, false);
        emit IV4AutoExit.ExitExecuted(tokenId, user1, 1, 0, 0, 0, 0, 0);

        vm.prank(bot);
        autoExit.executeExit(tokenId, "", block.timestamp + 1 hours);
    }

    function test_ExecuteExit_RevertIfNotConfigured() public {
        uint256 tokenId = _createPosition(user1);

        vm.prank(bot);
        vm.expectRevert(IV4AutoExit.ExitNotConfigured.selector);
        autoExit.executeExit(tokenId, "", block.timestamp + 1 hours);
    }

    function test_ExecuteExit_RevertIfConditionsNotMet() public {
        vm.warp(1000);
        uint256 tokenId = _configureExitPosition(user1);

        // Price is at 0, stop-loss at -200 → conditions NOT met
        vm.warp(1000 + 301);

        vm.prank(bot);
        vm.expectRevert(IV4AutoExit.ExitConditionsNotMet.selector);
        autoExit.executeExit(tokenId, "", block.timestamp + 1 hours);
    }

    function test_ExecuteExit_RevertIfTooSoon() public {
        vm.warp(1000);
        uint256 tokenId = _configureExitPosition(user1);

        // Move price below stop-loss
        uint160 sqrtPrice = TickMath.getSqrtPriceAtTick(-300);
        poolManager.setSlot0(poolKey.toId(), sqrtPrice, -300);

        // Don't warp — still within minExitInterval

        vm.prank(bot);
        vm.expectRevert(IV4AutoExit.ExitTooSoon.selector);
        autoExit.executeExit(tokenId, "", block.timestamp + 1 hours);
    }

    function test_ExecuteExit_RevertIfDeadlinePassed() public {
        vm.warp(1000);
        uint256 tokenId = _configureExitPosition(user1);

        uint160 sqrtPrice = TickMath.getSqrtPriceAtTick(-300);
        poolManager.setSlot0(poolKey.toId(), sqrtPrice, -300);

        vm.warp(1000 + 301);

        vm.prank(bot);
        vm.expectRevert();
        autoExit.executeExit(tokenId, "", block.timestamp - 1); // deadline in the past
    }

    function test_ExecuteExit_RevertIfPaused() public {
        vm.warp(1000);
        uint256 tokenId = _configureExitPosition(user1);

        uint160 sqrtPrice = TickMath.getSqrtPriceAtTick(-300);
        poolManager.setSlot0(poolKey.toId(), sqrtPrice, -300);

        vm.warp(1000 + 301);

        vm.prank(owner);
        autoExit.pause();

        vm.prank(bot);
        vm.expectRevert();
        autoExit.executeExit(tokenId, "", block.timestamp + 1 hours);
    }

    function test_ExecuteExit_SwapDataOnlyByOwner() public {
        vm.warp(1000);
        uint256 tokenId = _configureExitPosition(user1);

        uint160 sqrtPrice = TickMath.getSqrtPriceAtTick(-300);
        poolManager.setSlot0(poolKey.toId(), sqrtPrice, -300);

        vm.warp(1000 + 301);

        bytes memory swapData = getRouterCallData(address(token1), address(token0), 0, 0);

        // Bot (not owner/approved) cannot provide swapData
        vm.prank(bot);
        vm.expectRevert();
        autoExit.executeExit(tokenId, swapData, block.timestamp + 1 hours);
    }

    // ============ SelfExit Tests ============

    function test_SelfExit_NoProtocolFee() public {
        vm.warp(1000);
        uint256 tokenId = _configureExitPosition(user1);

        uint160 sqrtPrice = TickMath.getSqrtPriceAtTick(-300);
        poolManager.setSlot0(poolKey.toId(), sqrtPrice, -300);

        vm.warp(1000 + 301);

        vm.prank(user1);
        IV4AutoExit.ExitResult memory result = autoExit.selfExit(tokenId, "", block.timestamp + 1 hours);

        assertEq(result.fee0, 0, "No protocol fee on self-exit");
        assertEq(result.fee1, 0, "No protocol fee on self-exit");
        assertGt(result.liquidityRemoved, 0);
    }

    function test_SelfExit_OwnerCanCall() public {
        vm.warp(1000);
        uint256 tokenId = _configureExitPosition(user1);

        uint160 sqrtPrice = TickMath.getSqrtPriceAtTick(-300);
        poolManager.setSlot0(poolKey.toId(), sqrtPrice, -300);

        vm.warp(1000 + 301);

        vm.prank(user1);
        IV4AutoExit.ExitResult memory result = autoExit.selfExit(tokenId, "", block.timestamp + 1 hours);

        assertEq(result.exitReason, 1);
        assertGt(result.liquidityRemoved, 0);
    }

    function test_SelfExit_OperatorCanCall() public {
        vm.warp(1000);
        uint256 tokenId = _configureExitPosition(user1);

        vm.prank(user1);
        autoExit.setOperatorApproval(operator, true);

        uint160 sqrtPrice = TickMath.getSqrtPriceAtTick(-300);
        poolManager.setSlot0(poolKey.toId(), sqrtPrice, -300);

        vm.warp(1000 + 301);

        vm.prank(operator);
        IV4AutoExit.ExitResult memory result = autoExit.selfExit(tokenId, "", block.timestamp + 1 hours);

        assertGt(result.liquidityRemoved, 0);
    }

    function test_SelfExit_RevertIfNotOwner() public {
        vm.warp(1000);
        uint256 tokenId = _configureExitPosition(user1);

        uint160 sqrtPrice = TickMath.getSqrtPriceAtTick(-300);
        poolManager.setSlot0(poolKey.toId(), sqrtPrice, -300);

        vm.warp(1000 + 301);

        vm.prank(user2);
        vm.expectRevert();
        autoExit.selfExit(tokenId, "", block.timestamp + 1 hours);
    }

    // ============ Protocol Fee Management Tests ============

    function test_SetProtocolFee_AsOwner() public {
        vm.prank(owner);
        autoExit.setProtocolFee(100); // 1%

        assertEq(autoExit.protocolFee(), 100);
    }

    function test_SetProtocolFee_EmitsEvent() public {
        vm.expectEmit(false, false, false, true);
        emit IV4AutoExit.ProtocolFeeUpdated(65, 100);

        vm.prank(owner);
        autoExit.setProtocolFee(100);
    }

    function test_SetProtocolFee_RevertIfNotOwner() public {
        vm.prank(user1);
        vm.expectRevert();
        autoExit.setProtocolFee(100);
    }

    function test_SetProtocolFee_RevertIfTooHigh() public {
        vm.prank(owner);
        vm.expectRevert("Fee too high");
        autoExit.setProtocolFee(1001); // > 10%
    }

    function test_SetProtocolFee_RevertIfCooldown() public {
        vm.warp(1000);
        vm.prank(owner);
        autoExit.setProtocolFee(100);

        // Try again within 24 hours
        vm.warp(1000 + 1 hours);
        vm.prank(owner);
        vm.expectRevert("Fee change cooldown");
        autoExit.setProtocolFee(200);
    }

    function test_SetProtocolFee_AfterCooldown() public {
        vm.warp(1000);
        vm.prank(owner);
        autoExit.setProtocolFee(100);

        // Wait 24 hours
        vm.warp(1000 + 24 hours + 1);
        vm.prank(owner);
        autoExit.setProtocolFee(200);

        assertEq(autoExit.protocolFee(), 200);
    }

    // ============ WithdrawFees Tests ============

    function test_WithdrawFees_AfterExit() public {
        vm.warp(1000);
        uint256 tokenId = _configureExitPosition(user1);

        uint160 sqrtPrice = TickMath.getSqrtPriceAtTick(-300);
        poolManager.setSlot0(poolKey.toId(), sqrtPrice, -300);

        vm.warp(1000 + 301);

        vm.prank(bot);
        IV4AutoExit.ExitResult memory result = autoExit.executeExit(tokenId, "", block.timestamp + 1 hours);

        // Withdraw accumulated fees
        uint256 fee0 = autoExit.accumulatedFees(poolKey.currency0);
        uint256 fee1 = autoExit.accumulatedFees(poolKey.currency1);

        if (fee0 > 0) {
            uint256 ownerBalBefore = token0.balanceOf(owner);
            vm.prank(owner);
            autoExit.withdrawFees(poolKey.currency0, owner);
            assertEq(token0.balanceOf(owner) - ownerBalBefore, fee0);
            assertEq(autoExit.accumulatedFees(poolKey.currency0), 0);
        }

        if (fee1 > 0) {
            uint256 ownerBalBefore = token1.balanceOf(owner);
            vm.prank(owner);
            autoExit.withdrawFees(poolKey.currency1, owner);
            assertEq(token1.balanceOf(owner) - ownerBalBefore, fee1);
            assertEq(autoExit.accumulatedFees(poolKey.currency1), 0);
        }
    }

    function test_WithdrawFees_RevertIfNoFees() public {
        vm.prank(owner);
        vm.expectRevert("No fees");
        autoExit.withdrawFees(poolKey.currency0, owner);
    }

    function test_WithdrawFees_EmitsEvent() public {
        vm.warp(1000);
        uint256 tokenId = _configureExitPosition(user1);

        uint160 sqrtPrice = TickMath.getSqrtPriceAtTick(-300);
        poolManager.setSlot0(poolKey.toId(), sqrtPrice, -300);

        vm.warp(1000 + 301);

        vm.prank(bot);
        autoExit.executeExit(tokenId, "", block.timestamp + 1 hours);

        uint256 fee0 = autoExit.accumulatedFees(poolKey.currency0);
        if (fee0 > 0) {
            vm.expectEmit(true, false, false, true);
            emit IV4AutoExit.FeesWithdrawn(owner, poolKey.currency0, fee0);

            vm.prank(owner);
            autoExit.withdrawFees(poolKey.currency0, owner);
        }
    }

    function test_BatchWithdrawFees() public {
        vm.warp(1000);
        uint256 tokenId = _configureExitPosition(user1);

        uint160 sqrtPrice = TickMath.getSqrtPriceAtTick(-300);
        poolManager.setSlot0(poolKey.toId(), sqrtPrice, -300);

        vm.warp(1000 + 301);

        vm.prank(bot);
        autoExit.executeExit(tokenId, "", block.timestamp + 1 hours);

        Currency[] memory currencies = new Currency[](2);
        currencies[0] = poolKey.currency0;
        currencies[1] = poolKey.currency1;

        vm.prank(owner);
        autoExit.batchWithdrawFees(currencies, owner);

        assertEq(autoExit.accumulatedFees(poolKey.currency0), 0);
        assertEq(autoExit.accumulatedFees(poolKey.currency1), 0);
    }

    function test_BatchWithdrawFees_RevertIfNotOwner() public {
        Currency[] memory currencies = new Currency[](1);
        currencies[0] = poolKey.currency0;

        vm.prank(user1);
        vm.expectRevert();
        autoExit.batchWithdrawFees(currencies, user1);
    }

    // ============ Pause Tests ============

    function test_Pause_AsOwner() public {
        vm.prank(owner);
        autoExit.pause();

        assertTrue(autoExit.paused());
    }

    function test_Pause_RevertIfNotOwner() public {
        vm.prank(user1);
        vm.expectRevert();
        autoExit.pause();
    }

    function test_Unpause_AsOwner() public {
        vm.prank(owner);
        autoExit.pause();

        vm.prank(owner);
        autoExit.unpause();

        assertFalse(autoExit.paused());
    }

    // ============ Upgrade Tests ============

    function test_Upgrade_AsOwner() public {
        V4AutoExit newImpl = new V4AutoExit(
            address(poolManager),
            address(positionManager),
            address(weth)
        );

        vm.prank(owner);
        autoExit.upgradeToAndCall(address(newImpl), "");

        // Should still work after upgrade
        assertEq(autoExit.VERSION(), "1.0.0");
    }

    function test_Upgrade_RevertIfNotOwner() public {
        V4AutoExit newImpl = new V4AutoExit(
            address(poolManager),
            address(positionManager),
            address(weth)
        );

        vm.prank(user1);
        vm.expectRevert();
        autoExit.upgradeToAndCall(address(newImpl), "");
    }

    // ============ CollectFeesExternal Tests ============

    function test_CollectFeesExternal_RevertIfNotSelf() public {
        uint256 tokenId = _createPosition(user1);

        vm.prank(user1);
        vm.expectRevert("Only self");
        autoExit.collectFeesExternal(tokenId);
    }

    // ============ Fuzz Tests ============

    function testFuzz_ConfigureExit_TriggerTicks(int24 tickLower, int24 tickUpper) public {
        tickLower = int24(bound(tickLower, TickMath.MIN_TICK + 1, -1));
        tickUpper = int24(bound(tickUpper, 1, TickMath.MAX_TICK - 1));

        // Ensure upper > lower
        if (tickUpper <= tickLower) return;

        uint256 tokenId = _createPosition(user1);

        IV4AutoExit.ExitConfig memory config = IV4AutoExit.ExitConfig({
            enabled: true,
            triggerTickLower: tickLower,
            triggerTickUpper: tickUpper,
            exitOnRangeExit: false,
            exitToken: Currency.wrap(address(0)),
            maxSwapSlippage: 500,
            minExitInterval: 300
        });

        vm.prank(user1);
        autoExit.configureExit(tokenId, config);

        IV4AutoExit.ExitConfig memory stored = autoExit.getExitConfig(tokenId);
        assertTrue(stored.enabled);
        assertEq(stored.triggerTickLower, tickLower);
        assertEq(stored.triggerTickUpper, tickUpper);
    }

    function testFuzz_SetProtocolFee_Value(uint256 fee) public {
        if (fee <= 1000) {
            vm.prank(owner);
            autoExit.setProtocolFee(fee);
            assertEq(autoExit.protocolFee(), fee);
        } else {
            vm.prank(owner);
            vm.expectRevert("Fee too high");
            autoExit.setProtocolFee(fee);
        }
    }

    function testFuzz_CheckExit_TickMovement(int24 currentTick) public {
        currentTick = int24(bound(currentTick, TickMath.MIN_TICK + 1, TickMath.MAX_TICK - 1));

        uint256 tokenId = _createPosition(user1);

        IV4AutoExit.ExitConfig memory config = IV4AutoExit.ExitConfig({
            enabled: true,
            triggerTickLower: -200,
            triggerTickUpper: 200,
            exitOnRangeExit: false,
            exitToken: Currency.wrap(address(0)),
            maxSwapSlippage: 500,
            minExitInterval: 300
        });
        vm.prank(user1);
        autoExit.configureExit(tokenId, config);

        // Move price to fuzzed tick
        uint160 sqrtPrice = TickMath.getSqrtPriceAtTick(currentTick);
        poolManager.setSlot0(poolKey.toId(), sqrtPrice, currentTick);

        (bool needsExit, uint8 reason) = autoExit.checkExit(tokenId);

        if (currentTick <= -200) {
            assertTrue(needsExit);
            assertEq(reason, 1); // stopLoss
        } else if (currentTick >= 200) {
            assertTrue(needsExit);
            assertEq(reason, 2); // takeProfit
        } else {
            assertFalse(needsExit);
            assertEq(reason, 0);
        }
    }

    // ============ Helper Functions ============

    function _createPosition(address posOwner) internal returns (uint256 tokenId) {
        tokenId = positionManager.mintPosition(
            posOwner,
            poolKey,
            TICK_LOWER,
            TICK_UPPER,
            100e18
        );
    }

    function _defaultStopLossConfig() internal pure returns (IV4AutoExit.ExitConfig memory) {
        return IV4AutoExit.ExitConfig({
            enabled: true,
            triggerTickLower: -200,
            triggerTickUpper: TickMath.MAX_TICK,
            exitOnRangeExit: false,
            exitToken: Currency.wrap(address(0)),
            maxSwapSlippage: 500,
            minExitInterval: 300
        });
    }

    function _configureExitPosition(address posOwner) internal returns (uint256 tokenId) {
        tokenId = _createPosition(posOwner);

        IV4AutoExit.ExitConfig memory config = _defaultStopLossConfig();

        vm.prank(posOwner);
        autoExit.configureExit(tokenId, config);
    }
}
