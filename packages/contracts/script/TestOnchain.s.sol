// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import { Script, console } from "forge-std/Script.sol";
import { ERC1967Proxy } from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import { IPoolManager } from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import { PoolKey } from "@uniswap/v4-core/src/types/PoolKey.sol";
import { PoolId, PoolIdLibrary } from "@uniswap/v4-core/src/types/PoolId.sol";
import { Currency, CurrencyLibrary } from "@uniswap/v4-core/src/types/Currency.sol";
import { StateLibrary } from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import { TickMath } from "@uniswap/v4-core/src/libraries/TickMath.sol";
import { IHooks } from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { IERC721 } from "@openzeppelin/contracts/token/ERC721/IERC721.sol";

import { V4Utils } from "../src/utils/V4Utils.sol";
import { V4Compoundor } from "../src/automators/V4Compoundor.sol";
import { V4AutoRange } from "../src/automators/V4AutoRange.sol";
import { V4AutoExit } from "../src/automators/V4AutoExit.sol";
import { IV4Utils } from "../src/interfaces/IV4Utils.sol";
import { IV4Compoundor } from "../src/interfaces/IV4Compoundor.sol";
import { IV4AutoRange } from "../src/interfaces/IV4AutoRange.sol";
import { IV4AutoExit } from "../src/interfaces/IV4AutoExit.sol";

/// @title DeployAndTestAll
/// @notice Deploy all 4 CopyPools contracts and test every function on Base mainnet
/// @dev Run: forge script script/TestOnchain.s.sol:DeployAndTestAll --rpc-url base --broadcast -vvvv
contract DeployAndTestAll is Script {
    using PoolIdLibrary for PoolKey;
    using StateLibrary for IPoolManager;

    // ============ Base Mainnet Constants ============
    address constant POOL_MANAGER = 0x498581fF718922c3f8e6A244956aF099B2652b2b;
    address constant UNIVERSAL_ROUTER = 0x6fF5693b99212Da76ad316178A184AB56D299b43;
    address constant POSITION_MANAGER = 0x7C5f5A4bBd8fD63184577525326123B519429bDc;
    address constant WETH = 0x4200000000000000000000000000000000000006;
    address constant USDC = 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913;

    // ============ Contract Instances ============
    V4Utils v4Utils;
    V4Compoundor compoundor;
    V4AutoRange autoRange;
    V4AutoExit autoExit;

    // ============ Test State ============
    address deployer;
    uint256 testsPassed;
    PoolKey poolKey;
    int24 tickLower;
    int24 tickUpper;

    // Position IDs
    uint256 posId1;
    uint256 posId2;
    uint128 pos1Liq;
    uint128 pos2Liq;

    function run() public {
        uint256 pk = vm.envUint("PRIVATE_KEY");
        deployer = vm.addr(pk);

        console.log("==================================================");
        console.log("  CopyPools V4 - Deploy & Test All Functions");
        console.log("  Chain: Base Mainnet (8453)");
        console.log("==================================================");
        console.log("Deployer:", deployer);
        console.log("ETH Balance:", deployer.balance);
        console.log("USDC Balance:", IERC20(USDC).balanceOf(deployer));

        require(deployer.balance >= 0.005 ether, "Need >= 0.005 ETH");
        require(IERC20(USDC).balanceOf(deployer) >= 1000000, "Need >= 1 USDC");

        vm.startBroadcast(pk);

        // Phase 1: Deploy all contracts
        _deployAll();

        // Phase 2: Setup pool key, wrap ETH, approve tokens
        _setup();

        // Phase 3: Test V4Utils functions
        _testV4Utils();

        // Phase 4: Test V4Compoundor functions
        _testV4Compoundor();

        // Phase 5: Test V4AutoRange functions
        _testV4AutoRange();

        // Phase 6: Test V4AutoExit functions
        _testV4AutoExit();

        // Phase 7: Test Admin functions
        _testAdmin();

        // Phase 8: Cleanup - exit all positions
        _cleanup();

        console.log("\n==================================================");
        console.log("  ALL TESTS PASSED:", testsPassed);
        console.log("==================================================");
        console.log("Final ETH Balance:", deployer.balance);
        console.log("Final USDC Balance:", IERC20(USDC).balanceOf(deployer));

        vm.stopBroadcast();
    }

    // ============================================================
    //  PHASE 1: DEPLOY ALL CONTRACTS
    // ============================================================

    function _deployAll() internal {
        console.log("\n=== PHASE 1: Deploy All Contracts ===");

        // V4Utils
        V4Utils impl1 = new V4Utils(POOL_MANAGER, POSITION_MANAGER, WETH);
        v4Utils = V4Utils(payable(address(new ERC1967Proxy(
            address(impl1),
            abi.encodeWithSelector(V4Utils.initialize.selector, deployer)
        ))));
        console.log("[DEPLOYED] V4Utils:", address(v4Utils));

        // V4Compoundor
        V4Compoundor impl2 = new V4Compoundor(POOL_MANAGER, POSITION_MANAGER, WETH);
        compoundor = V4Compoundor(payable(address(new ERC1967Proxy(
            address(impl2),
            abi.encodeWithSelector(V4Compoundor.initialize.selector, deployer)
        ))));
        console.log("[DEPLOYED] V4Compoundor:", address(compoundor));

        // V4AutoRange
        V4AutoRange impl3 = new V4AutoRange(POOL_MANAGER, POSITION_MANAGER, WETH);
        autoRange = V4AutoRange(payable(address(new ERC1967Proxy(
            address(impl3),
            abi.encodeWithSelector(V4AutoRange.initialize.selector, deployer)
        ))));
        console.log("[DEPLOYED] V4AutoRange:", address(autoRange));

        // V4AutoExit
        V4AutoExit impl4 = new V4AutoExit(POOL_MANAGER, POSITION_MANAGER, WETH);
        autoExit = V4AutoExit(payable(address(new ERC1967Proxy(
            address(impl4),
            abi.encodeWithSelector(V4AutoExit.initialize.selector, deployer)
        ))));
        console.log("[DEPLOYED] V4AutoExit:", address(autoExit));

        // Approve Universal Router on all contracts
        v4Utils.setRouterApproval(UNIVERSAL_ROUTER, true);
        compoundor.setRouterApproval(UNIVERSAL_ROUTER, true);
        autoRange.setRouterApproval(UNIVERSAL_ROUTER, true);
        autoExit.setRouterApproval(UNIVERSAL_ROUTER, true);
        console.log("[CONFIG] Universal Router approved on all contracts");
    }

    // ============================================================
    //  PHASE 2: SETUP
    // ============================================================

    function _setup() internal {
        console.log("\n=== PHASE 2: Setup ===");

        // Pool key: WETH/USDC (WETH < USDC, so WETH is currency0)
        poolKey = PoolKey({
            currency0: Currency.wrap(WETH),
            currency1: Currency.wrap(USDC),
            fee: 500,
            tickSpacing: int24(10),
            hooks: IHooks(address(0))
        });

        // Get current tick from pool
        (uint160 sqrtPriceX96, int24 currentTick,,) = IPoolManager(POOL_MANAGER).getSlot0(poolKey.toId());
        require(sqrtPriceX96 > 0, "Pool not initialized");
        console.log("[OK] Pool found, sqrtPriceX96:", uint256(sqrtPriceX96));

        // Set tick range dynamically (+-3000 ticks around current, aligned to tickSpacing=10)
        tickLower = _floorDiv(currentTick - int24(3000), int24(10)) * int24(10);
        tickUpper = _floorDiv(currentTick + int24(3000), int24(10)) * int24(10);
        if (tickUpper == tickLower) tickUpper += int24(10); // ensure valid range

        // Wrap ETH -> WETH
        uint256 wrapAmount = 0.002 ether;
        (bool ok,) = WETH.call{value: wrapAmount}(abi.encodeWithSignature("deposit()"));
        require(ok, "WETH wrap failed");
        console.log("[OK] Wrapped", wrapAmount, "wei to WETH");

        // Approve tokens for V4Utils
        IERC20(WETH).approve(address(v4Utils), type(uint256).max);
        IERC20(USDC).approve(address(v4Utils), type(uint256).max);

        // Approve NFTs for all contracts (setApprovalForAll is more efficient than per-token)
        IERC721(POSITION_MANAGER).setApprovalForAll(address(v4Utils), true);
        IERC721(POSITION_MANAGER).setApprovalForAll(address(compoundor), true);
        IERC721(POSITION_MANAGER).setApprovalForAll(address(autoRange), true);
        IERC721(POSITION_MANAGER).setApprovalForAll(address(autoExit), true);
        console.log("[OK] All token & NFT approvals set");
    }

    // ============================================================
    //  PHASE 3: V4UTILS FUNCTIONS
    // ============================================================

    function _testV4Utils() internal {
        console.log("\n=== PHASE 3: V4Utils Functions ===");

        // Test 1: swapAndMint
        {
            console.log("\n  [1] swapAndMint");
            (uint256 tokenId, uint128 liquidity, uint256 a0, uint256 a1) = v4Utils.swapAndMint(
                IV4Utils.SwapAndMintParams({
                    poolKey: poolKey,
                    tickLower: tickLower,
                    tickUpper: tickUpper,
                    amount0Desired: 0.0002 ether,
                    amount1Desired: 500000,
                    amount0Max: 0.0005 ether,
                    amount1Max: 1000000,
                    recipient: deployer,
                    deadline: block.timestamp + 1 hours,
                    swapSourceCurrency: Currency.wrap(address(0)),
                    swapSourceAmount: 0,
                    swapData: "",
                    maxSwapSlippage: 0
                })
            );
            posId1 = tokenId;
            pos1Liq = liquidity;
            console.log("      TokenId:", tokenId);
            console.log("      Liquidity:", uint256(liquidity));
            console.log("      WETH used:", a0);
            console.log("      USDC used:", a1);
            testsPassed++;
        }

        // Test 2: swapAndIncreaseLiquidity
        {
            console.log("\n  [2] swapAndIncreaseLiquidity");
            (uint128 addedLiq, uint256 a0, uint256 a1) = v4Utils.swapAndIncreaseLiquidity(
                IV4Utils.SwapAndIncreaseParams({
                    tokenId: posId1,
                    amount0Desired: 0.0001 ether,
                    amount1Desired: 200000,
                    amount0Max: 0.0003 ether,
                    amount1Max: 500000,
                    deadline: block.timestamp + 1 hours,
                    swapSourceCurrency: Currency.wrap(address(0)),
                    swapSourceAmount: 0,
                    swapData: "",
                    maxSwapSlippage: 0
                })
            );
            pos1Liq += addedLiq;
            console.log("      Added liquidity:", uint256(addedLiq));
            console.log("      WETH used:", a0);
            console.log("      USDC used:", a1);
            testsPassed++;
        }

        // Test 3: collectFees
        {
            console.log("\n  [3] collectFees");
            (uint256 f0, uint256 f1) = v4Utils.collectFees(
                IV4Utils.CollectFeesParams({
                    tokenId: posId1,
                    deadline: block.timestamp + 1 hours
                })
            );
            console.log("      WETH fees:", f0);
            console.log("      USDC fees:", f1);
            testsPassed++;
        }

        // Test 4: decreaseLiquidity (partial - 30%)
        {
            console.log("\n  [4] decreaseLiquidity (partial 30%)");
            uint128 removeAmt = pos1Liq * 30 / 100;
            (uint256 a0, uint256 a1) = v4Utils.decreaseLiquidity(
                IV4Utils.DecreaseLiquidityParams({
                    tokenId: posId1,
                    liquidity: removeAmt,
                    amount0Min: 0,
                    amount1Min: 0,
                    deadline: block.timestamp + 1 hours
                })
            );
            pos1Liq -= removeAmt;
            console.log("      Removed:", uint256(removeAmt));
            console.log("      WETH received:", a0);
            console.log("      USDC received:", a1);
            testsPassed++;
        }

        // Test 5: Create position 2 (for automator tests)
        {
            console.log("\n  [5] swapAndMint (position 2)");
            (uint256 tokenId, uint128 liquidity,,) = v4Utils.swapAndMint(
                IV4Utils.SwapAndMintParams({
                    poolKey: poolKey,
                    tickLower: tickLower,
                    tickUpper: tickUpper,
                    amount0Desired: 0.0002 ether,
                    amount1Desired: 300000,
                    amount0Max: 0.0005 ether,
                    amount1Max: 600000,
                    recipient: deployer,
                    deadline: block.timestamp + 1 hours,
                    swapSourceCurrency: Currency.wrap(address(0)),
                    swapSourceAmount: 0,
                    swapData: "",
                    maxSwapSlippage: 0
                })
            );
            posId2 = tokenId;
            pos2Liq = liquidity;
            console.log("      TokenId:", tokenId);
            console.log("      Liquidity:", uint256(liquidity));
            testsPassed++;
        }

        // Test 6: moveRange
        {
            console.log("\n  [6] moveRange");
            int24 newLower = tickLower - int24(100);
            int24 newUpper = tickUpper + int24(100);
            (uint256 newTokenId, uint128 newLiq) = v4Utils.moveRange(
                IV4Utils.MoveRangeParams({
                    tokenId: posId1,
                    newTickLower: newLower,
                    newTickUpper: newUpper,
                    liquidityToMove: 0,
                    amount0Max: type(uint256).max,
                    amount1Max: type(uint256).max,
                    deadline: block.timestamp + 1 hours,
                    swapData: "",
                    maxSwapSlippage: 500
                })
            );
            console.log("      Old TokenId:", posId1);
            console.log("      New TokenId:", newTokenId);
            console.log("      New Liquidity:", uint256(newLiq));
            posId1 = newTokenId;
            pos1Liq = newLiq;
            testsPassed++;
        }

        // Test 7: protocolFee view
        {
            console.log("\n  [7] protocolFee()");
            uint256 fee = v4Utils.protocolFee();
            console.log("      Protocol fee:", fee, "bps");
            require(fee == 65, "Expected 65 bps");
            testsPassed++;
        }

        // Test 8: accumulatedFees view
        {
            console.log("\n  [8] accumulatedFees()");
            uint256 accW = v4Utils.accumulatedFees(Currency.wrap(WETH));
            uint256 accU = v4Utils.accumulatedFees(Currency.wrap(USDC));
            console.log("      WETH fees:", accW);
            console.log("      USDC fees:", accU);
            testsPassed++;
        }

        console.log("\n  [SKIP] decreaseAndSwap, collectAndSwap, exitToStablecoin");
        console.log("         (require external swap router data - tested in 252 unit tests)");
    }

    // ============================================================
    //  PHASE 4: V4COMPOUNDOR FUNCTIONS
    // ============================================================

    function _testV4Compoundor() internal {
        console.log("\n=== PHASE 4: V4Compoundor Functions ===");

        // Test 9: registerPosition
        {
            console.log("\n  [9] registerPosition");
            compoundor.registerPosition(posId2, IV4Compoundor.CompoundConfig({
                enabled: true,
                minCompoundInterval: 300,
                minRewardAmount: 0
            }));
            console.log("      Position", posId2, "registered");
            testsPassed++;
        }

        // Test 10: getConfig view
        {
            console.log("\n  [10] getConfig()");
            IV4Compoundor.CompoundConfig memory cfg = compoundor.getConfig(posId2);
            console.log("      enabled:", cfg.enabled);
            console.log("      minCompoundInterval:", cfg.minCompoundInterval);
            console.log("      minRewardAmount:", cfg.minRewardAmount);
            require(cfg.enabled, "Expected enabled");
            testsPassed++;
        }

        // Test 11: getLastCompoundTime view
        {
            console.log("\n  [11] getLastCompoundTime()");
            uint256 lastTime = compoundor.getLastCompoundTime(posId2);
            console.log("      Last compound time:", lastTime);
            testsPassed++;
        }

        // Test 12: isCompoundProfitable view
        {
            console.log("\n  [12] isCompoundProfitable()");
            (bool profitable, uint256 reward) = compoundor.isCompoundProfitable(posId2);
            console.log("      Profitable:", profitable);
            console.log("      Estimated reward:", reward);
            testsPassed++;
        }

        // Test 13: getPendingFees view
        {
            console.log("\n  [13] getPendingFees()");
            (uint256 pf0, uint256 pf1) = compoundor.getPendingFees(posId2);
            console.log("      Pending WETH fees:", pf0);
            console.log("      Pending USDC fees:", pf1);
            testsPassed++;
        }

        // Test 14: updateConfig
        {
            console.log("\n  [14] updateConfig");
            compoundor.updateConfig(posId2, IV4Compoundor.CompoundConfig({
                enabled: true,
                minCompoundInterval: 600,
                minRewardAmount: 1000
            }));
            IV4Compoundor.CompoundConfig memory cfg = compoundor.getConfig(posId2);
            console.log("      Updated interval:", cfg.minCompoundInterval);
            console.log("      Updated minReward:", cfg.minRewardAmount);
            require(cfg.minCompoundInterval == 600, "Expected 600");
            testsPassed++;
        }

        // Test 15: unregisterPosition
        {
            console.log("\n  [15] unregisterPosition");
            compoundor.unregisterPosition(posId2);
            IV4Compoundor.CompoundConfig memory cfg = compoundor.getConfig(posId2);
            console.log("      Enabled after unregister:", cfg.enabled);
            require(!cfg.enabled, "Expected disabled");
            testsPassed++;
        }

        // Test 16: protocolFee view
        {
            console.log("\n  [16] protocolFee()");
            uint256 fee = compoundor.protocolFee();
            console.log("      Protocol fee:", fee, "bps");
            require(fee == 65, "Expected 65 bps");
            testsPassed++;
        }

        console.log("\n  [SKIP] autoCompound, selfCompound");
        console.log("         (require accumulated position fees - tested in 252 unit tests)");
    }

    // ============================================================
    //  PHASE 5: V4AUTORANGE FUNCTIONS
    // ============================================================

    function _testV4AutoRange() internal {
        console.log("\n=== PHASE 5: V4AutoRange Functions ===");

        // Test 17: configureRange
        {
            console.log("\n  [17] configureRange");
            autoRange.configureRange(posId2, IV4AutoRange.RangeConfig({
                enabled: true,
                lowerDelta: int24(3000),
                upperDelta: int24(3000),
                rebalanceThreshold: 8000,
                minRebalanceInterval: 3600,
                collectFeesOnRebalance: true,
                maxSwapSlippage: 500
            }));
            console.log("      Position", posId2, "configured");
            testsPassed++;
        }

        // Test 18: getRangeConfig view
        {
            console.log("\n  [18] getRangeConfig()");
            IV4AutoRange.RangeConfig memory cfg = autoRange.getRangeConfig(posId2);
            console.log("      enabled:", cfg.enabled);
            console.log("      rebalanceThreshold:", cfg.rebalanceThreshold);
            console.log("      minRebalanceInterval:", cfg.minRebalanceInterval);
            console.log("      maxSwapSlippage:", cfg.maxSwapSlippage);
            require(cfg.enabled, "Expected enabled");
            testsPassed++;
        }

        // Test 19: getLastRebalanceTime view
        {
            console.log("\n  [19] getLastRebalanceTime()");
            uint256 lastTime = autoRange.getLastRebalanceTime(posId2);
            console.log("      Last rebalance time:", lastTime);
            testsPassed++;
        }

        // Test 20: checkRebalance view
        {
            console.log("\n  [20] checkRebalance()");
            (bool needsRebalance, uint8 reason) = autoRange.checkRebalance(posId2);
            console.log("      Needs rebalance:", needsRebalance);
            console.log("      Reason:", reason);
            testsPassed++;
        }

        // Test 21: batchCheckRebalance view
        {
            console.log("\n  [21] batchCheckRebalance()");
            uint256[] memory ids = new uint256[](2);
            ids[0] = posId1;
            ids[1] = posId2;
            bool[] memory results = autoRange.batchCheckRebalance(ids);
            console.log("      Position 1 needs rebalance:", results[0]);
            console.log("      Position 2 needs rebalance:", results[1]);
            testsPassed++;
        }

        // Test 22: calculateOptimalRange view
        {
            console.log("\n  [22] calculateOptimalRange()");
            (int24 optLower, int24 optUpper) = autoRange.calculateOptimalRange(posId2);
            console.log("      Optimal lower (abs):", _absInt24(optLower));
            console.log("      Optimal upper (abs):", _absInt24(optUpper));
            testsPassed++;
        }

        // Test 23: getPositionStatus view
        {
            console.log("\n  [23] getPositionStatus()");
            (bool inRange, int24 curTick, int24 posLower, int24 posUpper) = autoRange.getPositionStatus(posId2);
            console.log("      In range:", inRange);
            console.log("      Current tick (abs):", _absInt24(curTick));
            console.log("      Pos lower (abs):", _absInt24(posLower));
            console.log("      Pos upper (abs):", _absInt24(posUpper));
            testsPassed++;
        }

        // Test 24: updateRangeConfig
        {
            console.log("\n  [24] updateRangeConfig");
            autoRange.updateRangeConfig(posId2, IV4AutoRange.RangeConfig({
                enabled: true,
                lowerDelta: int24(6000),
                upperDelta: int24(6000),
                rebalanceThreshold: 9000,
                minRebalanceInterval: 7200,
                collectFeesOnRebalance: true,
                maxSwapSlippage: 300
            }));
            IV4AutoRange.RangeConfig memory cfg = autoRange.getRangeConfig(posId2);
            console.log("      Updated rebalanceThreshold:", cfg.rebalanceThreshold);
            console.log("      Updated minRebalanceInterval:", cfg.minRebalanceInterval);
            require(cfg.rebalanceThreshold == 9000, "Expected 9000");
            testsPassed++;
        }

        // Test 25: removeRange
        {
            console.log("\n  [25] removeRange");
            autoRange.removeRange(posId2);
            IV4AutoRange.RangeConfig memory cfg = autoRange.getRangeConfig(posId2);
            console.log("      Enabled after remove:", cfg.enabled);
            require(!cfg.enabled, "Expected disabled");
            testsPassed++;
        }

        // Test 26: protocolFee view
        {
            console.log("\n  [26] protocolFee()");
            uint256 fee = autoRange.protocolFee();
            console.log("      Protocol fee:", fee, "bps");
            require(fee == 65, "Expected 65 bps");
            testsPassed++;
        }

        // Test 27: accumulatedFees view
        {
            console.log("\n  [27] accumulatedFees()");
            uint256 accW = autoRange.accumulatedFees(Currency.wrap(WETH));
            console.log("      WETH fees:", accW);
            testsPassed++;
        }

        console.log("\n  [SKIP] executeRebalance");
        console.log("         (requires position out of range - tested in 252 unit tests)");
    }

    // ============================================================
    //  PHASE 6: V4AUTOEXIT FUNCTIONS
    // ============================================================

    function _testV4AutoExit() internal {
        console.log("\n=== PHASE 6: V4AutoExit Functions ===");

        // Test 28: configureExit (stop-loss far below + take-profit far above)
        {
            console.log("\n  [28] configureExit");
            autoExit.configureExit(posId2, IV4AutoExit.ExitConfig({
                enabled: true,
                triggerTickLower: TickMath.MIN_TICK + 1,  // stop-loss (effectively disabled)
                triggerTickUpper: TickMath.MAX_TICK - 1,  // take-profit (effectively disabled)
                exitOnRangeExit: true,                    // exit when out of range
                exitToken: Currency.wrap(address(0)),     // keep both tokens
                maxSwapSlippage: 500,
                minExitInterval: 300
            }));
            console.log("      Position", posId2, "configured for auto-exit");
            testsPassed++;
        }

        // Test 29: getExitConfig view
        {
            console.log("\n  [29] getExitConfig()");
            IV4AutoExit.ExitConfig memory cfg = autoExit.getExitConfig(posId2);
            console.log("      enabled:", cfg.enabled);
            console.log("      exitOnRangeExit:", cfg.exitOnRangeExit);
            console.log("      maxSwapSlippage:", cfg.maxSwapSlippage);
            console.log("      minExitInterval:", cfg.minExitInterval);
            require(cfg.enabled, "Expected enabled");
            testsPassed++;
        }

        // Test 30: getConfigTimestamp view
        {
            console.log("\n  [30] getConfigTimestamp()");
            uint256 ts = autoExit.getConfigTimestamp(posId2);
            console.log("      Config timestamp:", ts);
            require(ts > 0, "Expected nonzero timestamp");
            testsPassed++;
        }

        // Test 31: checkExit view
        {
            console.log("\n  [31] checkExit()");
            (bool needsExit, uint8 reason) = autoExit.checkExit(posId2);
            console.log("      Needs exit:", needsExit);
            console.log("      Reason:", reason);
            // Position is in range with disabled tick triggers, so should be false
            testsPassed++;
        }

        // Test 32: batchCheckExit view
        {
            console.log("\n  [32] batchCheckExit()");
            uint256[] memory ids = new uint256[](2);
            ids[0] = posId1;
            ids[1] = posId2;
            bool[] memory results = autoExit.batchCheckExit(ids);
            console.log("      Position 1 needs exit:", results[0]);
            console.log("      Position 2 needs exit:", results[1]);
            testsPassed++;
        }

        // Test 33: updateExitConfig
        {
            console.log("\n  [33] updateExitConfig");
            autoExit.updateExitConfig(posId2, IV4AutoExit.ExitConfig({
                enabled: true,
                triggerTickLower: TickMath.MIN_TICK + 1,
                triggerTickUpper: TickMath.MAX_TICK - 1,
                exitOnRangeExit: false,                   // changed
                exitToken: Currency.wrap(USDC),           // exit to USDC
                maxSwapSlippage: 300,                     // updated
                minExitInterval: 600                      // updated
            }));
            IV4AutoExit.ExitConfig memory cfg = autoExit.getExitConfig(posId2);
            console.log("      exitOnRangeExit:", cfg.exitOnRangeExit);
            console.log("      maxSwapSlippage:", cfg.maxSwapSlippage);
            console.log("      minExitInterval:", cfg.minExitInterval);
            require(!cfg.exitOnRangeExit, "Expected false");
            require(cfg.minExitInterval == 600, "Expected 600");
            testsPassed++;
        }

        // Test 34: removeExit
        {
            console.log("\n  [34] removeExit");
            autoExit.removeExit(posId2);
            IV4AutoExit.ExitConfig memory cfg = autoExit.getExitConfig(posId2);
            console.log("      Enabled after remove:", cfg.enabled);
            require(!cfg.enabled, "Expected disabled");
            testsPassed++;
        }

        // Test 35: protocolFee view
        {
            console.log("\n  [35] protocolFee()");
            uint256 fee = autoExit.protocolFee();
            console.log("      Protocol fee:", fee, "bps");
            require(fee == 65, "Expected 65 bps");
            testsPassed++;
        }

        // Test 36: accumulatedFees view
        {
            console.log("\n  [36] accumulatedFees()");
            uint256 accW = autoExit.accumulatedFees(Currency.wrap(WETH));
            uint256 accU = autoExit.accumulatedFees(Currency.wrap(USDC));
            console.log("      WETH fees:", accW);
            console.log("      USDC fees:", accU);
            testsPassed++;
        }

        console.log("\n  [SKIP] executeExit, selfExit");
        console.log("         (require exit conditions met - tested in 252 unit tests)");
    }

    // ============================================================
    //  PHASE 7: ADMIN FUNCTIONS
    // ============================================================

    function _testAdmin() internal {
        console.log("\n=== PHASE 7: Admin Functions ===");

        // Test 37: setProtocolFee on V4Utils
        {
            console.log("\n  [37] V4Utils.setProtocolFee(100)");
            v4Utils.setProtocolFee(100);
            uint256 fee = v4Utils.protocolFee();
            console.log("      New fee:", fee, "bps");
            require(fee == 100, "Expected 100");
            testsPassed++;
        }

        // Test 38: setProtocolFee on V4Compoundor
        {
            console.log("\n  [38] V4Compoundor.setProtocolFee(100)");
            compoundor.setProtocolFee(100);
            uint256 fee = compoundor.protocolFee();
            console.log("      New fee:", fee, "bps");
            require(fee == 100, "Expected 100");
            testsPassed++;
        }

        // Test 39: setProtocolFee on V4AutoRange
        {
            console.log("\n  [39] V4AutoRange.setProtocolFee(100)");
            autoRange.setProtocolFee(100);
            uint256 fee = autoRange.protocolFee();
            console.log("      New fee:", fee, "bps");
            require(fee == 100, "Expected 100");
            testsPassed++;
        }

        // Test 40: setProtocolFee on V4AutoExit
        {
            console.log("\n  [40] V4AutoExit.setProtocolFee(100)");
            autoExit.setProtocolFee(100);
            uint256 fee = autoExit.protocolFee();
            console.log("      New fee:", fee, "bps");
            require(fee == 100, "Expected 100");
            testsPassed++;
        }

        // Test 41: V4Utils pause + unpause
        {
            console.log("\n  [41] V4Utils pause/unpause");
            v4Utils.pause();
            console.log("      Paused: true");
            v4Utils.unpause();
            console.log("      Unpaused: true");
            testsPassed++;
        }

        // Test 42: V4Compoundor pause + unpause
        {
            console.log("\n  [42] V4Compoundor pause/unpause");
            compoundor.pause();
            console.log("      Paused: true");
            compoundor.unpause();
            console.log("      Unpaused: true");
            testsPassed++;
        }

        // Test 43: V4AutoRange pause + unpause
        {
            console.log("\n  [43] V4AutoRange pause/unpause");
            autoRange.pause();
            console.log("      Paused: true");
            autoRange.unpause();
            console.log("      Unpaused: true");
            testsPassed++;
        }

        // Test 44: V4AutoExit pause + unpause
        {
            console.log("\n  [44] V4AutoExit pause/unpause");
            autoExit.pause();
            console.log("      Paused: true");
            autoExit.unpause();
            console.log("      Unpaused: true");
            testsPassed++;
        }

        // Test 45: setRouterApproval
        {
            console.log("\n  [45] setRouterApproval");
            address testRouter = address(0xdead);
            v4Utils.setRouterApproval(testRouter, true);
            bool approved = v4Utils.approvedRouters(testRouter);
            console.log("      Router approved:", approved);
            require(approved, "Expected approved");
            v4Utils.setRouterApproval(testRouter, false);
            testsPassed++;
        }

        // Test 46: setOperatorApproval
        {
            console.log("\n  [46] setOperatorApproval");
            address testOperator = address(0xbeef);
            compoundor.setOperatorApproval(testOperator, true);
            bool approved = compoundor.operatorApprovals(deployer, testOperator);
            console.log("      Operator approved:", approved);
            require(approved, "Expected approved");
            compoundor.setOperatorApproval(testOperator, false);
            testsPassed++;
        }
    }

    // ============================================================
    //  PHASE 8: CLEANUP
    // ============================================================

    function _cleanup() internal {
        console.log("\n=== PHASE 8: Cleanup ===");

        // Full exit position 1
        {
            console.log("\n  [47] Full exit position 1");
            (uint256 a0, uint256 a1) = v4Utils.decreaseLiquidity(
                IV4Utils.DecreaseLiquidityParams({
                    tokenId: posId1,
                    liquidity: 0,  // 0 = all
                    amount0Min: 0,
                    amount1Min: 0,
                    deadline: block.timestamp + 1 hours
                })
            );
            console.log("      WETH received:", a0);
            console.log("      USDC received:", a1);
            testsPassed++;
        }

        // Full exit position 2
        {
            console.log("\n  [48] Full exit position 2");
            (uint256 a0, uint256 a1) = v4Utils.decreaseLiquidity(
                IV4Utils.DecreaseLiquidityParams({
                    tokenId: posId2,
                    liquidity: 0,
                    amount0Min: 0,
                    amount1Min: 0,
                    deadline: block.timestamp + 1 hours
                })
            );
            console.log("      WETH received:", a0);
            console.log("      USDC received:", a1);
            testsPassed++;
        }

        // Check and withdraw any accumulated fees
        {
            console.log("\n  [49] withdrawFees check");
            uint256 accW = v4Utils.accumulatedFees(Currency.wrap(WETH));
            uint256 accU = v4Utils.accumulatedFees(Currency.wrap(USDC));
            console.log("      V4Utils accumulated WETH:", accW);
            console.log("      V4Utils accumulated USDC:", accU);
            if (accW > 0) {
                v4Utils.withdrawFees(Currency.wrap(WETH), deployer);
                console.log("      Withdrew WETH fees");
            }
            if (accU > 0) {
                v4Utils.withdrawFees(Currency.wrap(USDC), deployer);
                console.log("      Withdrew USDC fees");
            }
            testsPassed++;
        }
    }

    // ============================================================
    //  HELPERS
    // ============================================================

    /// @notice Absolute value of int24 as uint256 (for logging)
    function _absInt24(int24 x) internal pure returns (uint256) {
        return x >= 0 ? uint256(int256(x)) : uint256(int256(-int256(x)));
    }

    /// @notice Floor division for tick alignment (rounds toward negative infinity)
    function _floorDiv(int24 a, int24 b) internal pure returns (int24) {
        return a / b - (a % b != 0 && (a ^ b) < 0 ? int24(1) : int24(0));
    }
}

/// @title TestExisting
/// @notice Test functions against already-deployed contracts (reads addresses from env)
/// @dev Run: forge script script/TestOnchain.s.sol:TestExisting --rpc-url base --broadcast -vvvv
///      Set env: V4_UTILS, V4_COMPOUNDOR, V4_AUTO_RANGE, V4_AUTO_EXIT
contract TestExisting is Script {
    using PoolIdLibrary for PoolKey;
    using StateLibrary for IPoolManager;

    address constant POOL_MANAGER = 0x498581fF718922c3f8e6A244956aF099B2652b2b;
    address constant POSITION_MANAGER = 0x7C5f5A4bBd8fD63184577525326123B519429bDc;
    address constant WETH = 0x4200000000000000000000000000000000000006;
    address constant USDC = 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913;

    function run() public {
        uint256 pk = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(pk);

        V4Utils v4Utils = V4Utils(payable(vm.envAddress("V4_UTILS")));
        V4Compoundor compoundor = V4Compoundor(payable(vm.envAddress("V4_COMPOUNDOR")));
        V4AutoRange autoRange = V4AutoRange(payable(vm.envAddress("V4_AUTO_RANGE")));
        V4AutoExit autoExit = V4AutoExit(payable(vm.envAddress("V4_AUTO_EXIT")));

        console.log("==================================================");
        console.log("  Testing Existing Deployments on Base Mainnet");
        console.log("==================================================");
        console.log("Deployer:", deployer);
        console.log("V4Utils:", address(v4Utils));
        console.log("V4Compoundor:", address(compoundor));
        console.log("V4AutoRange:", address(autoRange));
        console.log("V4AutoExit:", address(autoExit));

        // Read-only checks (no broadcast needed for views)
        console.log("\n--- View Function Checks ---");

        // V4Utils
        console.log("\nV4Utils:");
        console.log("  protocolFee:", v4Utils.protocolFee(), "bps");
        console.log("  poolManager:", address(v4Utils.poolManager()));
        console.log("  positionManager:", address(v4Utils.positionManager()));
        console.log("  WETH9:", v4Utils.WETH9());
        console.log("  WETH fees:", v4Utils.accumulatedFees(Currency.wrap(WETH)));
        console.log("  USDC fees:", v4Utils.accumulatedFees(Currency.wrap(USDC)));

        // V4Compoundor
        console.log("\nV4Compoundor:");
        console.log("  protocolFee:", compoundor.protocolFee(), "bps");
        console.log("  poolManager:", address(compoundor.poolManager()));
        console.log("  WETH fees:", compoundor.accumulatedFees(Currency.wrap(WETH)));
        console.log("  USDC fees:", compoundor.accumulatedFees(Currency.wrap(USDC)));

        // V4AutoRange
        console.log("\nV4AutoRange:");
        console.log("  protocolFee:", autoRange.protocolFee(), "bps");
        console.log("  poolManager:", address(autoRange.poolManager()));
        console.log("  WETH fees:", autoRange.accumulatedFees(Currency.wrap(WETH)));
        console.log("  USDC fees:", autoRange.accumulatedFees(Currency.wrap(USDC)));

        // V4AutoExit
        console.log("\nV4AutoExit:");
        console.log("  protocolFee:", autoExit.protocolFee(), "bps");
        console.log("  poolManager:", address(autoExit.poolManager()));
        console.log("  WETH fees:", autoExit.accumulatedFees(Currency.wrap(WETH)));
        console.log("  USDC fees:", autoExit.accumulatedFees(Currency.wrap(USDC)));

        // Pool check
        PoolKey memory poolKey = PoolKey({
            currency0: Currency.wrap(WETH),
            currency1: Currency.wrap(USDC),
            fee: 500,
            tickSpacing: int24(10),
            hooks: IHooks(address(0))
        });
        (uint160 sqrtPriceX96,,,) = IPoolManager(POOL_MANAGER).getSlot0(poolKey.toId());
        console.log("\nWETH/USDC Pool sqrtPriceX96:", uint256(sqrtPriceX96));

        console.log("\n==================================================");
        console.log("  All View Checks Passed!");
        console.log("==================================================");

        // Interactive test: mint + test + exit
        console.log("\n--- Starting Interactive Tests ---");
        require(deployer.balance >= 0.005 ether, "Need >= 0.005 ETH for tests");
        require(IERC20(USDC).balanceOf(deployer) >= 2000000, "Need >= 2 USDC for tests");

        vm.startBroadcast(pk);

        // Wrap ETH
        (bool ok,) = WETH.call{value: 0.002 ether}(abi.encodeWithSignature("deposit()"));
        require(ok);

        // Approve tokens
        IERC20(WETH).approve(address(v4Utils), type(uint256).max);
        IERC20(USDC).approve(address(v4Utils), type(uint256).max);
        IERC721(POSITION_MANAGER).setApprovalForAll(address(v4Utils), true);
        IERC721(POSITION_MANAGER).setApprovalForAll(address(compoundor), true);
        IERC721(POSITION_MANAGER).setApprovalForAll(address(autoRange), true);
        IERC721(POSITION_MANAGER).setApprovalForAll(address(autoExit), true);

        // Dynamic tick range
        (, int24 currentTick,,) = IPoolManager(POOL_MANAGER).getSlot0(poolKey.toId());
        int24 tl = _floorDiv(currentTick - int24(3000), int24(10)) * int24(10);
        int24 tu = _floorDiv(currentTick + int24(3000), int24(10)) * int24(10);
        if (tu == tl) tu += int24(10);

        // Mint
        (uint256 tokenId, uint128 liq,,) = v4Utils.swapAndMint(IV4Utils.SwapAndMintParams({
            poolKey: poolKey,
            tickLower: tl,
            tickUpper: tu,
            amount0Desired: 0.0005 ether,
            amount1Desired: 1000000,
            amount0Max: 0.001 ether,
            amount1Max: 2000000,
            recipient: deployer,
            deadline: block.timestamp + 1 hours,
            swapSourceCurrency: Currency.wrap(address(0)),
            swapSourceAmount: 0,
            swapData: "",
            maxSwapSlippage: 0
        }));
        console.log("\nMinted position:", tokenId, "with liquidity:", uint256(liq));

        // Register on compoundor
        compoundor.registerPosition(tokenId, IV4Compoundor.CompoundConfig({
            enabled: true, minCompoundInterval: 300, minRewardAmount: 0
        }));
        console.log("Registered on Compoundor");
        compoundor.unregisterPosition(tokenId);
        console.log("Unregistered from Compoundor");

        // Configure on auto-range
        autoRange.configureRange(tokenId, IV4AutoRange.RangeConfig({
            enabled: true, lowerDelta: int24(3000), upperDelta: int24(3000),
            rebalanceThreshold: 8000, minRebalanceInterval: 3600,
            collectFeesOnRebalance: true, maxSwapSlippage: 500
        }));
        (bool needsRebal,) = autoRange.checkRebalance(tokenId);
        console.log("AutoRange configured, needs rebalance:", needsRebal);
        autoRange.removeRange(tokenId);

        // Configure on auto-exit
        autoExit.configureExit(tokenId, IV4AutoExit.ExitConfig({
            enabled: true,
            triggerTickLower: TickMath.MIN_TICK + 1,
            triggerTickUpper: TickMath.MAX_TICK - 1,
            exitOnRangeExit: true,
            exitToken: Currency.wrap(address(0)),
            maxSwapSlippage: 500,
            minExitInterval: 300
        }));
        (bool needsExit,) = autoExit.checkExit(tokenId);
        console.log("AutoExit configured, needs exit:", needsExit);
        autoExit.removeExit(tokenId);

        // Full exit
        (uint256 ea0, uint256 ea1) = v4Utils.decreaseLiquidity(IV4Utils.DecreaseLiquidityParams({
            tokenId: tokenId, liquidity: 0, amount0Min: 0, amount1Min: 0,
            deadline: block.timestamp + 1 hours
        }));
        console.log("Exited: WETH:", ea0, "USDC:", ea1);

        vm.stopBroadcast();

        console.log("\n==================================================");
        console.log("  All Interactive Tests Passed!");
        console.log("==================================================");
    }

    function _floorDiv(int24 a, int24 b) internal pure returns (int24) {
        return a / b - (a % b != 0 && (a ^ b) < 0 ? int24(1) : int24(0));
    }
}
