// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import { Test, console2 } from "forge-std/Test.sol";
import { BaseTest } from "./BaseTest.sol";
import { Currency, CurrencyLibrary } from "@uniswap/v4-core/src/types/Currency.sol";
import { PoolKey } from "@uniswap/v4-core/src/types/PoolKey.sol";

import { V4Utils } from "../src/utils/V4Utils.sol";
import { IV4Utils } from "../src/interfaces/IV4Utils.sol";
import { ERC1967Proxy } from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";

/// @title V4UtilsTest
/// @notice Comprehensive tests for V4Utils contract
contract V4UtilsTest is BaseTest {
    using CurrencyLibrary for Currency;

    V4Utils public v4Utils;
    V4Utils public v4UtilsImpl;

    function setUp() public override {
        super.setUp();

        // Deploy V4Utils implementation
        v4UtilsImpl = new V4Utils(
            address(poolManager),
            address(positionManager),
            address(weth)
        );

        // Deploy proxy
        bytes memory initData = abi.encodeWithSelector(V4Utils.initialize.selector, owner);
        address proxy = deployProxy(address(v4UtilsImpl), initData);
        v4Utils = V4Utils(payable(proxy));

        // Setup router approval
        vm.prank(owner);
        v4Utils.setRouterApproval(address(router), true);

        // Approve tokens for v4Utils
        approveTokens(user1, address(v4Utils), type(uint256).max);
        approveTokens(user2, address(v4Utils), type(uint256).max);

        labelAddresses();
        vm.label(address(v4Utils), "V4Utils");
    }

    // ============ Initialization Tests ============

    function test_Initialize_SetsOwner() public view {
        assertEq(v4Utils.owner(), owner);
    }

    function test_Initialize_SetsPoolManager() public view {
        assertEq(address(v4Utils.poolManager()), address(poolManager));
    }

    function test_Initialize_SetsPositionManager() public view {
        assertEq(address(v4Utils.positionManager()), address(positionManager));
    }

    function test_Initialize_SetsWETH9() public view {
        assertEq(v4Utils.WETH9(), address(weth));
    }

    function test_Initialize_CannotReinitialize() public {
        vm.expectRevert();
        v4Utils.initialize(user1);
    }

    function test_ProtocolFeeDefault() public view {
        assertEq(v4Utils.protocolFee(), 65);
    }

    // ============ Router Approval Tests ============

    function test_SetRouterApproval_AsOwner() public {
        address newRouter = makeAddr("newRouter");

        vm.prank(owner);
        v4Utils.setRouterApproval(newRouter, true);

        assertTrue(v4Utils.approvedRouters(newRouter));
    }

    function test_SetRouterApproval_RevokeApproval() public {
        vm.prank(owner);
        v4Utils.setRouterApproval(address(router), false);

        assertFalse(v4Utils.approvedRouters(address(router)));
    }

    function test_SetRouterApproval_RevertIfNotOwner() public {
        vm.prank(user1);
        vm.expectRevert();
        v4Utils.setRouterApproval(address(router), true);
    }

    // ============ SwapAndMint Tests ============

    function test_SwapAndMint_BasicMint() public {
        uint256 amount0 = 100e18;
        uint256 amount1 = 100e18;

        IV4Utils.SwapAndMintParams memory params = IV4Utils.SwapAndMintParams({
            poolKey: poolKey,
            tickLower: TICK_LOWER,
            tickUpper: TICK_UPPER,
            amount0Desired: amount0,
            amount1Desired: amount1,
            amount0Max: 0,
            amount1Max: 0,
            swapSourceCurrency: Currency.wrap(address(0)),
            swapSourceAmount: 0,
            swapData: "",
            maxSwapSlippage: 0,
            recipient: user1,
            deadline: block.timestamp + 1 hours
        });

        uint256 balance0Before = token0.balanceOf(user1);
        uint256 balance1Before = token1.balanceOf(user1);

        vm.prank(user1);
        (uint256 tokenId, uint128 liquidity, uint256 used0, uint256 used1) = v4Utils.swapAndMint(params);

        assertGt(tokenId, 0, "Token ID should be > 0");
        assertGt(liquidity, 0, "Liquidity should be > 0");
        assertEq(positionManager.ownerOf(tokenId), user1, "User should own position");
    }

    function test_SwapAndMint_WithSwap() public {
        uint256 swapAmount = 50e18;

        IV4Utils.SwapAndMintParams memory params = IV4Utils.SwapAndMintParams({
            poolKey: poolKey,
            tickLower: TICK_LOWER,
            tickUpper: TICK_UPPER,
            amount0Desired: 0,
            amount1Desired: 0,
            amount0Max: 0,
            amount1Max: 0,
            swapSourceCurrency: Currency.wrap(address(token0)),
            swapSourceAmount: swapAmount,
            swapData: getRouterCallData(address(token0), address(token1), swapAmount / 2, 0),
            maxSwapSlippage: 500, // 5%
            recipient: user1,
            deadline: block.timestamp + 1 hours
        });

        vm.prank(user1);
        (uint256 tokenId, uint128 liquidity,,) = v4Utils.swapAndMint(params);

        assertGt(tokenId, 0, "Token ID should be > 0");
        assertGt(liquidity, 0, "Liquidity should be > 0");
    }

    function test_SwapAndMint_RevertIfDeadlinePassed() public {
        IV4Utils.SwapAndMintParams memory params = IV4Utils.SwapAndMintParams({
            poolKey: poolKey,
            tickLower: TICK_LOWER,
            tickUpper: TICK_UPPER,
            amount0Desired: 100e18,
            amount1Desired: 100e18,
            amount0Max: 0,
            amount1Max: 0,
            swapSourceCurrency: Currency.wrap(address(0)),
            swapSourceAmount: 0,
            swapData: "",
            maxSwapSlippage: 0,
            recipient: user1,
            deadline: block.timestamp - 1 // Already passed
        });

        vm.prank(user1);
        vm.expectRevert();
        v4Utils.swapAndMint(params);
    }

    function test_SwapAndMint_RevertIfPaused() public {
        vm.prank(owner);
        v4Utils.pause();

        IV4Utils.SwapAndMintParams memory params = IV4Utils.SwapAndMintParams({
            poolKey: poolKey,
            tickLower: TICK_LOWER,
            tickUpper: TICK_UPPER,
            amount0Desired: 100e18,
            amount1Desired: 100e18,
            amount0Max: 0,
            amount1Max: 0,
            swapSourceCurrency: Currency.wrap(address(0)),
            swapSourceAmount: 0,
            swapData: "",
            maxSwapSlippage: 0,
            recipient: user1,
            deadline: block.timestamp + 1 hours
        });

        vm.prank(user1);
        vm.expectRevert();
        v4Utils.swapAndMint(params);
    }

    function test_SwapAndMint_RevertIfRouterNotApproved() public {
        address unapprovedRouter = makeAddr("unapproved");

        IV4Utils.SwapAndMintParams memory params = IV4Utils.SwapAndMintParams({
            poolKey: poolKey,
            tickLower: TICK_LOWER,
            tickUpper: TICK_UPPER,
            amount0Desired: 0,
            amount1Desired: 0,
            amount0Max: 0,
            amount1Max: 0,
            swapSourceCurrency: Currency.wrap(address(token0)),
            swapSourceAmount: 50e18,
            swapData: abi.encode(unapprovedRouter, ""),
            maxSwapSlippage: 500,
            recipient: user1,
            deadline: block.timestamp + 1 hours
        });

        vm.prank(user1);
        vm.expectRevert();
        v4Utils.swapAndMint(params);
    }

    // ============ SwapAndIncreaseLiquidity Tests ============

    function test_SwapAndIncreaseLiquidity_Basic() public {
        // First create a position
        uint256 tokenId = _createPosition(user1, 100e18, 100e18);

        IV4Utils.SwapAndIncreaseParams memory params = IV4Utils.SwapAndIncreaseParams({
            tokenId: tokenId,
            amount0Desired: 50e18,
            amount1Desired: 50e18,
            amount0Max: 0,
            amount1Max: 0,
            swapSourceCurrency: Currency.wrap(address(0)),
            swapSourceAmount: 0,
            swapData: "",
            maxSwapSlippage: 0,
            deadline: block.timestamp + 1 hours
        });

        uint128 liquidityBefore = positionManager.getPositionLiquidity(tokenId);

        vm.prank(user1);
        (uint128 addedLiquidity,,) = v4Utils.swapAndIncreaseLiquidity(params);

        assertGt(addedLiquidity, 0, "Should add liquidity");
    }

    function test_SwapAndIncreaseLiquidity_RevertIfNotOwner() public {
        uint256 tokenId = _createPosition(user1, 100e18, 100e18);

        IV4Utils.SwapAndIncreaseParams memory params = IV4Utils.SwapAndIncreaseParams({
            tokenId: tokenId,
            amount0Desired: 50e18,
            amount1Desired: 50e18,
            amount0Max: 0,
            amount1Max: 0,
            swapSourceCurrency: Currency.wrap(address(0)),
            swapSourceAmount: 0,
            swapData: "",
            maxSwapSlippage: 0,
            deadline: block.timestamp + 1 hours
        });

        // user2 tries to increase user1's position
        vm.prank(user2);
        vm.expectRevert();
        v4Utils.swapAndIncreaseLiquidity(params);
    }

    function test_SwapAndIncreaseLiquidity_WithApproval() public {
        uint256 tokenId = _createPosition(user1, 100e18, 100e18);

        // Approve user2 to manage position
        vm.prank(user1);
        positionManager.approve(address(v4Utils), tokenId);

        // Also approve V4Utils for user2's tokens
        approveTokens(user2, address(v4Utils), type(uint256).max);

        IV4Utils.SwapAndIncreaseParams memory params = IV4Utils.SwapAndIncreaseParams({
            tokenId: tokenId,
            amount0Desired: 50e18,
            amount1Desired: 50e18,
            amount0Max: 0,
            amount1Max: 0,
            swapSourceCurrency: Currency.wrap(address(0)),
            swapSourceAmount: 0,
            swapData: "",
            maxSwapSlippage: 0,
            deadline: block.timestamp + 1 hours
        });

        // This should work with approval
        vm.prank(user1);
        v4Utils.swapAndIncreaseLiquidity(params);
    }

    // ============ DecreaseAndSwap Tests ============

    function test_DecreaseAndSwap_Basic() public {
        uint256 tokenId = _createPosition(user1, 100e18, 100e18);
        uint128 liquidity = positionManager.getPositionLiquidity(tokenId);

        IV4Utils.DecreaseAndSwapParams memory params = IV4Utils.DecreaseAndSwapParams({
            tokenId: tokenId,
            liquidity: liquidity / 2,
            amount0Min: 0,
            amount1Min: 0,
            targetCurrency: Currency.wrap(address(token0)),
            swapData0: "",
            swapData1: getRouterCallData(address(token1), address(token0), 0, 0),
            maxSwapSlippage: 500,
            deadline: block.timestamp + 1 hours
        });

        uint256 balance0Before = token0.balanceOf(user1);

        vm.prank(user1);
        uint256 amount = v4Utils.decreaseAndSwap(params);

        // Should receive some tokens
        assertGe(token0.balanceOf(user1), balance0Before, "Should receive tokens");
    }

    function test_DecreaseAndSwap_FullRemoval() public {
        uint256 tokenId = _createPosition(user1, 100e18, 100e18);
        uint128 liquidity = positionManager.getPositionLiquidity(tokenId);

        IV4Utils.DecreaseAndSwapParams memory params = IV4Utils.DecreaseAndSwapParams({
            tokenId: tokenId,
            liquidity: liquidity, // Full liquidity
            amount0Min: 0,
            amount1Min: 0,
            targetCurrency: Currency.wrap(address(token1)),
            swapData0: getRouterCallData(address(token0), address(token1), 0, 0),
            swapData1: "",
            maxSwapSlippage: 500,
            deadline: block.timestamp + 1 hours
        });

        vm.prank(user1);
        v4Utils.decreaseAndSwap(params);

        // Position should have 0 liquidity
        assertEq(positionManager.getPositionLiquidity(tokenId), 0, "Liquidity should be 0");
    }

    function test_DecreaseAndSwap_RevertIfNotOwner() public {
        uint256 tokenId = _createPosition(user1, 100e18, 100e18);
        uint128 liquidity = positionManager.getPositionLiquidity(tokenId);

        IV4Utils.DecreaseAndSwapParams memory params = IV4Utils.DecreaseAndSwapParams({
            tokenId: tokenId,
            liquidity: liquidity / 2,
            amount0Min: 0,
            amount1Min: 0,
            targetCurrency: Currency.wrap(address(token0)),
            swapData0: "",
            swapData1: "",
            maxSwapSlippage: 0,
            deadline: block.timestamp + 1 hours
        });

        vm.prank(user2);
        vm.expectRevert();
        v4Utils.decreaseAndSwap(params);
    }

    // ============ CollectAndSwap Tests ============

    function test_CollectAndSwap_Basic() public {
        uint256 tokenId = _createPosition(user1, 100e18, 100e18);

        // Add some fees to the position
        positionManager.addFees(tokenId, 1e18, 1e18);

        IV4Utils.CollectAndSwapParams memory params = IV4Utils.CollectAndSwapParams({
            tokenId: tokenId,
            targetCurrency: Currency.wrap(address(token0)),
            swapData0: "",
            swapData1: getRouterCallData(address(token1), address(token0), 0, 0),
            maxSwapSlippage: 500,
            deadline: block.timestamp + 1 hours
        });

        uint256 balance0Before = token0.balanceOf(user1);

        vm.prank(user1);
        uint256 amount = v4Utils.collectAndSwap(params);

        assertGt(amount, 0, "Should collect fees");
    }

    function test_CollectAndSwap_NoSwapNeeded() public {
        uint256 tokenId = _createPosition(user1, 100e18, 100e18);
        positionManager.addFees(tokenId, 1e18, 0);

        IV4Utils.CollectAndSwapParams memory params = IV4Utils.CollectAndSwapParams({
            tokenId: tokenId,
            targetCurrency: Currency.wrap(address(token0)),
            swapData0: "",
            swapData1: "",
            maxSwapSlippage: 0,
            deadline: block.timestamp + 1 hours
        });

        vm.prank(user1);
        uint256 amount = v4Utils.collectAndSwap(params);

        assertGt(amount, 0, "Should collect fees");
    }

    // ============ MoveRange Tests ============

    function test_MoveRange_Basic() public {
        uint256 tokenId = _createPosition(user1, 100e18, 100e18);
        uint128 liquidity = positionManager.getPositionLiquidity(tokenId);

        int24 newTickLower = TICK_LOWER - 60;
        int24 newTickUpper = TICK_UPPER + 60;

        IV4Utils.MoveRangeParams memory params = IV4Utils.MoveRangeParams({
            tokenId: tokenId,
            newTickLower: newTickLower,
            newTickUpper: newTickUpper,
            liquidityToMove: 0, // Move all
            amount0Max: type(uint256).max,
            amount1Max: type(uint256).max,
            swapData: "",
            maxSwapSlippage: 0,
            deadline: block.timestamp + 1 hours
        });

        vm.prank(user1);
        (uint256 newTokenId, uint128 newLiquidity) = v4Utils.moveRange(params);

        assertGt(newTokenId, tokenId, "New token ID should be greater");
        assertGt(newLiquidity, 0, "New position should have liquidity");
        assertEq(positionManager.ownerOf(newTokenId), user1, "User should own new position");
    }

    function test_MoveRange_PartialMove() public {
        uint256 tokenId = _createPosition(user1, 100e18, 100e18);
        uint128 liquidity = positionManager.getPositionLiquidity(tokenId);

        IV4Utils.MoveRangeParams memory params = IV4Utils.MoveRangeParams({
            tokenId: tokenId,
            newTickLower: TICK_LOWER - 120,
            newTickUpper: TICK_UPPER + 120,
            liquidityToMove: liquidity / 2, // Move half
            amount0Max: type(uint256).max,
            amount1Max: type(uint256).max,
            swapData: "",
            maxSwapSlippage: 0,
            deadline: block.timestamp + 1 hours
        });

        vm.prank(user1);
        (uint256 newTokenId, uint128 newLiquidity) = v4Utils.moveRange(params);

        assertGt(newTokenId, 0, "Should create new position");
        // Original position should still have some liquidity
        uint128 remainingLiquidity = positionManager.getPositionLiquidity(tokenId);
        assertGt(remainingLiquidity, 0, "Original should have remaining liquidity");
    }

    function test_MoveRange_RevertIfNotOwner() public {
        uint256 tokenId = _createPosition(user1, 100e18, 100e18);

        IV4Utils.MoveRangeParams memory params = IV4Utils.MoveRangeParams({
            tokenId: tokenId,
            newTickLower: TICK_LOWER - 60,
            newTickUpper: TICK_UPPER + 60,
            liquidityToMove: 0,
            amount0Max: type(uint256).max,
            amount1Max: type(uint256).max,
            swapData: "",
            maxSwapSlippage: 0,
            deadline: block.timestamp + 1 hours
        });

        vm.prank(user2);
        vm.expectRevert();
        v4Utils.moveRange(params);
    }

    // ============ Pause/Unpause Tests ============

    function test_Pause_AsOwner() public {
        vm.prank(owner);
        v4Utils.pause();

        assertTrue(v4Utils.paused());
    }

    function test_Unpause_AsOwner() public {
        vm.prank(owner);
        v4Utils.pause();

        vm.prank(owner);
        v4Utils.unpause();

        assertFalse(v4Utils.paused());
    }

    function test_Pause_RevertIfNotOwner() public {
        vm.prank(user1);
        vm.expectRevert();
        v4Utils.pause();
    }

    // ============ Operator Tests ============

    function test_SetOperatorApproval_Basic() public {
        vm.prank(user1);
        v4Utils.setOperatorApproval(operator, true);

        assertTrue(v4Utils.operatorApprovals(user1, operator));
    }

    function test_SetOperatorApproval_Remove() public {
        vm.prank(user1);
        v4Utils.setOperatorApproval(operator, true);

        vm.prank(user1);
        v4Utils.setOperatorApproval(operator, false);

        assertFalse(v4Utils.operatorApprovals(user1, operator));
    }

    function test_OperatorCanActOnPosition() public {
        uint256 tokenId = _createPosition(user1, 100e18, 100e18);

        // User1 approves operator
        vm.prank(user1);
        v4Utils.setOperatorApproval(operator, true);

        // Operator can now act on user1's positions
        IV4Utils.CollectAndSwapParams memory params = IV4Utils.CollectAndSwapParams({
            tokenId: tokenId,
            targetCurrency: Currency.wrap(address(token0)),
            swapData0: "",
            swapData1: "",
            maxSwapSlippage: 0,
            deadline: block.timestamp + 1 hours
        });

        vm.prank(operator);
        v4Utils.collectAndSwap(params);
    }

    // ============ Multicall Tests ============

    function test_Multicall_MultipleOperations() public {
        // Create a position first
        uint256 tokenId = _createPosition(user1, 100e18, 100e18);
        positionManager.addFees(tokenId, 1e18, 1e18);

        // Prepare multicall data
        bytes[] memory calls = new bytes[](2);

        // First call: collect fees
        calls[0] = abi.encodeWithSelector(
            V4Utils.collectAndSwap.selector,
            IV4Utils.CollectAndSwapParams({
                tokenId: tokenId,
                targetCurrency: Currency.wrap(address(token0)),
                swapData0: "",
                swapData1: "",
                maxSwapSlippage: 0,
                deadline: block.timestamp + 1 hours
            })
        );

        // Second call: collect fees on same position
        calls[1] = abi.encodeCall(
            v4Utils.collectFees,
            IV4Utils.CollectFeesParams({
                tokenId: tokenId,
                deadline: block.timestamp + 1 hours
            })
        );

        vm.prank(user1);
        v4Utils.multicall(calls);
    }

    // ============ Upgrade Tests ============

    function test_Upgrade_AsOwner() public {
        // Deploy new implementation
        V4Utils newImpl = new V4Utils(
            address(poolManager),
            address(positionManager),
            address(weth)
        );

        vm.prank(owner);
        v4Utils.upgradeToAndCall(address(newImpl), "");

        // Verify upgrade (basic functionality still works)
        assertEq(v4Utils.owner(), owner);
    }

    function test_Upgrade_RevertIfNotOwner() public {
        V4Utils newImpl = new V4Utils(
            address(poolManager),
            address(positionManager),
            address(weth)
        );

        vm.prank(user1);
        vm.expectRevert();
        v4Utils.upgradeToAndCall(address(newImpl), "");
    }

    // ============ Edge Cases ============

    function test_SwapAndMint_ZeroAmounts_Reverts() public {
        IV4Utils.SwapAndMintParams memory params = IV4Utils.SwapAndMintParams({
            poolKey: poolKey,
            tickLower: TICK_LOWER,
            tickUpper: TICK_UPPER,
            amount0Desired: 0,
            amount1Desired: 0,
            amount0Max: type(uint256).max,
            amount1Max: type(uint256).max,
            swapSourceCurrency: Currency.wrap(address(0)),
            swapSourceAmount: 0,
            swapData: "",
            maxSwapSlippage: 0,
            recipient: user1,
            deadline: block.timestamp + 1 hours
        });

        vm.prank(user1);
        // Should revert due to zero liquidity
        vm.expectRevert();
        v4Utils.swapAndMint(params);
    }

    function test_SwapAndMint_InvalidTickRange_Reverts() public {
        IV4Utils.SwapAndMintParams memory params = IV4Utils.SwapAndMintParams({
            poolKey: poolKey,
            tickLower: TICK_UPPER, // Invalid: lower > upper
            tickUpper: TICK_LOWER,
            amount0Desired: 100e18,
            amount1Desired: 100e18,
            amount0Max: type(uint256).max,
            amount1Max: type(uint256).max,
            swapSourceCurrency: Currency.wrap(address(0)),
            swapSourceAmount: 0,
            swapData: "",
            maxSwapSlippage: 0,
            recipient: user1,
            deadline: block.timestamp + 1 hours
        });

        vm.prank(user1);
        vm.expectRevert();
        v4Utils.swapAndMint(params);
    }

    // ============ Fuzz Tests ============

    function testFuzz_SwapAndMint_AmountRange(uint256 amount0, uint256 amount1) public {
        // Bound amounts to reasonable ranges
        amount0 = bound(amount0, 1e15, 10_000e18);
        amount1 = bound(amount1, 1e15, 10_000e18);

        // Mint enough tokens
        token0.mint(user1, amount0);
        token1.mint(user1, amount1);

        IV4Utils.SwapAndMintParams memory params = IV4Utils.SwapAndMintParams({
            poolKey: poolKey,
            tickLower: TICK_LOWER,
            tickUpper: TICK_UPPER,
            amount0Desired: amount0,
            amount1Desired: amount1,
            amount0Max: type(uint256).max,
            amount1Max: type(uint256).max,
            swapSourceCurrency: Currency.wrap(address(0)),
            swapSourceAmount: 0,
            swapData: "",
            maxSwapSlippage: 0,
            recipient: user1,
            deadline: block.timestamp + 1 hours
        });

        vm.prank(user1);
        (uint256 tokenId, uint128 liquidity,,) = v4Utils.swapAndMint(params);

        assertGt(tokenId, 0);
        assertGt(liquidity, 0);
    }

    function testFuzz_SwapAndMint_TickRange(int24 tickLower, int24 tickUpper) public {
        // Bound ticks to valid range and ensure proper ordering
        tickLower = int24(bound(tickLower, -887220, 0));
        tickUpper = int24(bound(tickUpper, 1, 887220));

        // Ensure tick spacing alignment
        tickLower = (tickLower / TICK_SPACING) * TICK_SPACING;
        tickUpper = (tickUpper / TICK_SPACING) * TICK_SPACING;

        if (tickLower >= tickUpper) {
            tickUpper = tickLower + TICK_SPACING;
        }

        IV4Utils.SwapAndMintParams memory params = IV4Utils.SwapAndMintParams({
            poolKey: poolKey,
            tickLower: tickLower,
            tickUpper: tickUpper,
            amount0Desired: 100e18,
            amount1Desired: 100e18,
            amount0Max: type(uint256).max,
            amount1Max: type(uint256).max,
            swapSourceCurrency: Currency.wrap(address(0)),
            swapSourceAmount: 0,
            swapData: "",
            maxSwapSlippage: 0,
            recipient: user1,
            deadline: block.timestamp + 1 hours
        });

        vm.prank(user1);
        (uint256 tokenId, uint128 liquidity,,) = v4Utils.swapAndMint(params);

        assertGt(tokenId, 0);
    }

    // ============ Protocol Fee Tests ============

    function test_SetProtocolFee_AsOwner() public {
        vm.prank(owner);
        v4Utils.setProtocolFee(100);

        assertEq(v4Utils.protocolFee(), 100);
    }

    function test_SetProtocolFee_EmitsEvent() public {
        vm.expectEmit(false, false, false, true);
        emit IV4Utils.ProtocolFeeUpdated(65, 100);

        vm.prank(owner);
        v4Utils.setProtocolFee(100);
    }

    function test_SetProtocolFee_RevertIfNotOwner() public {
        vm.prank(user1);
        vm.expectRevert();
        v4Utils.setProtocolFee(100);
    }

    function test_SetProtocolFee_RevertIfTooHigh() public {
        vm.prank(owner);
        vm.expectRevert();
        v4Utils.setProtocolFee(1001);
    }

    function test_SetProtocolFee_RevertIfCooldown() public {
        vm.prank(owner);
        v4Utils.setProtocolFee(100);

        vm.prank(owner);
        vm.expectRevert();
        v4Utils.setProtocolFee(200);
    }

    function test_SetProtocolFee_AfterCooldown() public {
        vm.prank(owner);
        v4Utils.setProtocolFee(100);

        vm.warp(block.timestamp + 24 hours + 1);

        vm.prank(owner);
        v4Utils.setProtocolFee(200);

        assertEq(v4Utils.protocolFee(), 200);
    }

    function test_DefaultProtocolFee() public view {
        assertEq(v4Utils.protocolFee(), 65);
    }

    // ============ WithdrawFees Tests ============

    function test_WithdrawFees_RevertIfNoFees() public {
        Currency currency0 = Currency.wrap(address(token0));

        vm.prank(owner);
        vm.expectRevert();
        v4Utils.withdrawFees(currency0, owner);
    }

    function test_WithdrawFees_RevertIfNotOwner() public {
        Currency currency0 = Currency.wrap(address(token0));

        vm.prank(user1);
        vm.expectRevert();
        v4Utils.withdrawFees(currency0, user1);
    }

    // ============ DecreaseLiquidity Tests ============

    function test_DecreaseLiquidity_Partial() public {
        uint256 tokenId = _createPosition(user1, 100e18, 100e18);
        uint128 liquidity = positionManager.getPositionLiquidity(tokenId);

        IV4Utils.DecreaseLiquidityParams memory params = IV4Utils.DecreaseLiquidityParams({
            tokenId: tokenId,
            liquidity: liquidity / 2,
            amount0Min: 0,
            amount1Min: 0,
            deadline: block.timestamp + 1 hours
        });

        uint256 balance0Before = token0.balanceOf(user1);
        uint256 balance1Before = token1.balanceOf(user1);

        vm.prank(user1);
        (uint256 amount0, uint256 amount1) = v4Utils.decreaseLiquidity(params);

        assertGt(token0.balanceOf(user1), balance0Before, "Should receive token0");
        assertGt(token1.balanceOf(user1), balance1Before, "Should receive token1");
        assertGt(positionManager.getPositionLiquidity(tokenId), 0, "Should have remaining liquidity");
    }

    function test_DecreaseLiquidity_Full() public {
        uint256 tokenId = _createPosition(user1, 100e18, 100e18);

        IV4Utils.DecreaseLiquidityParams memory params = IV4Utils.DecreaseLiquidityParams({
            tokenId: tokenId,
            liquidity: 0, // 0 means all
            amount0Min: 0,
            amount1Min: 0,
            deadline: block.timestamp + 1 hours
        });

        vm.prank(user1);
        v4Utils.decreaseLiquidity(params);

        assertEq(positionManager.getPositionLiquidity(tokenId), 0, "Should have 0 liquidity");
    }

    function test_DecreaseLiquidity_RevertIfNotOwner() public {
        uint256 tokenId = _createPosition(user1, 100e18, 100e18);

        IV4Utils.DecreaseLiquidityParams memory params = IV4Utils.DecreaseLiquidityParams({
            tokenId: tokenId,
            liquidity: 0,
            amount0Min: 0,
            amount1Min: 0,
            deadline: block.timestamp + 1 hours
        });

        vm.prank(user2);
        vm.expectRevert();
        v4Utils.decreaseLiquidity(params);
    }

    function test_DecreaseLiquidity_EmitsEvent() public {
        uint256 tokenId = _createPosition(user1, 100e18, 100e18);
        uint128 liquidity = positionManager.getPositionLiquidity(tokenId);

        IV4Utils.DecreaseLiquidityParams memory params = IV4Utils.DecreaseLiquidityParams({
            tokenId: tokenId,
            liquidity: liquidity / 2,
            amount0Min: 0,
            amount1Min: 0,
            deadline: block.timestamp + 1 hours
        });

        // Should emit LiquidityDecreased event
        vm.prank(user1);
        v4Utils.decreaseLiquidity(params);
    }

    // ============ CollectFees Tests ============

    function test_CollectFees_Basic() public {
        uint256 tokenId = _createPosition(user1, 100e18, 100e18);
        positionManager.addFees(tokenId, 2e18, 2e18);

        IV4Utils.CollectFeesParams memory params = IV4Utils.CollectFeesParams({
            tokenId: tokenId,
            deadline: block.timestamp + 1 hours
        });

        uint256 balance0Before = token0.balanceOf(user1);
        uint256 balance1Before = token1.balanceOf(user1);

        vm.prank(user1);
        (uint256 amount0, uint256 amount1) = v4Utils.collectFees(params);

        assertGt(token0.balanceOf(user1), balance0Before, "Should receive token0 fees");
        assertGt(token1.balanceOf(user1), balance1Before, "Should receive token1 fees");
    }

    function test_CollectFees_RevertIfNotOwner() public {
        uint256 tokenId = _createPosition(user1, 100e18, 100e18);

        IV4Utils.CollectFeesParams memory params = IV4Utils.CollectFeesParams({
            tokenId: tokenId,
            deadline: block.timestamp + 1 hours
        });

        vm.prank(user2);
        vm.expectRevert();
        v4Utils.collectFees(params);
    }

    function test_CollectFees_EmitsEvent() public {
        uint256 tokenId = _createPosition(user1, 100e18, 100e18);
        positionManager.addFees(tokenId, 1e18, 1e18);

        IV4Utils.CollectFeesParams memory params = IV4Utils.CollectFeesParams({
            tokenId: tokenId,
            deadline: block.timestamp + 1 hours
        });

        vm.prank(user1);
        v4Utils.collectFees(params);
    }

    // ============ Slippage Tests ============

    function test_SwapAndMint_RevertIfSlippageTooHigh() public {
        IV4Utils.SwapAndMintParams memory params = IV4Utils.SwapAndMintParams({
            poolKey: poolKey,
            tickLower: TICK_LOWER,
            tickUpper: TICK_UPPER,
            amount0Desired: 100e18,
            amount1Desired: 100e18,
            amount0Max: type(uint256).max,
            amount1Max: type(uint256).max,
            swapSourceCurrency: Currency.wrap(address(0)),
            swapSourceAmount: 0,
            swapData: "",
            maxSwapSlippage: 5001, // Above MAX_SLIPPAGE (5000)
            recipient: user1,
            deadline: block.timestamp + 1 hours
        });

        vm.prank(user1);
        vm.expectRevert();
        v4Utils.swapAndMint(params);
    }

    // ============ Helper Functions ============

    function _createPosition(
        address posOwner,
        uint256 amount0,
        uint256 amount1
    ) internal returns (uint256 tokenId) {
        IV4Utils.SwapAndMintParams memory params = IV4Utils.SwapAndMintParams({
            poolKey: poolKey,
            tickLower: TICK_LOWER,
            tickUpper: TICK_UPPER,
            amount0Desired: amount0,
            amount1Desired: amount1,
            amount0Max: type(uint256).max,
            amount1Max: type(uint256).max,
            swapSourceCurrency: Currency.wrap(address(0)),
            swapSourceAmount: 0,
            swapData: "",
            maxSwapSlippage: 0,
            recipient: posOwner,
            deadline: block.timestamp + 1 hours
        });

        vm.prank(posOwner);
        (tokenId,,,) = v4Utils.swapAndMint(params);
    }
}
