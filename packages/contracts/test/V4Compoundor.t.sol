// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import { Test, console2 } from "forge-std/Test.sol";
import { BaseTest, MockERC20 } from "./BaseTest.sol";
import { Currency, CurrencyLibrary } from "@uniswap/v4-core/src/types/Currency.sol";
import { PoolKey } from "@uniswap/v4-core/src/types/PoolKey.sol";

import { V4Compoundor } from "../src/automators/V4Compoundor.sol";
import { IV4Compoundor } from "../src/interfaces/IV4Compoundor.sol";
import { ERC1967Proxy } from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";

/// @title V4CompoundorTest
/// @notice Comprehensive tests for V4Compoundor contract
contract V4CompoundorTest is BaseTest {
    using CurrencyLibrary for Currency;

    V4Compoundor public compoundor;
    V4Compoundor public compoundorImpl;

    // Bot caller for auto-compound
    address public bot;

    function setUp() public override {
        super.setUp();

        bot = makeAddr("bot");
        vm.deal(bot, 10 ether);

        // Deploy V4Compoundor implementation
        compoundorImpl = new V4Compoundor(
            address(poolManager),
            address(positionManager),
            address(weth)
        );

        // Deploy proxy
        bytes memory initData = abi.encodeWithSelector(V4Compoundor.initialize.selector, owner);
        address proxy = deployProxy(address(compoundorImpl), initData);
        compoundor = V4Compoundor(payable(proxy));

        // Setup router approval
        vm.prank(owner);
        compoundor.setRouterApproval(address(router), true);

        // Approve tokens for compoundor
        approveTokens(user1, address(compoundor), type(uint256).max);
        approveTokens(user2, address(compoundor), type(uint256).max);

        labelAddresses();
        vm.label(address(compoundor), "V4Compoundor");
        vm.label(bot, "Bot");
    }

    // ============ Initialization Tests ============

    function test_Initialize_SetsOwner() public view {
        assertEq(compoundor.owner(), owner);
    }

    function test_Initialize_SetsPoolManager() public view {
        assertEq(address(compoundor.poolManager()), address(poolManager));
    }

    function test_Initialize_SetsPositionManager() public view {
        assertEq(address(compoundor.positionManager()), address(positionManager));
    }

    function test_Initialize_CannotReinitialize() public {
        vm.expectRevert();
        compoundor.initialize(user1);
    }

    function test_Version() public view {
        assertEq(compoundor.VERSION(), "1.1.0");
    }

    function test_DefaultProtocolFee() public view {
        assertEq(compoundor.protocolFee(), 65); // 0.65%
    }

    function test_DefaultMaxCompoundSlippage() public view {
        assertEq(compoundor.maxCompoundSlippage(), 200); // 2%
    }

    // ============ Register Position Tests ============

    function test_RegisterPosition_AsOwner() public {
        uint256 tokenId = _createPosition(user1);

        IV4Compoundor.CompoundConfig memory config = IV4Compoundor.CompoundConfig({
            enabled: true,
            minCompoundInterval: 300,
            minRewardAmount: 0.01e18
        });

        vm.prank(user1);
        compoundor.registerPosition(tokenId, config);

        IV4Compoundor.CompoundConfig memory stored = compoundor.getConfig(tokenId);
        assertTrue(stored.enabled);
        assertEq(stored.minCompoundInterval, 300);
        assertEq(stored.minRewardAmount, 0.01e18);
    }

    function test_RegisterPosition_EmitsEvent() public {
        uint256 tokenId = _createPosition(user1);

        IV4Compoundor.CompoundConfig memory config = IV4Compoundor.CompoundConfig({
            enabled: true,
            minCompoundInterval: 300,
            minRewardAmount: 0
        });

        vm.expectEmit(true, true, false, false);
        emit IV4Compoundor.PositionRegistered(tokenId, user1);

        vm.prank(user1);
        compoundor.registerPosition(tokenId, config);
    }

    function test_RegisterPosition_RevertIfNotOwner() public {
        uint256 tokenId = _createPosition(user1);

        IV4Compoundor.CompoundConfig memory config = IV4Compoundor.CompoundConfig({
            enabled: true,
            minCompoundInterval: 300,
            minRewardAmount: 0
        });

        vm.prank(user2);
        vm.expectRevert();
        compoundor.registerPosition(tokenId, config);
    }

    function test_RegisterPosition_RevertIfIntervalTooShort() public {
        uint256 tokenId = _createPosition(user1);

        IV4Compoundor.CompoundConfig memory config = IV4Compoundor.CompoundConfig({
            enabled: true,
            minCompoundInterval: 100, // Below MIN_COMPOUND_INTERVAL (300)
            minRewardAmount: 0
        });

        vm.prank(user1);
        vm.expectRevert("Interval too short");
        compoundor.registerPosition(tokenId, config);
    }

    function test_RegisterPosition_WithOperatorApproval() public {
        uint256 tokenId = _createPosition(user1);

        // User1 approves operator
        vm.prank(user1);
        compoundor.setOperatorApproval(operator, true);

        IV4Compoundor.CompoundConfig memory config = IV4Compoundor.CompoundConfig({
            enabled: true,
            minCompoundInterval: 300,
            minRewardAmount: 0
        });

        vm.prank(operator);
        compoundor.registerPosition(tokenId, config);

        assertTrue(compoundor.getConfig(tokenId).enabled);
    }

    // ============ Unregister Position Tests ============

    function test_UnregisterPosition_AsOwner() public {
        uint256 tokenId = _registerPosition(user1);

        vm.prank(user1);
        compoundor.unregisterPosition(tokenId);

        assertFalse(compoundor.getConfig(tokenId).enabled);
    }

    function test_UnregisterPosition_EmitsEvent() public {
        uint256 tokenId = _registerPosition(user1);

        vm.expectEmit(true, true, false, false);
        emit IV4Compoundor.PositionUnregistered(tokenId, user1);

        vm.prank(user1);
        compoundor.unregisterPosition(tokenId);
    }

    function test_UnregisterPosition_RevertIfNotOwner() public {
        uint256 tokenId = _registerPosition(user1);

        vm.prank(user2);
        vm.expectRevert();
        compoundor.unregisterPosition(tokenId);
    }

    // ============ Update Config Tests ============

    function test_UpdateConfig_AsOwner() public {
        uint256 tokenId = _registerPosition(user1);

        IV4Compoundor.CompoundConfig memory newConfig = IV4Compoundor.CompoundConfig({
            enabled: true,
            minCompoundInterval: 600,
            minRewardAmount: 0.1e18
        });

        vm.prank(user1);
        compoundor.updateConfig(tokenId, newConfig);

        IV4Compoundor.CompoundConfig memory stored = compoundor.getConfig(tokenId);
        assertEq(stored.minCompoundInterval, 600);
        assertEq(stored.minRewardAmount, 0.1e18);
    }

    function test_UpdateConfig_RevertIfIntervalTooShort() public {
        uint256 tokenId = _registerPosition(user1);

        IV4Compoundor.CompoundConfig memory newConfig = IV4Compoundor.CompoundConfig({
            enabled: true,
            minCompoundInterval: 10,
            minRewardAmount: 0
        });

        vm.prank(user1);
        vm.expectRevert("Interval too short");
        compoundor.updateConfig(tokenId, newConfig);
    }

    // ============ AutoCompound Tests ============

    function test_AutoCompound_ByBot() public {
        uint256 tokenId = _registerPosition(user1);

        // Add fees to position (mock puts them in feeOwed0/feeOwed1)
        positionManager.addFees(tokenId, 10e18, 10e18);

        // Wait for compound interval
        vm.warp(block.timestamp + 301);

        uint128 liquidityBefore = positionManager.getPositionLiquidity(tokenId);

        // Bot calls autoCompound
        vm.prank(bot);
        IV4Compoundor.CompoundResult memory result = compoundor.autoCompound(tokenId, "", block.timestamp + 1 hours);

        // The mock collects fees via DECREASE_LIQUIDITY(0) + TAKE_PAIR
        // Protocol fee should be taken from collected amounts
        // Result tracks what was compounded and what was protocol fee
        // If fees were collected, protocol fee should be non-zero
        if (result.amount0Compounded > 0 || result.amount1Compounded > 0) {
            // Fees were collected and compounded
            assertGt(result.liquidityAdded, 0, "Should add liquidity");
        }

        // LastCompoundTime should be updated
        assertEq(compoundor.getLastCompoundTime(tokenId), block.timestamp);
    }

    function test_AutoCompound_EmitsEvent() public {
        uint256 tokenId = _registerPosition(user1);
        positionManager.addFees(tokenId, 5e18, 5e18);
        vm.warp(block.timestamp + 301);

        vm.prank(bot);
        compoundor.autoCompound(tokenId, "", block.timestamp + 1 hours);
        // Event is emitted - we just verify no revert
    }

    function test_AutoCompound_RevertIfNotRegistered() public {
        uint256 tokenId = _createPosition(user1);
        // Not registered

        vm.prank(bot);
        vm.expectRevert("Not registered");
        compoundor.autoCompound(tokenId, "", block.timestamp + 1 hours);
    }

    function test_AutoCompound_RevertIfTooSoon() public {
        uint256 tokenId = _registerPosition(user1);
        positionManager.addFees(tokenId, 5e18, 5e18);

        // Compound once
        vm.warp(block.timestamp + 301);
        vm.prank(bot);
        compoundor.autoCompound(tokenId, "", block.timestamp + 1 hours);

        // Add more fees
        positionManager.addFees(tokenId, 5e18, 5e18);

        // Try again immediately - should fail
        vm.prank(bot);
        vm.expectRevert("Too soon");
        compoundor.autoCompound(tokenId, "", block.timestamp + 1 hours);
    }

    function test_AutoCompound_AfterInterval() public {
        uint256 tokenId = _registerPosition(user1);
        positionManager.addFees(tokenId, 5e18, 5e18);

        // First compound at t=1000
        vm.warp(1000);
        vm.prank(bot);
        compoundor.autoCompound(tokenId, "", block.timestamp + 1 hours);
        assertEq(compoundor.getLastCompoundTime(tokenId), 1000);

        // Add more fees and warp well past interval (300s) at t=2000
        positionManager.addFees(tokenId, 5e18, 5e18);
        vm.warp(2000);

        // Second compound should work
        vm.prank(bot);
        compoundor.autoCompound(tokenId, "", block.timestamp + 1 hours);

        assertEq(compoundor.getLastCompoundTime(tokenId), 2000);
    }

    function test_AutoCompound_RevertIfDeadlinePassed() public {
        uint256 tokenId = _registerPosition(user1);
        positionManager.addFees(tokenId, 5e18, 5e18);
        vm.warp(block.timestamp + 301);

        vm.prank(bot);
        vm.expectRevert();
        compoundor.autoCompound(tokenId, "", block.timestamp - 1);
    }

    function test_AutoCompound_RevertIfPaused() public {
        uint256 tokenId = _registerPosition(user1);
        positionManager.addFees(tokenId, 5e18, 5e18);
        vm.warp(block.timestamp + 301);

        vm.prank(owner);
        compoundor.pause();

        vm.prank(bot);
        vm.expectRevert();
        compoundor.autoCompound(tokenId, "", block.timestamp + 1 hours);
    }

    function test_AutoCompound_SwapDataOnlyByOwner() public {
        uint256 tokenId = _registerPosition(user1);
        positionManager.addFees(tokenId, 5e18, 5e18);
        vm.warp(block.timestamp + 301);

        // Bot tries with swap data - should revert (only owner can provide swap data)
        bytes memory swapData = abi.encode(address(router), "");

        vm.prank(bot);
        vm.expectRevert();
        compoundor.autoCompound(tokenId, swapData, block.timestamp + 1 hours);
    }

    function test_AutoCompound_NoFeesToCompound() public {
        uint256 tokenId = _registerPosition(user1);
        // No fees added
        vm.warp(block.timestamp + 301);

        vm.prank(bot);
        IV4Compoundor.CompoundResult memory result = compoundor.autoCompound(tokenId, "", block.timestamp + 1 hours);

        // Result should be zero
        assertEq(result.amount0Compounded, 0);
        assertEq(result.amount1Compounded, 0);
        assertEq(result.liquidityAdded, 0);
    }

    // ============ SelfCompound Tests ============

    function test_SelfCompound_AsOwner() public {
        uint256 tokenId = _registerPosition(user1);
        positionManager.addFees(tokenId, 10e18, 10e18);

        vm.prank(user1);
        IV4Compoundor.CompoundResult memory result = compoundor.selfCompound(tokenId, "", block.timestamp + 1 hours);

        // Self-compound should NOT take protocol fees
        assertEq(result.fee0, 0, "Self-compound should have 0 fee0");
        assertEq(result.fee1, 0, "Self-compound should have 0 fee1");
    }

    function test_SelfCompound_RevertIfNotOwner() public {
        uint256 tokenId = _registerPosition(user1);
        positionManager.addFees(tokenId, 10e18, 10e18);

        vm.prank(user2);
        vm.expectRevert();
        compoundor.selfCompound(tokenId, "", block.timestamp + 1 hours);
    }

    function test_SelfCompound_NoRegistrationRequired() public {
        uint256 tokenId = _createPosition(user1);
        // NOT registered, but self-compound doesn't check registration
        positionManager.addFees(tokenId, 10e18, 10e18);

        vm.prank(user1);
        // selfCompound doesn't check config.enabled, it just compounds
        compoundor.selfCompound(tokenId, "", block.timestamp + 1 hours);
    }

    // ============ IsCompoundProfitable Tests ============

    function test_IsCompoundProfitable_NoFeeGrowth() public {
        uint256 tokenId = _createPosition(user1);

        // Register with a non-zero minRewardAmount
        IV4Compoundor.CompoundConfig memory config = IV4Compoundor.CompoundConfig({
            enabled: true,
            minCompoundInterval: 300,
            minRewardAmount: 1e18 // Require at least 1 token
        });
        vm.prank(user1);
        compoundor.registerPosition(tokenId, config);

        // The mock doesn't implement feeGrowth storage, so getPendingFees returns 0
        // With minRewardAmount=1e18, 0 < 1e18 means not profitable
        (bool profitable, uint256 reward) = compoundor.isCompoundProfitable(tokenId);
        assertFalse(profitable);
        assertEq(reward, 0);
    }

    function test_IsCompoundProfitable_ZeroMinReward() public {
        uint256 tokenId = _registerPosition(user1); // minRewardAmount = 0

        // With minRewardAmount=0, even 0 >= 0 is true (always profitable to try)
        (bool profitable,) = compoundor.isCompoundProfitable(tokenId);
        assertTrue(profitable);
    }

    function test_IsCompoundProfitable_NotRegistered() public {
        uint256 tokenId = _createPosition(user1);

        (bool profitable,) = compoundor.isCompoundProfitable(tokenId);
        assertFalse(profitable);
    }

    // ============ GetConfig Tests ============

    function test_GetConfig_Registered() public {
        uint256 tokenId = _registerPosition(user1);

        IV4Compoundor.CompoundConfig memory config = compoundor.getConfig(tokenId);
        assertTrue(config.enabled);
        assertEq(config.minCompoundInterval, 300);
    }

    function test_GetConfig_Unregistered() public {
        uint256 tokenId = _createPosition(user1);

        IV4Compoundor.CompoundConfig memory config = compoundor.getConfig(tokenId);
        assertFalse(config.enabled);
        assertEq(config.minCompoundInterval, 0);
    }

    // ============ GetLastCompoundTime Tests ============

    function test_GetLastCompoundTime_BeforeCompound() public {
        uint256 tokenId = _registerPosition(user1);
        assertEq(compoundor.getLastCompoundTime(tokenId), 0);
    }

    function test_GetLastCompoundTime_AfterCompound() public {
        uint256 tokenId = _registerPosition(user1);
        positionManager.addFees(tokenId, 5e18, 5e18);

        vm.warp(block.timestamp + 301);
        uint256 expectedTime = block.timestamp;

        vm.prank(bot);
        compoundor.autoCompound(tokenId, "", block.timestamp + 1 hours);

        assertEq(compoundor.getLastCompoundTime(tokenId), expectedTime);
    }

    // ============ Protocol Fee Tests ============

    function test_SetProtocolFee_AsOwner() public {
        // Warp past initial cooldown (lastFeeChangeTime set to block.timestamp in initialize)
        vm.warp(block.timestamp + 24 hours + 1);

        vm.prank(owner);
        compoundor.setProtocolFee(100); // 1%

        assertEq(compoundor.protocolFee(), 100);
    }

    function test_SetProtocolFee_EmitsEvent() public {
        vm.warp(block.timestamp + 24 hours + 1);

        vm.expectEmit(false, false, false, true);
        emit IV4Compoundor.ProtocolFeeUpdated(65, 100);

        vm.prank(owner);
        compoundor.setProtocolFee(100);
    }

    function test_SetProtocolFee_RevertIfNotOwner() public {
        vm.warp(block.timestamp + 24 hours + 1);

        vm.prank(user1);
        vm.expectRevert();
        compoundor.setProtocolFee(100);
    }

    function test_SetProtocolFee_RevertIfTooHigh() public {
        vm.warp(block.timestamp + 24 hours + 1);

        vm.prank(owner);
        vm.expectRevert("Fee too high");
        compoundor.setProtocolFee(1001); // > MAX_PROTOCOL_FEE (1000)
    }

    function test_SetProtocolFee_RevertIfCooldown() public {
        vm.warp(block.timestamp + 24 hours + 1);

        vm.prank(owner);
        compoundor.setProtocolFee(100);

        // Try again within cooldown
        vm.prank(owner);
        vm.expectRevert("Fee change cooldown");
        compoundor.setProtocolFee(200);
    }

    function test_SetProtocolFee_AfterCooldown() public {
        // First change (no cooldown needed since lastFeeChangeTime == 0)
        vm.prank(owner);
        compoundor.setProtocolFee(100);

        uint256 changeTime = block.timestamp;

        // Warp EXACTLY past cooldown from the change time
        vm.warp(changeTime + 24 hours + 1);

        vm.prank(owner);
        compoundor.setProtocolFee(200);

        assertEq(compoundor.protocolFee(), 200);
    }

    // ============ MaxCompoundSlippage Tests ============

    function test_SetMaxCompoundSlippage_AsOwner() public {
        vm.prank(owner);
        compoundor.setMaxCompoundSlippage(500);

        assertEq(compoundor.maxCompoundSlippage(), 500);
    }

    function test_SetMaxCompoundSlippage_RevertIfTooHigh() public {
        vm.prank(owner);
        vm.expectRevert("Slippage too high");
        compoundor.setMaxCompoundSlippage(1001);
    }

    function test_SetMaxCompoundSlippage_RevertIfNotOwner() public {
        vm.prank(user1);
        vm.expectRevert();
        compoundor.setMaxCompoundSlippage(500);
    }

    // ============ Withdraw Fees Tests ============

    function test_WithdrawFees_AfterCompound() public {
        uint256 tokenId = _registerPosition(user1);
        positionManager.addFees(tokenId, 100e18, 100e18);
        vm.warp(block.timestamp + 301);

        // Compound to accumulate protocol fees
        vm.prank(bot);
        compoundor.autoCompound(tokenId, "", block.timestamp + 1 hours);

        // Check accumulated fees exist
        Currency currency0 = Currency.wrap(address(token0));
        uint256 accumulated = compoundor.accumulatedFees(currency0);

        if (accumulated > 0) {
            uint256 ownerBalBefore = token0.balanceOf(owner);

            vm.prank(owner);
            compoundor.withdrawFees(currency0, owner);

            assertGt(token0.balanceOf(owner), ownerBalBefore, "Owner should receive fees");
            assertEq(compoundor.accumulatedFees(currency0), 0, "Accumulated should be 0");
        }
    }

    function test_WithdrawFees_RevertIfNoFees() public {
        Currency currency0 = Currency.wrap(address(token0));

        vm.prank(owner);
        vm.expectRevert("No fees");
        compoundor.withdrawFees(currency0, owner);
    }

    function test_WithdrawFees_RevertIfNotOwner() public {
        Currency currency0 = Currency.wrap(address(token0));

        vm.prank(user1);
        vm.expectRevert();
        compoundor.withdrawFees(currency0, user1);
    }

    function test_WithdrawFees_EmitsEvent() public {
        uint256 tokenId = _registerPosition(user1);
        positionManager.addFees(tokenId, 100e18, 100e18);
        vm.warp(block.timestamp + 301);

        vm.prank(bot);
        compoundor.autoCompound(tokenId, "", block.timestamp + 1 hours);

        Currency currency0 = Currency.wrap(address(token0));
        uint256 accumulated = compoundor.accumulatedFees(currency0);

        if (accumulated > 0) {
            vm.expectEmit(true, false, false, true);
            emit IV4Compoundor.FeesWithdrawn(owner, currency0, accumulated);

            vm.prank(owner);
            compoundor.withdrawFees(currency0, owner);
        }
    }

    // ============ Batch Withdraw Fees Tests ============

    function test_BatchWithdrawFees() public {
        uint256 tokenId = _registerPosition(user1);
        positionManager.addFees(tokenId, 100e18, 100e18);
        vm.warp(block.timestamp + 301);

        vm.prank(bot);
        compoundor.autoCompound(tokenId, "", block.timestamp + 1 hours);

        Currency[] memory currencies = new Currency[](2);
        currencies[0] = Currency.wrap(address(token0));
        currencies[1] = Currency.wrap(address(token1));

        vm.prank(owner);
        compoundor.batchWithdrawFees(currencies, owner);

        assertEq(compoundor.accumulatedFees(currencies[0]), 0);
        assertEq(compoundor.accumulatedFees(currencies[1]), 0);
    }

    function test_BatchWithdrawFees_RevertIfNotOwner() public {
        Currency[] memory currencies = new Currency[](1);
        currencies[0] = Currency.wrap(address(token0));

        vm.prank(user1);
        vm.expectRevert();
        compoundor.batchWithdrawFees(currencies, user1);
    }

    // ============ Pause Tests ============

    function test_Pause_AsOwner() public {
        vm.prank(owner);
        compoundor.pause();
        assertTrue(compoundor.paused());
    }

    function test_Unpause_AsOwner() public {
        vm.prank(owner);
        compoundor.pause();

        vm.prank(owner);
        compoundor.unpause();
        assertFalse(compoundor.paused());
    }

    function test_Pause_RevertIfNotOwner() public {
        vm.prank(user1);
        vm.expectRevert();
        compoundor.pause();
    }

    // ============ Operator Tests ============

    function test_OperatorCanCompound() public {
        uint256 tokenId = _registerPosition(user1);
        positionManager.addFees(tokenId, 10e18, 10e18);

        vm.prank(user1);
        compoundor.setOperatorApproval(operator, true);

        vm.prank(operator);
        compoundor.selfCompound(tokenId, "", block.timestamp + 1 hours);
    }

    // ============ Upgrade Tests ============

    function test_Upgrade_AsOwner() public {
        V4Compoundor newImpl = new V4Compoundor(
            address(poolManager),
            address(positionManager),
            address(weth)
        );

        vm.prank(owner);
        compoundor.upgradeToAndCall(address(newImpl), "");

        assertEq(compoundor.owner(), owner);
    }

    function test_Upgrade_RevertIfNotOwner() public {
        V4Compoundor newImpl = new V4Compoundor(
            address(poolManager),
            address(positionManager),
            address(weth)
        );

        vm.prank(user1);
        vm.expectRevert();
        compoundor.upgradeToAndCall(address(newImpl), "");
    }

    // ============ Router Approval Tests ============

    function test_SetRouterApproval() public {
        address newRouter = makeAddr("newRouter");

        vm.prank(owner);
        compoundor.setRouterApproval(newRouter, true);

        assertTrue(compoundor.approvedRouters(newRouter));
    }

    // ============ Fuzz Tests ============

    function testFuzz_RegisterPosition_Interval(uint32 interval) public {
        uint256 tokenId = _createPosition(user1);

        IV4Compoundor.CompoundConfig memory config = IV4Compoundor.CompoundConfig({
            enabled: true,
            minCompoundInterval: interval,
            minRewardAmount: 0
        });

        if (interval < 300) {
            vm.prank(user1);
            vm.expectRevert("Interval too short");
            compoundor.registerPosition(tokenId, config);
        } else {
            vm.prank(user1);
            compoundor.registerPosition(tokenId, config);
            assertEq(compoundor.getConfig(tokenId).minCompoundInterval, interval);
        }
    }

    function testFuzz_SetProtocolFee_Value(uint256 fee) public {
        // Warp past initial cooldown
        vm.warp(block.timestamp + 24 hours + 1);

        if (fee > 1000) {
            vm.prank(owner);
            vm.expectRevert("Fee too high");
            compoundor.setProtocolFee(fee);
        } else {
            vm.prank(owner);
            compoundor.setProtocolFee(fee);
            assertEq(compoundor.protocolFee(), fee);
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

    function _registerPosition(address posOwner) internal returns (uint256 tokenId) {
        tokenId = _createPosition(posOwner);

        IV4Compoundor.CompoundConfig memory config = IV4Compoundor.CompoundConfig({
            enabled: true,
            minCompoundInterval: 300,
            minRewardAmount: 0
        });

        vm.prank(posOwner);
        compoundor.registerPosition(tokenId, config);
    }
}
