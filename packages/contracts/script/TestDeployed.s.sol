// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import { Script, console } from "forge-std/Script.sol";
import { IPoolManager } from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import { PoolKey } from "@uniswap/v4-core/src/types/PoolKey.sol";
import { PoolId, PoolIdLibrary } from "@uniswap/v4-core/src/types/PoolId.sol";
import { Currency } from "@uniswap/v4-core/src/types/Currency.sol";
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

/// @title TestDeployed
/// @notice Test all functions against already-deployed contracts using an existing position
/// @dev Uses position 1802567 (created from prior broadcast) and deployed contract addresses.
///      This script avoids creating new positions mid-test, so tokenId mismatch doesn't occur.
///
/// Run: forge script script/TestDeployed.s.sol:TestDeployed --rpc-url base --broadcast --slow
contract TestDeployed is Script {
    using PoolIdLibrary for PoolKey;
    using StateLibrary for IPoolManager;

    // ============ Base Mainnet Constants ============
    address constant POOL_MANAGER = 0x498581fF718922c3f8e6A244956aF099B2652b2b;
    address constant POSITION_MANAGER = 0x7C5f5A4bBd8fD63184577525326123B519429bDc;
    address constant WETH = 0x4200000000000000000000000000000000000006;
    address constant USDC = 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913;

    // ============ Deployed Contract Addresses ============
    V4Utils v4Utils = V4Utils(payable(0x8d81Bb4daA4c8D6ad99a741d1E7C9563EAFda423));
    V4Compoundor compoundor = V4Compoundor(payable(0x2056eDc7590B42b5464f357589810fA3441216E3));
    V4AutoRange autoRange = V4AutoRange(payable(0xB6E684266259d172a8CC85F524ab2E845886242b));
    V4AutoExit autoExit = V4AutoExit(payable(0xb9ab855339036df10790728A773dD3a8c9e538B0));

    // ============ Existing Position ============
    uint256 constant POS_ID = 1802567; // Created from prior successful swapAndMint

    address deployer;
    uint256 testsPassed;
    PoolKey poolKey;

    function run() public {
        uint256 pk = vm.envUint("PRIVATE_KEY");
        deployer = vm.addr(pk);

        console.log("==================================================");
        console.log("  CopyPools V4 - Test All Deployed Functions");
        console.log("  Chain: Base Mainnet (8453)");
        console.log("==================================================");
        console.log("Deployer:", deployer);
        console.log("ETH Balance:", deployer.balance);
        console.log("USDC Balance:", IERC20(USDC).balanceOf(deployer));
        console.log("V4Utils:", address(v4Utils));
        console.log("V4Compoundor:", address(compoundor));
        console.log("V4AutoRange:", address(autoRange));
        console.log("V4AutoExit:", address(autoExit));
        console.log("Test Position:", POS_ID);

        // Verify ownership
        address posOwner = IERC721(POSITION_MANAGER).ownerOf(POS_ID);
        require(posOwner == deployer, "Deployer must own position");

        poolKey = PoolKey({
            currency0: Currency.wrap(WETH),
            currency1: Currency.wrap(USDC),
            fee: 500,
            tickSpacing: int24(10),
            hooks: IHooks(address(0))
        });

        // Phase 1: View function tests (no broadcast needed)
        _testViewFunctions();

        // Phase 2: State-changing tests (broadcast)
        vm.startBroadcast(pk);

        _testV4Compoundor();
        _testV4AutoRange();
        _testV4AutoExit();
        _testAdmin();
        _testExitPosition();

        vm.stopBroadcast();

        console.log("\n==================================================");
        console.log("  ALL TESTS PASSED:", testsPassed);
        console.log("==================================================");
        console.log("Final ETH Balance:", deployer.balance);
        console.log("Final USDC Balance:", IERC20(USDC).balanceOf(deployer));
    }

    // ============================================================
    //  PHASE 1: VIEW FUNCTION TESTS
    // ============================================================

    function _testViewFunctions() internal view {
        console.log("\n=== PHASE 1: View Function Tests ===");

        // V4Utils views
        {
            console.log("\n  [1] V4Utils.owner()");
            address owner = v4Utils.owner();
            console.log("      Owner:", owner);
            require(owner == deployer, "Wrong owner");
        }
        {
            console.log("  [2] V4Utils.protocolFee()");
            uint256 fee = v4Utils.protocolFee();
            console.log("      Fee:", fee, "bps");
            require(fee == 65, "Expected 65");
        }
        {
            console.log("  [3] V4Utils.paused()");
            bool p = v4Utils.paused();
            console.log("      Paused:", p);
            require(!p, "Expected not paused");
        }
        {
            console.log("  [4] V4Utils.poolManager()");
            address pm = address(v4Utils.poolManager());
            console.log("      PoolManager:", pm);
            require(pm == POOL_MANAGER, "Wrong PM");
        }
        {
            console.log("  [5] V4Utils.positionManager()");
            address pm = address(v4Utils.positionManager());
            console.log("      PositionManager:", pm);
            require(pm == POSITION_MANAGER, "Wrong PM");
        }
        {
            console.log("  [6] V4Utils.WETH9()");
            address w = v4Utils.WETH9();
            console.log("      WETH:", w);
            require(w == WETH, "Wrong WETH");
        }
        {
            console.log("  [7] V4Utils.accumulatedFees(WETH)");
            uint256 f = v4Utils.accumulatedFees(Currency.wrap(WETH));
            console.log("      Fees:", f);
        }
        {
            console.log("  [8] V4Utils.accumulatedFees(USDC)");
            uint256 f = v4Utils.accumulatedFees(Currency.wrap(USDC));
            console.log("      Fees:", f);
        }
        {
            console.log("  [9] V4Utils.approvedRouters()");
            bool approved = v4Utils.approvedRouters(0x6fF5693b99212Da76ad316178A184AB56D299b43);
            console.log("      Universal Router approved:", approved);
            require(approved, "Router not approved");
        }
        {
            console.log("  [10] V4Utils.MAX_PROTOCOL_FEE()");
            uint256 maxFee = v4Utils.MAX_PROTOCOL_FEE();
            console.log("      Max fee:", maxFee);
            require(maxFee == 1000, "Expected 1000");
        }
        {
            console.log("  [11] V4Utils.FEE_CHANGE_COOLDOWN()");
            uint256 cooldown = v4Utils.FEE_CHANGE_COOLDOWN();
            console.log("      Cooldown:", cooldown, "seconds");
            require(cooldown == 86400, "Expected 86400");
        }

        // V4Compoundor views
        {
            console.log("\n  [12] V4Compoundor.owner()");
            address owner = compoundor.owner();
            console.log("      Owner:", owner);
            require(owner == deployer, "Wrong owner");
        }
        {
            console.log("  [13] V4Compoundor.protocolFee()");
            uint256 fee = compoundor.protocolFee();
            console.log("      Fee:", fee, "bps");
            require(fee == 65, "Expected 65");
        }
        {
            console.log("  [14] V4Compoundor.poolManager()");
            address pm = address(compoundor.poolManager());
            require(pm == POOL_MANAGER, "Wrong PM");
            console.log("      OK");
        }
        {
            console.log("  [15] V4Compoundor.accumulatedFees(WETH)");
            uint256 f = compoundor.accumulatedFees(Currency.wrap(WETH));
            console.log("      Fees:", f);
        }

        // V4AutoRange views
        {
            console.log("\n  [16] V4AutoRange.owner()");
            address owner = autoRange.owner();
            require(owner == deployer, "Wrong owner");
            console.log("      OK");
        }
        {
            console.log("  [17] V4AutoRange.protocolFee()");
            uint256 fee = autoRange.protocolFee();
            console.log("      Fee:", fee, "bps");
            require(fee == 65, "Expected 65");
        }
        {
            console.log("  [18] V4AutoRange.accumulatedFees(WETH)");
            uint256 f = autoRange.accumulatedFees(Currency.wrap(WETH));
            console.log("      Fees:", f);
        }

        // V4AutoExit views
        {
            console.log("\n  [19] V4AutoExit.owner()");
            address owner = autoExit.owner();
            require(owner == deployer, "Wrong owner");
            console.log("      OK");
        }
        {
            console.log("  [20] V4AutoExit.protocolFee()");
            uint256 fee = autoExit.protocolFee();
            console.log("      Fee:", fee, "bps");
            require(fee == 65, "Expected 65");
        }
        {
            console.log("  [21] V4AutoExit.accumulatedFees(WETH)");
            uint256 f = autoExit.accumulatedFees(Currency.wrap(WETH));
            console.log("      Fees:", f);
        }
        {
            console.log("  [22] V4AutoExit.accumulatedFees(USDC)");
            uint256 f = autoExit.accumulatedFees(Currency.wrap(USDC));
            console.log("      Fees:", f);
        }

        // Pool check
        {
            console.log("\n  [23] Pool state");
            (uint160 sqrtPriceX96, int24 currentTick,,) = IPoolManager(POOL_MANAGER).getSlot0(poolKey.toId());
            console.log("      sqrtPriceX96:", uint256(sqrtPriceX96));
            console.log("      currentTick (abs):", _absInt24(currentTick));
            require(sqrtPriceX96 > 0, "Pool not initialized");
        }
    }

    // ============================================================
    //  PHASE 2: V4COMPOUNDOR STATE-CHANGING TESTS
    // ============================================================

    function _testV4Compoundor() internal {
        console.log("\n=== PHASE 2: V4Compoundor Functions ===");

        // Register position
        {
            console.log("\n  [24] registerPosition");
            compoundor.registerPosition(POS_ID, IV4Compoundor.CompoundConfig({
                enabled: true,
                minCompoundInterval: 300,
                minRewardAmount: 0
            }));
            console.log("      Registered position", POS_ID);
            testsPassed++;
        }

        // getConfig
        {
            console.log("  [25] getConfig()");
            IV4Compoundor.CompoundConfig memory cfg = compoundor.getConfig(POS_ID);
            console.log("      enabled:", cfg.enabled);
            console.log("      minCompoundInterval:", cfg.minCompoundInterval);
            require(cfg.enabled, "Expected enabled");
            testsPassed++;
        }

        // getLastCompoundTime
        {
            console.log("  [26] getLastCompoundTime()");
            uint256 t = compoundor.getLastCompoundTime(POS_ID);
            console.log("      Time:", t);
            testsPassed++;
        }

        // isCompoundProfitable
        {
            console.log("  [27] isCompoundProfitable()");
            (bool profitable, uint256 reward) = compoundor.isCompoundProfitable(POS_ID);
            console.log("      Profitable:", profitable);
            console.log("      Reward:", reward);
            testsPassed++;
        }

        // getPendingFees
        {
            console.log("  [28] getPendingFees()");
            (uint256 f0, uint256 f1) = compoundor.getPendingFees(POS_ID);
            console.log("      WETH:", f0);
            console.log("      USDC:", f1);
            testsPassed++;
        }

        // updateConfig
        {
            console.log("  [29] updateConfig");
            compoundor.updateConfig(POS_ID, IV4Compoundor.CompoundConfig({
                enabled: true,
                minCompoundInterval: 600,
                minRewardAmount: 1000
            }));
            IV4Compoundor.CompoundConfig memory cfg = compoundor.getConfig(POS_ID);
            console.log("      Updated interval:", cfg.minCompoundInterval);
            require(cfg.minCompoundInterval == 600, "Expected 600");
            testsPassed++;
        }

        // unregisterPosition
        {
            console.log("  [30] unregisterPosition");
            compoundor.unregisterPosition(POS_ID);
            IV4Compoundor.CompoundConfig memory cfg = compoundor.getConfig(POS_ID);
            console.log("      Enabled:", cfg.enabled);
            require(!cfg.enabled, "Expected disabled");
            testsPassed++;
        }
    }

    // ============================================================
    //  PHASE 3: V4AUTORANGE STATE-CHANGING TESTS
    // ============================================================

    function _testV4AutoRange() internal {
        console.log("\n=== PHASE 3: V4AutoRange Functions ===");

        // configureRange
        {
            console.log("\n  [31] configureRange");
            autoRange.configureRange(POS_ID, IV4AutoRange.RangeConfig({
                enabled: true,
                lowerDelta: int24(3000),
                upperDelta: int24(3000),
                rebalanceThreshold: 8000,
                minRebalanceInterval: 3600,
                collectFeesOnRebalance: true,
                maxSwapSlippage: 500
            }));
            console.log("      Configured position", POS_ID);
            testsPassed++;
        }

        // getRangeConfig
        {
            console.log("  [32] getRangeConfig()");
            IV4AutoRange.RangeConfig memory cfg = autoRange.getRangeConfig(POS_ID);
            console.log("      enabled:", cfg.enabled);
            console.log("      rebalanceThreshold:", cfg.rebalanceThreshold);
            console.log("      maxSwapSlippage:", cfg.maxSwapSlippage);
            require(cfg.enabled, "Expected enabled");
            require(cfg.rebalanceThreshold == 8000, "Expected 8000");
            testsPassed++;
        }

        // getLastRebalanceTime
        {
            console.log("  [33] getLastRebalanceTime()");
            uint256 t = autoRange.getLastRebalanceTime(POS_ID);
            console.log("      Time:", t);
            testsPassed++;
        }

        // checkRebalance
        {
            console.log("  [34] checkRebalance()");
            (bool needs, uint8 reason) = autoRange.checkRebalance(POS_ID);
            console.log("      Needs rebalance:", needs);
            console.log("      Reason:", reason);
            testsPassed++;
        }

        // batchCheckRebalance
        {
            console.log("  [35] batchCheckRebalance()");
            uint256[] memory ids = new uint256[](1);
            ids[0] = POS_ID;
            bool[] memory results = autoRange.batchCheckRebalance(ids);
            console.log("      Result:", results[0]);
            testsPassed++;
        }

        // calculateOptimalRange
        {
            console.log("  [36] calculateOptimalRange()");
            (int24 optLower, int24 optUpper) = autoRange.calculateOptimalRange(POS_ID);
            console.log("      Lower (abs):", _absInt24(optLower));
            console.log("      Upper (abs):", _absInt24(optUpper));
            testsPassed++;
        }

        // getPositionStatus
        {
            console.log("  [37] getPositionStatus()");
            (bool inRange, int24 curTick, int24 posLower, int24 posUpper) = autoRange.getPositionStatus(POS_ID);
            console.log("      In range:", inRange);
            console.log("      Current tick (abs):", _absInt24(curTick));
            console.log("      Pos lower (abs):", _absInt24(posLower));
            console.log("      Pos upper (abs):", _absInt24(posUpper));
            testsPassed++;
        }

        // updateRangeConfig
        {
            console.log("  [38] updateRangeConfig");
            autoRange.updateRangeConfig(POS_ID, IV4AutoRange.RangeConfig({
                enabled: true,
                lowerDelta: int24(6000),
                upperDelta: int24(6000),
                rebalanceThreshold: 9000,
                minRebalanceInterval: 7200,
                collectFeesOnRebalance: true,
                maxSwapSlippage: 300
            }));
            IV4AutoRange.RangeConfig memory cfg = autoRange.getRangeConfig(POS_ID);
            console.log("      Updated threshold:", cfg.rebalanceThreshold);
            require(cfg.rebalanceThreshold == 9000, "Expected 9000");
            testsPassed++;
        }

        // removeRange
        {
            console.log("  [39] removeRange");
            autoRange.removeRange(POS_ID);
            IV4AutoRange.RangeConfig memory cfg = autoRange.getRangeConfig(POS_ID);
            console.log("      Enabled:", cfg.enabled);
            require(!cfg.enabled, "Expected disabled");
            testsPassed++;
        }
    }

    // ============================================================
    //  PHASE 4: V4AUTOEXIT STATE-CHANGING TESTS
    // ============================================================

    function _testV4AutoExit() internal {
        console.log("\n=== PHASE 4: V4AutoExit Functions ===");

        // configureExit
        {
            console.log("\n  [40] configureExit");
            autoExit.configureExit(POS_ID, IV4AutoExit.ExitConfig({
                enabled: true,
                triggerTickLower: TickMath.MIN_TICK + 1,
                triggerTickUpper: TickMath.MAX_TICK - 1,
                exitOnRangeExit: true,
                exitToken: Currency.wrap(address(0)),
                maxSwapSlippage: 500,
                minExitInterval: 300
            }));
            console.log("      Configured position", POS_ID);
            testsPassed++;
        }

        // getExitConfig
        {
            console.log("  [41] getExitConfig()");
            IV4AutoExit.ExitConfig memory cfg = autoExit.getExitConfig(POS_ID);
            console.log("      enabled:", cfg.enabled);
            console.log("      exitOnRangeExit:", cfg.exitOnRangeExit);
            console.log("      maxSwapSlippage:", cfg.maxSwapSlippage);
            console.log("      minExitInterval:", cfg.minExitInterval);
            require(cfg.enabled, "Expected enabled");
            testsPassed++;
        }

        // getConfigTimestamp
        {
            console.log("  [42] getConfigTimestamp()");
            uint256 ts = autoExit.getConfigTimestamp(POS_ID);
            console.log("      Timestamp:", ts);
            require(ts > 0, "Expected nonzero");
            testsPassed++;
        }

        // checkExit
        {
            console.log("  [43] checkExit()");
            (bool needs, uint8 reason) = autoExit.checkExit(POS_ID);
            console.log("      Needs exit:", needs);
            console.log("      Reason:", reason);
            testsPassed++;
        }

        // batchCheckExit
        {
            console.log("  [44] batchCheckExit()");
            uint256[] memory ids = new uint256[](1);
            ids[0] = POS_ID;
            bool[] memory results = autoExit.batchCheckExit(ids);
            console.log("      Result:", results[0]);
            testsPassed++;
        }

        // updateExitConfig
        {
            console.log("  [45] updateExitConfig");
            autoExit.updateExitConfig(POS_ID, IV4AutoExit.ExitConfig({
                enabled: true,
                triggerTickLower: TickMath.MIN_TICK + 1,
                triggerTickUpper: TickMath.MAX_TICK - 1,
                exitOnRangeExit: false,
                exitToken: Currency.wrap(USDC),
                maxSwapSlippage: 300,
                minExitInterval: 600
            }));
            IV4AutoExit.ExitConfig memory cfg = autoExit.getExitConfig(POS_ID);
            console.log("      exitOnRangeExit:", cfg.exitOnRangeExit);
            console.log("      maxSwapSlippage:", cfg.maxSwapSlippage);
            require(!cfg.exitOnRangeExit, "Expected false");
            require(cfg.minExitInterval == 600, "Expected 600");
            testsPassed++;
        }

        // removeExit
        {
            console.log("  [46] removeExit");
            autoExit.removeExit(POS_ID);
            IV4AutoExit.ExitConfig memory cfg = autoExit.getExitConfig(POS_ID);
            console.log("      Enabled:", cfg.enabled);
            require(!cfg.enabled, "Expected disabled");
            testsPassed++;
        }
    }

    // ============================================================
    //  PHASE 5: ADMIN FUNCTIONS
    // ============================================================

    function _testAdmin() internal {
        console.log("\n=== PHASE 5: Admin Functions ===");

        // V4Utils pause + unpause
        {
            console.log("\n  [47] V4Utils pause/unpause");
            v4Utils.pause();
            require(v4Utils.paused(), "Expected paused");
            console.log("      Paused: true");
            v4Utils.unpause();
            require(!v4Utils.paused(), "Expected unpaused");
            console.log("      Unpaused: true");
            testsPassed++;
        }

        // V4Compoundor pause + unpause
        {
            console.log("  [48] V4Compoundor pause/unpause");
            compoundor.pause();
            require(compoundor.paused(), "Expected paused");
            compoundor.unpause();
            console.log("      OK");
            testsPassed++;
        }

        // V4AutoRange pause + unpause
        {
            console.log("  [49] V4AutoRange pause/unpause");
            autoRange.pause();
            require(autoRange.paused(), "Expected paused");
            autoRange.unpause();
            console.log("      OK");
            testsPassed++;
        }

        // V4AutoExit pause + unpause
        {
            console.log("  [50] V4AutoExit pause/unpause");
            autoExit.pause();
            require(autoExit.paused(), "Expected paused");
            autoExit.unpause();
            console.log("      OK");
            testsPassed++;
        }

        // setRouterApproval
        {
            console.log("  [51] setRouterApproval");
            address testRouter = address(0xdead);
            v4Utils.setRouterApproval(testRouter, true);
            require(v4Utils.approvedRouters(testRouter), "Expected approved");
            v4Utils.setRouterApproval(testRouter, false);
            require(!v4Utils.approvedRouters(testRouter), "Expected unapproved");
            console.log("      OK: approve + revoke");
            testsPassed++;
        }

        // setOperatorApproval
        {
            console.log("  [52] setOperatorApproval");
            address testOp = address(0xbeef);
            compoundor.setOperatorApproval(testOp, true);
            require(compoundor.operatorApprovals(deployer, testOp), "Expected approved");
            compoundor.setOperatorApproval(testOp, false);
            console.log("      OK: approve + revoke");
            testsPassed++;
        }
    }

    // ============================================================
    //  PHASE 6: EXIT POSITION + CLEANUP
    // ============================================================

    function _testExitPosition() internal {
        console.log("\n=== PHASE 6: Exit Position & Cleanup ===");

        // collectFees
        {
            console.log("\n  [53] collectFees");
            (uint256 f0, uint256 f1) = v4Utils.collectFees(
                IV4Utils.CollectFeesParams({
                    tokenId: POS_ID,
                    deadline: block.timestamp + 1 hours
                })
            );
            console.log("      WETH fees:", f0);
            console.log("      USDC fees:", f1);
            testsPassed++;
        }

        // decreaseLiquidity (full exit)
        {
            console.log("  [54] decreaseLiquidity (full exit)");
            (uint256 a0, uint256 a1) = v4Utils.decreaseLiquidity(
                IV4Utils.DecreaseLiquidityParams({
                    tokenId: POS_ID,
                    liquidity: 0, // 0 = all
                    amount0Min: 0,
                    amount1Min: 0,
                    deadline: block.timestamp + 1 hours
                })
            );
            console.log("      WETH received:", a0);
            console.log("      USDC received:", a1);
            testsPassed++;
        }

        // withdrawFees check
        {
            console.log("  [55] withdrawFees check");
            uint256 accW = v4Utils.accumulatedFees(Currency.wrap(WETH));
            uint256 accU = v4Utils.accumulatedFees(Currency.wrap(USDC));
            console.log("      V4Utils WETH:", accW);
            console.log("      V4Utils USDC:", accU);
            if (accW > 0) {
                v4Utils.withdrawFees(Currency.wrap(WETH), deployer);
                console.log("      Withdrew WETH");
            }
            if (accU > 0) {
                v4Utils.withdrawFees(Currency.wrap(USDC), deployer);
                console.log("      Withdrew USDC");
            }
            testsPassed++;
        }
    }

    // ============================================================
    //  HELPERS
    // ============================================================

    function _absInt24(int24 x) internal pure returns (uint256) {
        return x >= 0 ? uint256(int256(x)) : uint256(int256(-int256(x)));
    }
}
