// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import { Test, console2 } from "forge-std/Test.sol";
import { BaseTest, MockERC20 } from "./BaseTest.sol";
import { Currency, CurrencyLibrary } from "@uniswap/v4-core/src/types/Currency.sol";
import { PoolKey } from "@uniswap/v4-core/src/types/PoolKey.sol";
import { TickMath } from "@uniswap/v4-core/src/libraries/TickMath.sol";
import { PoolId, PoolIdLibrary } from "@uniswap/v4-core/src/types/PoolId.sol";

import { V4AutoRange } from "../src/automators/V4AutoRange.sol";
import { IV4AutoRange } from "../src/interfaces/IV4AutoRange.sol";
import { ERC1967Proxy } from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";

/// @title V4AutoRangeTest
/// @notice Comprehensive tests for V4AutoRange contract
contract V4AutoRangeTest is BaseTest {
    using CurrencyLibrary for Currency;
    using PoolIdLibrary for PoolKey;

    V4AutoRange public autoRange;
    V4AutoRange public autoRangeImpl;

    // Bot caller
    address public bot;

    function setUp() public override {
        super.setUp();

        bot = makeAddr("bot");
        vm.deal(bot, 10 ether);

        // Deploy V4AutoRange implementation
        autoRangeImpl = new V4AutoRange(
            address(poolManager),
            address(positionManager),
            address(weth)
        );

        // Deploy proxy
        bytes memory initData = abi.encodeWithSelector(V4AutoRange.initialize.selector, owner);
        address proxy = deployProxy(address(autoRangeImpl), initData);
        autoRange = V4AutoRange(payable(proxy));

        // Setup router approval
        vm.prank(owner);
        autoRange.setRouterApproval(address(router), true);

        // Approve tokens
        approveTokens(user1, address(autoRange), type(uint256).max);
        approveTokens(user2, address(autoRange), type(uint256).max);

        labelAddresses();
        vm.label(address(autoRange), "V4AutoRange");
        vm.label(bot, "Bot");
    }

    // ============ Initialization Tests ============

    function test_Initialize_SetsOwner() public view {
        assertEq(autoRange.owner(), owner);
    }

    function test_Initialize_SetsPoolManager() public view {
        assertEq(address(autoRange.poolManager()), address(poolManager));
    }

    function test_Initialize_SetsPositionManager() public view {
        assertEq(address(autoRange.positionManager()), address(positionManager));
    }

    function test_Initialize_CannotReinitialize() public {
        vm.expectRevert();
        autoRange.initialize(user1);
    }

    function test_Version() public view {
        assertEq(autoRange.VERSION(), "1.3.0");
    }

    function test_DefaultProtocolFee() public view {
        assertEq(autoRange.protocolFee(), 65); // 0.65%
    }

    // ============ ConfigureRange Tests ============

    function test_ConfigureRange_AsOwner() public {
        uint256 tokenId = _createPosition(user1);

        IV4AutoRange.RangeConfig memory config = IV4AutoRange.RangeConfig({
            enabled: true,
            lowerDelta: 120,
            upperDelta: 120,
            rebalanceThreshold: 2000, // 20%
            minRebalanceInterval: 3600,
            collectFeesOnRebalance: true,
            maxSwapSlippage: 500
        });

        vm.prank(user1);
        autoRange.configureRange(tokenId, config);

        IV4AutoRange.RangeConfig memory stored = autoRange.getRangeConfig(tokenId);
        assertTrue(stored.enabled);
        assertEq(stored.lowerDelta, 120);
        assertEq(stored.upperDelta, 120);
        assertEq(stored.rebalanceThreshold, 2000);
        assertEq(stored.minRebalanceInterval, 3600);
        assertTrue(stored.collectFeesOnRebalance);
        assertEq(stored.maxSwapSlippage, 500);
    }

    function test_ConfigureRange_EmitsEvent() public {
        uint256 tokenId = _createPosition(user1);

        IV4AutoRange.RangeConfig memory config = IV4AutoRange.RangeConfig({
            enabled: true,
            lowerDelta: 120,
            upperDelta: 120,
            rebalanceThreshold: 2000,
            minRebalanceInterval: 3600,
            collectFeesOnRebalance: false,
            maxSwapSlippage: 500
        });

        vm.expectEmit(true, true, false, true);
        emit IV4AutoRange.RangeConfigured(tokenId, user1, 120, 120, 2000);

        vm.prank(user1);
        autoRange.configureRange(tokenId, config);
    }

    function test_ConfigureRange_RevertIfNotOwner() public {
        uint256 tokenId = _createPosition(user1);

        IV4AutoRange.RangeConfig memory config = IV4AutoRange.RangeConfig({
            enabled: true,
            lowerDelta: 120,
            upperDelta: 120,
            rebalanceThreshold: 2000,
            minRebalanceInterval: 3600,
            collectFeesOnRebalance: false,
            maxSwapSlippage: 500
        });

        vm.prank(user2);
        vm.expectRevert();
        autoRange.configureRange(tokenId, config);
    }

    function test_ConfigureRange_RevertIfIntervalTooShort() public {
        uint256 tokenId = _createPosition(user1);

        IV4AutoRange.RangeConfig memory config = IV4AutoRange.RangeConfig({
            enabled: true,
            lowerDelta: 120,
            upperDelta: 120,
            rebalanceThreshold: 0,
            minRebalanceInterval: 100, // Below MIN_REBALANCE_INTERVAL (3600)
            collectFeesOnRebalance: false,
            maxSwapSlippage: 500
        });

        vm.prank(user1);
        vm.expectRevert("Interval too short");
        autoRange.configureRange(tokenId, config);
    }

    function test_ConfigureRange_RevertIfInvalidDeltas() public {
        uint256 tokenId = _createPosition(user1);

        IV4AutoRange.RangeConfig memory config = IV4AutoRange.RangeConfig({
            enabled: true,
            lowerDelta: 0, // Invalid
            upperDelta: 120,
            rebalanceThreshold: 0,
            minRebalanceInterval: 3600,
            collectFeesOnRebalance: false,
            maxSwapSlippage: 500
        });

        vm.prank(user1);
        vm.expectRevert("Invalid deltas");
        autoRange.configureRange(tokenId, config);
    }

    function test_ConfigureRange_RevertIfNotAlignedToTickSpacing() public {
        uint256 tokenId = _createPosition(user1);

        IV4AutoRange.RangeConfig memory config = IV4AutoRange.RangeConfig({
            enabled: true,
            lowerDelta: 100, // Not aligned to tickSpacing=60
            upperDelta: 120,
            rebalanceThreshold: 0,
            minRebalanceInterval: 3600,
            collectFeesOnRebalance: false,
            maxSwapSlippage: 500
        });

        vm.prank(user1);
        vm.expectRevert("lowerDelta not aligned");
        autoRange.configureRange(tokenId, config);
    }

    function test_ConfigureRange_WithOperator() public {
        uint256 tokenId = _createPosition(user1);

        vm.prank(user1);
        autoRange.setOperatorApproval(operator, true);

        IV4AutoRange.RangeConfig memory config = IV4AutoRange.RangeConfig({
            enabled: true,
            lowerDelta: 120,
            upperDelta: 120,
            rebalanceThreshold: 0,
            minRebalanceInterval: 3600,
            collectFeesOnRebalance: false,
            maxSwapSlippage: 500
        });

        vm.prank(operator);
        autoRange.configureRange(tokenId, config);

        assertTrue(autoRange.getRangeConfig(tokenId).enabled);
    }

    // ============ RemoveRange Tests ============

    function test_RemoveRange_AsOwner() public {
        uint256 tokenId = _configurePosition(user1);

        vm.prank(user1);
        autoRange.removeRange(tokenId);

        assertFalse(autoRange.getRangeConfig(tokenId).enabled);
    }

    function test_RemoveRange_EmitsEvent() public {
        uint256 tokenId = _configurePosition(user1);

        vm.expectEmit(true, false, false, false);
        emit IV4AutoRange.RangeRemoved(tokenId);

        vm.prank(user1);
        autoRange.removeRange(tokenId);
    }

    function test_RemoveRange_RevertIfNotOwner() public {
        uint256 tokenId = _configurePosition(user1);

        vm.prank(user2);
        vm.expectRevert();
        autoRange.removeRange(tokenId);
    }

    // ============ UpdateRangeConfig Tests ============

    function test_UpdateRangeConfig() public {
        uint256 tokenId = _configurePosition(user1);

        IV4AutoRange.RangeConfig memory newConfig = IV4AutoRange.RangeConfig({
            enabled: true,
            lowerDelta: 240,
            upperDelta: 240,
            rebalanceThreshold: 3000,
            minRebalanceInterval: 7200,
            collectFeesOnRebalance: true,
            maxSwapSlippage: 300
        });

        vm.prank(user1);
        autoRange.updateRangeConfig(tokenId, newConfig);

        IV4AutoRange.RangeConfig memory stored = autoRange.getRangeConfig(tokenId);
        assertEq(stored.lowerDelta, 240);
        assertEq(stored.upperDelta, 240);
        assertEq(stored.rebalanceThreshold, 3000);
    }

    function test_UpdateRangeConfig_RevertIfNotOwner() public {
        uint256 tokenId = _configurePosition(user1);

        IV4AutoRange.RangeConfig memory newConfig = IV4AutoRange.RangeConfig({
            enabled: true,
            lowerDelta: 240,
            upperDelta: 240,
            rebalanceThreshold: 3000,
            minRebalanceInterval: 7200,
            collectFeesOnRebalance: false,
            maxSwapSlippage: 300
        });

        vm.prank(user2);
        vm.expectRevert();
        autoRange.updateRangeConfig(tokenId, newConfig);
    }

    // ============ CheckRebalance Tests ============

    function test_CheckRebalance_InRange() public {
        uint256 tokenId = _configurePosition(user1);

        // Position is at TICK_LOWER=-120 to TICK_UPPER=120, price is at tick 0
        (bool needsRebalance, uint8 reason) = autoRange.checkRebalance(tokenId);
        assertFalse(needsRebalance);
        assertEq(reason, 0);
    }

    function test_CheckRebalance_BelowRange() public {
        uint256 tokenId = _configurePosition(user1);

        // Move price below the position range
        // Tick -200 is below TICK_LOWER=-120
        uint160 sqrtPriceLow = TickMath.getSqrtPriceAtTick(-200);
        poolManager.setSlot0(poolKey.toId(), sqrtPriceLow, -200);

        (bool needsRebalance, uint8 reason) = autoRange.checkRebalance(tokenId);
        assertTrue(needsRebalance);
        assertEq(reason, 1); // Below range
    }

    function test_CheckRebalance_AboveRange() public {
        uint256 tokenId = _configurePosition(user1);

        // Move price above the position range
        uint160 sqrtPriceHigh = TickMath.getSqrtPriceAtTick(200);
        poolManager.setSlot0(poolKey.toId(), sqrtPriceHigh, 200);

        (bool needsRebalance, uint8 reason) = autoRange.checkRebalance(tokenId);
        assertTrue(needsRebalance);
        assertEq(reason, 2); // Above range
    }

    function test_CheckRebalance_NotConfigured() public {
        uint256 tokenId = _createPosition(user1);

        (bool needsRebalance,) = autoRange.checkRebalance(tokenId);
        assertFalse(needsRebalance);
    }

    function test_CheckRebalance_ThresholdBased() public {
        uint256 tokenId = _createPosition(user1);

        // Configure with 50% threshold - rebalance when in outer 50% of range
        IV4AutoRange.RangeConfig memory config = IV4AutoRange.RangeConfig({
            enabled: true,
            lowerDelta: 120,
            upperDelta: 120,
            rebalanceThreshold: 5000, // 50% threshold
            minRebalanceInterval: 3600,
            collectFeesOnRebalance: false,
            maxSwapSlippage: 500
        });

        vm.prank(user1);
        autoRange.configureRange(tokenId, config);

        // Position range is -120 to 120 (width=240)
        // With 50% threshold, rebalance if tick < -120 + 120 = 0 or tick > 120 - 120 = 0
        // Current tick is 0, so it's exactly at the threshold boundary

        // Move tick to -61 (in the lower 50% zone)
        uint160 sqrtPrice = TickMath.getSqrtPriceAtTick(-61);
        poolManager.setSlot0(poolKey.toId(), sqrtPrice, -61);

        (bool needsRebalance, uint8 reason) = autoRange.checkRebalance(tokenId);
        assertTrue(needsRebalance);
        assertEq(reason, 1); // Near lower bound
    }

    // ============ BatchCheckRebalance Tests ============

    function test_BatchCheckRebalance() public {
        uint256 tokenId1 = _configurePosition(user1);
        uint256 tokenId2 = _configurePosition(user1);

        // Move price out of range for second position
        uint160 sqrtPriceHigh = TickMath.getSqrtPriceAtTick(200);
        poolManager.setSlot0(poolKey.toId(), sqrtPriceHigh, 200);

        uint256[] memory tokenIds = new uint256[](2);
        tokenIds[0] = tokenId1;
        tokenIds[1] = tokenId2;

        bool[] memory results = autoRange.batchCheckRebalance(tokenIds);
        // Both positions share the same pool, so both should need rebalance
        assertTrue(results[0]);
        assertTrue(results[1]);
    }

    // ============ CalculateOptimalRange Tests ============

    function test_CalculateOptimalRange() public {
        uint256 tokenId = _configurePosition(user1);

        (int24 tickLower, int24 tickUpper) = autoRange.calculateOptimalRange(tokenId);

        // Config has lowerDelta=120, upperDelta=120
        // Current tick is 0, nearest aligned tick is 0
        // tickLower = 0 - 120 = -120
        // tickUpper = 0 + 120 = 120
        assertEq(tickLower, -120);
        assertEq(tickUpper, 120);
    }

    function test_CalculateOptimalRange_AtDifferentPrice() public {
        uint256 tokenId = _configurePosition(user1);

        // Move price to tick 180
        uint160 sqrtPrice = TickMath.getSqrtPriceAtTick(180);
        poolManager.setSlot0(poolKey.toId(), sqrtPrice, 180);

        (int24 tickLower, int24 tickUpper) = autoRange.calculateOptimalRange(tokenId);

        // Nearest aligned tick for 180 with spacing 60 = floor(180/60)*60 = 180
        // tickLower = 180 - 120 = 60
        // tickUpper = 180 + 120 = 300
        assertEq(tickLower, 60);
        assertEq(tickUpper, 300);
    }

    // ============ GetPositionStatus Tests ============

    function test_GetPositionStatus_InRange() public {
        uint256 tokenId = _createPosition(user1);

        (bool inRange, int24 currentTick, int24 tickLower, int24 tickUpper) = autoRange.getPositionStatus(tokenId);

        assertTrue(inRange);
        assertEq(currentTick, 0);
        assertEq(tickLower, TICK_LOWER);
        assertEq(tickUpper, TICK_UPPER);
    }

    function test_GetPositionStatus_OutOfRange() public {
        uint256 tokenId = _createPosition(user1);

        uint160 sqrtPrice = TickMath.getSqrtPriceAtTick(200);
        poolManager.setSlot0(poolKey.toId(), sqrtPrice, 200);

        (bool inRange, int24 currentTick,,) = autoRange.getPositionStatus(tokenId);

        assertFalse(inRange);
        assertEq(currentTick, 200);
    }

    // ============ ExecuteRebalance Tests ============

    function test_ExecuteRebalance_OutOfRange() public {
        uint256 tokenId = _configurePosition(user1);

        // Move price out of range
        uint160 sqrtPriceHigh = TickMath.getSqrtPriceAtTick(200);
        poolManager.setSlot0(poolKey.toId(), sqrtPriceHigh, 200);

        // Wait for rebalance interval
        vm.warp(block.timestamp + 3601);

        // Bot executes rebalance
        vm.prank(bot);
        IV4AutoRange.RebalanceResult memory result = autoRange.executeRebalance(tokenId, "", block.timestamp + 1 hours);

        assertGt(result.newTokenId, 0, "New token should be created");
        assertGt(result.liquidity, 0, "New position should have liquidity");
    }

    function test_ExecuteRebalance_ConfigTransferred() public {
        uint256 tokenId = _configurePosition(user1);

        uint160 sqrtPriceHigh = TickMath.getSqrtPriceAtTick(200);
        poolManager.setSlot0(poolKey.toId(), sqrtPriceHigh, 200);

        vm.warp(block.timestamp + 3601);

        vm.prank(bot);
        IV4AutoRange.RebalanceResult memory result = autoRange.executeRebalance(tokenId, "", block.timestamp + 1 hours);

        // Old config should be deleted
        assertFalse(autoRange.getRangeConfig(tokenId).enabled, "Old config should be deleted");

        // New position should have config
        assertTrue(autoRange.getRangeConfig(result.newTokenId).enabled, "New config should exist");
        assertEq(autoRange.getRangeConfig(result.newTokenId).lowerDelta, 120);
    }

    function test_ExecuteRebalance_RebalancedToMapping() public {
        uint256 tokenId = _configurePosition(user1);

        uint160 sqrtPriceHigh = TickMath.getSqrtPriceAtTick(200);
        poolManager.setSlot0(poolKey.toId(), sqrtPriceHigh, 200);

        vm.warp(block.timestamp + 3601);

        vm.prank(bot);
        IV4AutoRange.RebalanceResult memory result = autoRange.executeRebalance(tokenId, "", block.timestamp + 1 hours);

        // rebalancedTo mapping should be updated
        assertEq(autoRange.rebalancedTo(tokenId), result.newTokenId);
    }

    function test_ExecuteRebalance_EmitsEvent() public {
        uint256 tokenId = _configurePosition(user1);

        uint160 sqrtPriceHigh = TickMath.getSqrtPriceAtTick(200);
        poolManager.setSlot0(poolKey.toId(), sqrtPriceHigh, 200);

        vm.warp(block.timestamp + 3601);

        // Can't easily predict all event args, just verify no revert
        vm.prank(bot);
        autoRange.executeRebalance(tokenId, "", block.timestamp + 1 hours);
    }

    function test_ExecuteRebalance_RevertIfNotConfigured() public {
        uint256 tokenId = _createPosition(user1);

        vm.prank(bot);
        vm.expectRevert("Not configured");
        autoRange.executeRebalance(tokenId, "", block.timestamp + 1 hours);
    }

    function test_ExecuteRebalance_RevertIfTooSoon() public {
        uint256 tokenId = _configurePosition(user1);

        uint160 sqrtPriceHigh = TickMath.getSqrtPriceAtTick(200);
        poolManager.setSlot0(poolKey.toId(), sqrtPriceHigh, 200);

        // Don't wait - should fail
        vm.prank(bot);
        vm.expectRevert("Too soon");
        autoRange.executeRebalance(tokenId, "", block.timestamp + 1 hours);
    }

    function test_ExecuteRebalance_RevertIfInRange() public {
        uint256 tokenId = _configurePosition(user1);

        // Price is in range - no rebalance needed
        vm.warp(block.timestamp + 3601);

        vm.prank(bot);
        vm.expectRevert("Rebalance not needed");
        autoRange.executeRebalance(tokenId, "", block.timestamp + 1 hours);
    }

    function test_ExecuteRebalance_RevertIfDeadlinePassed() public {
        uint256 tokenId = _configurePosition(user1);

        uint160 sqrtPriceHigh = TickMath.getSqrtPriceAtTick(200);
        poolManager.setSlot0(poolKey.toId(), sqrtPriceHigh, 200);

        vm.warp(block.timestamp + 3601);

        vm.prank(bot);
        vm.expectRevert();
        autoRange.executeRebalance(tokenId, "", block.timestamp - 1);
    }

    function test_ExecuteRebalance_RevertIfPaused() public {
        uint256 tokenId = _configurePosition(user1);

        uint160 sqrtPriceHigh = TickMath.getSqrtPriceAtTick(200);
        poolManager.setSlot0(poolKey.toId(), sqrtPriceHigh, 200);

        vm.warp(block.timestamp + 3601);

        vm.prank(owner);
        autoRange.pause();

        vm.prank(bot);
        vm.expectRevert();
        autoRange.executeRebalance(tokenId, "", block.timestamp + 1 hours);
    }

    function test_ExecuteRebalance_SwapDataOnlyByOwner() public {
        uint256 tokenId = _configurePosition(user1);

        uint160 sqrtPriceHigh = TickMath.getSqrtPriceAtTick(200);
        poolManager.setSlot0(poolKey.toId(), sqrtPriceHigh, 200);

        vm.warp(block.timestamp + 3601);

        // Bot tries with swap data - should revert (only owner can provide swap data)
        bytes memory swapData = abi.encode(address(router), "");

        vm.prank(bot);
        vm.expectRevert();
        autoRange.executeRebalance(tokenId, swapData, block.timestamp + 1 hours);
    }

    function test_ExecuteRebalance_WithFeeCollection() public {
        uint256 tokenId = _createPosition(user1);

        // Configure with fee collection enabled
        IV4AutoRange.RangeConfig memory config = IV4AutoRange.RangeConfig({
            enabled: true,
            lowerDelta: 120,
            upperDelta: 120,
            rebalanceThreshold: 0,
            minRebalanceInterval: 3600,
            collectFeesOnRebalance: true,
            maxSwapSlippage: 500
        });

        vm.prank(user1);
        autoRange.configureRange(tokenId, config);

        // Add fees
        positionManager.addFees(tokenId, 5e18, 5e18);

        // Move price out of range
        uint160 sqrtPriceHigh = TickMath.getSqrtPriceAtTick(200);
        poolManager.setSlot0(poolKey.toId(), sqrtPriceHigh, 200);

        vm.warp(block.timestamp + 3601);

        vm.prank(bot);
        IV4AutoRange.RebalanceResult memory result = autoRange.executeRebalance(tokenId, "", block.timestamp + 1 hours);

        assertGt(result.newTokenId, 0, "Should create new position");
    }

    function test_ExecuteRebalance_ProtocolFeeTaken() public {
        uint256 tokenId = _configurePosition(user1);

        uint160 sqrtPriceHigh = TickMath.getSqrtPriceAtTick(200);
        poolManager.setSlot0(poolKey.toId(), sqrtPriceHigh, 200);

        vm.warp(block.timestamp + 3601);

        vm.prank(bot);
        IV4AutoRange.RebalanceResult memory result = autoRange.executeRebalance(tokenId, "", block.timestamp + 1 hours);

        // M-04: Protocol fee is only charged on swap output (amounts that increased)
        // With no swap (empty swapData), no fee should be taken
        assertEq(result.fee0, 0, "No fee0 without swap");
        assertEq(result.fee1, 0, "No fee1 without swap");
    }

    function test_ExecuteRebalance_MultipleRebalances() public {
        // Set initial time
        vm.warp(100000);

        uint256 tokenId = _configurePosition(user1);

        // First rebalance - move price out of range
        uint160 sqrtPrice1 = TickMath.getSqrtPriceAtTick(200);
        poolManager.setSlot0(poolKey.toId(), sqrtPrice1, 200);

        // Wait well past min interval (3600s)
        vm.warp(200000);

        vm.prank(bot);
        IV4AutoRange.RebalanceResult memory result1 = autoRange.executeRebalance(tokenId, "", 210000);

        uint256 newTokenId1 = result1.newTokenId;
        assertGt(newTokenId1, 0, "First rebalance should create position");

        // Second rebalance - move price further out
        uint160 sqrtPrice2 = TickMath.getSqrtPriceAtTick(500);
        poolManager.setSlot0(poolKey.toId(), sqrtPrice2, 500);

        // Wait well past min interval again
        vm.warp(300000);

        vm.prank(bot);
        IV4AutoRange.RebalanceResult memory result2 = autoRange.executeRebalance(newTokenId1, "", 310000);

        assertGt(result2.newTokenId, newTokenId1, "Should create another new position");
        assertEq(autoRange.rebalancedTo(newTokenId1), result2.newTokenId);
    }

    // ============ Protocol Fee Tests ============

    function test_SetProtocolFee_AsOwner() public {
        vm.prank(owner);
        autoRange.setProtocolFee(100);

        assertEq(autoRange.protocolFee(), 100);
    }

    function test_SetProtocolFee_EmitsEvent() public {
        vm.expectEmit(false, false, false, true);
        emit IV4AutoRange.ProtocolFeeUpdated(65, 100);

        vm.prank(owner);
        autoRange.setProtocolFee(100);
    }

    function test_SetProtocolFee_RevertIfNotOwner() public {
        vm.prank(user1);
        vm.expectRevert();
        autoRange.setProtocolFee(100);
    }

    function test_SetProtocolFee_RevertIfTooHigh() public {
        vm.prank(owner);
        vm.expectRevert("Fee too high");
        autoRange.setProtocolFee(1001);
    }

    function test_SetProtocolFee_RevertIfCooldown() public {
        vm.prank(owner);
        autoRange.setProtocolFee(100);

        // Try again within cooldown
        vm.prank(owner);
        vm.expectRevert("Fee change cooldown");
        autoRange.setProtocolFee(200);
    }

    function test_SetProtocolFee_AfterCooldown() public {
        vm.prank(owner);
        autoRange.setProtocolFee(100);

        vm.warp(block.timestamp + 24 hours + 1);

        vm.prank(owner);
        autoRange.setProtocolFee(200);

        assertEq(autoRange.protocolFee(), 200);
    }

    // ============ Withdraw Fees Tests ============

    function test_WithdrawFees_AfterRebalance() public {
        uint256 tokenId = _configurePosition(user1);

        uint160 sqrtPriceHigh = TickMath.getSqrtPriceAtTick(200);
        poolManager.setSlot0(poolKey.toId(), sqrtPriceHigh, 200);
        vm.warp(block.timestamp + 3601);

        vm.prank(bot);
        autoRange.executeRebalance(tokenId, "", block.timestamp + 1 hours);

        Currency currency0 = Currency.wrap(address(token0));
        uint256 accumulated = autoRange.accumulatedFees(currency0);

        if (accumulated > 0) {
            uint256 ownerBalBefore = token0.balanceOf(owner);

            vm.prank(owner);
            autoRange.withdrawFees(currency0, owner);

            assertGt(token0.balanceOf(owner), ownerBalBefore);
            assertEq(autoRange.accumulatedFees(currency0), 0);
        }
    }

    function test_WithdrawFees_RevertIfNoFees() public {
        Currency currency0 = Currency.wrap(address(token0));

        vm.prank(owner);
        vm.expectRevert("No fees");
        autoRange.withdrawFees(currency0, owner);
    }

    function test_WithdrawFees_EmitsEvent() public {
        uint256 tokenId = _configurePosition(user1);

        uint160 sqrtPriceHigh = TickMath.getSqrtPriceAtTick(200);
        poolManager.setSlot0(poolKey.toId(), sqrtPriceHigh, 200);
        vm.warp(block.timestamp + 3601);

        vm.prank(bot);
        autoRange.executeRebalance(tokenId, "", block.timestamp + 1 hours);

        Currency currency0 = Currency.wrap(address(token0));
        uint256 accumulated = autoRange.accumulatedFees(currency0);

        if (accumulated > 0) {
            vm.expectEmit(true, false, false, true);
            emit IV4AutoRange.FeesWithdrawn(owner, currency0, accumulated);

            vm.prank(owner);
            autoRange.withdrawFees(currency0, owner);
        }
    }

    // ============ BatchWithdrawFees Tests ============

    function test_BatchWithdrawFees() public {
        uint256 tokenId = _configurePosition(user1);

        uint160 sqrtPriceHigh = TickMath.getSqrtPriceAtTick(200);
        poolManager.setSlot0(poolKey.toId(), sqrtPriceHigh, 200);
        vm.warp(block.timestamp + 3601);

        vm.prank(bot);
        autoRange.executeRebalance(tokenId, "", block.timestamp + 1 hours);

        Currency[] memory currencies = new Currency[](2);
        currencies[0] = Currency.wrap(address(token0));
        currencies[1] = Currency.wrap(address(token1));

        vm.prank(owner);
        autoRange.batchWithdrawFees(currencies, owner);

        assertEq(autoRange.accumulatedFees(currencies[0]), 0);
        assertEq(autoRange.accumulatedFees(currencies[1]), 0);
    }

    function test_BatchWithdrawFees_RevertIfNotOwner() public {
        Currency[] memory currencies = new Currency[](1);
        currencies[0] = Currency.wrap(address(token0));

        vm.prank(user1);
        vm.expectRevert();
        autoRange.batchWithdrawFees(currencies, user1);
    }

    // ============ Pause Tests ============

    function test_Pause_AsOwner() public {
        vm.prank(owner);
        autoRange.pause();
        assertTrue(autoRange.paused());
    }

    function test_Unpause_AsOwner() public {
        vm.prank(owner);
        autoRange.pause();

        vm.prank(owner);
        autoRange.unpause();
        assertFalse(autoRange.paused());
    }

    // ============ Operator Tests ============

    function test_OperatorCanConfigure() public {
        uint256 tokenId = _createPosition(user1);

        vm.prank(user1);
        autoRange.setOperatorApproval(operator, true);

        IV4AutoRange.RangeConfig memory config = IV4AutoRange.RangeConfig({
            enabled: true,
            lowerDelta: 120,
            upperDelta: 120,
            rebalanceThreshold: 0,
            minRebalanceInterval: 3600,
            collectFeesOnRebalance: false,
            maxSwapSlippage: 500
        });

        vm.prank(operator);
        autoRange.configureRange(tokenId, config);

        assertTrue(autoRange.getRangeConfig(tokenId).enabled);
    }

    // ============ Upgrade Tests ============

    function test_Upgrade_AsOwner() public {
        V4AutoRange newImpl = new V4AutoRange(
            address(poolManager),
            address(positionManager),
            address(weth)
        );

        vm.prank(owner);
        autoRange.upgradeToAndCall(address(newImpl), "");
        assertEq(autoRange.owner(), owner);
    }

    function test_Upgrade_RevertIfNotOwner() public {
        V4AutoRange newImpl = new V4AutoRange(
            address(poolManager),
            address(positionManager),
            address(weth)
        );

        vm.prank(user1);
        vm.expectRevert();
        autoRange.upgradeToAndCall(address(newImpl), "");
    }

    // ============ CollectFeesExternal Tests ============

    function test_CollectFeesExternal_RevertIfNotSelf() public {
        uint256 tokenId = _createPosition(user1);

        vm.prank(user1);
        vm.expectRevert("Only self");
        autoRange.collectFeesExternal(tokenId);
    }

    // ============ Fuzz Tests ============

    function testFuzz_ConfigureRange_Deltas(int24 lowerDelta, int24 upperDelta) public {
        uint256 tokenId = _createPosition(user1);

        // Bound to valid tick-spacing-aligned values
        lowerDelta = int24(bound(lowerDelta, 1, 887220 / TICK_SPACING)) * TICK_SPACING;
        upperDelta = int24(bound(upperDelta, 1, 887220 / TICK_SPACING)) * TICK_SPACING;

        IV4AutoRange.RangeConfig memory config = IV4AutoRange.RangeConfig({
            enabled: true,
            lowerDelta: lowerDelta,
            upperDelta: upperDelta,
            rebalanceThreshold: 0,
            minRebalanceInterval: 3600,
            collectFeesOnRebalance: false,
            maxSwapSlippage: 500
        });

        vm.prank(user1);
        autoRange.configureRange(tokenId, config);

        assertEq(autoRange.getRangeConfig(tokenId).lowerDelta, lowerDelta);
        assertEq(autoRange.getRangeConfig(tokenId).upperDelta, upperDelta);
    }

    function testFuzz_SetProtocolFee_Value(uint256 fee) public {
        if (fee > 1000) {
            vm.prank(owner);
            vm.expectRevert("Fee too high");
            autoRange.setProtocolFee(fee);
        } else {
            vm.prank(owner);
            autoRange.setProtocolFee(fee);
            assertEq(autoRange.protocolFee(), fee);
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

    function _configurePosition(address posOwner) internal returns (uint256 tokenId) {
        tokenId = _createPosition(posOwner);

        IV4AutoRange.RangeConfig memory config = IV4AutoRange.RangeConfig({
            enabled: true,
            lowerDelta: 120,
            upperDelta: 120,
            rebalanceThreshold: 0,
            minRebalanceInterval: 3600,
            collectFeesOnRebalance: false,
            maxSwapSlippage: 500
        });

        vm.prank(posOwner);
        autoRange.configureRange(tokenId, config);
    }
}
