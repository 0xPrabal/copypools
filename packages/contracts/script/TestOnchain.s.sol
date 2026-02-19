// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import { Script, console } from "forge-std/Script.sol";
import { IPoolManager } from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import { PoolKey } from "@uniswap/v4-core/src/types/PoolKey.sol";
import { Currency, CurrencyLibrary } from "@uniswap/v4-core/src/types/Currency.sol";
import { TickMath } from "@uniswap/v4-core/src/libraries/TickMath.sol";
import { IHooks } from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { IERC721 } from "@openzeppelin/contracts/token/ERC721/IERC721.sol";

import { V4Utils } from "../src/utils/V4Utils.sol";
import { V4Compoundor } from "../src/automators/V4Compoundor.sol";
import { V4AutoRange } from "../src/automators/V4AutoRange.sol";
import { IV4Utils } from "../src/interfaces/IV4Utils.sol";
import { IV4Compoundor } from "../src/interfaces/IV4Compoundor.sol";
import { IV4AutoRange } from "../src/interfaces/IV4AutoRange.sol";

/// @title TestOnchain
/// @notice Test all contract functions on Base mainnet
contract TestOnchain is Script {
    address constant POOL_MANAGER = 0x498581fF718922c3f8e6A244956aF099B2652b2b;
    address constant POSITION_MANAGER = 0x7C5f5A4bBd8fD63184577525326123B519429bDc;
    address constant WETH = 0x4200000000000000000000000000000000000006;
    address constant USDC = 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913;

    // Deployed proxy addresses
    address constant V4_UTILS = 0x1C383F15d237a77aFb86965f47D87c18E2c1E785;
    address constant V4_COMPOUNDOR = 0x46BC1BBACf77Fae7F5d9A185AbfF67f18cF83C46;
    address constant V4_AUTO_RANGE = 0x9Fb40fD15C97690BBAB2e0817ef5704E1461d371;

    V4Utils v4Utils = V4Utils(payable(V4_UTILS));
    V4Compoundor compoundor = V4Compoundor(payable(V4_COMPOUNDOR));
    V4AutoRange autoRange = V4AutoRange(payable(V4_AUTO_RANGE));

    function run() public {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerPrivateKey);

        console.log("=== Test Suite: On-Chain Contract Testing ===");
        console.log("Deployer:", deployer);
        console.log("ETH Balance:", deployer.balance);
        console.log("USDC Balance:", IERC20(USDC).balanceOf(deployer));

        vm.startBroadcast(deployerPrivateKey);

        // ============ Step 1: Pool key (WETH/USDC, already initialized) ============
        console.log("\n--- Step 1: Using existing WETH/USDC Pool ---");

        // WETH (0x4200...) < USDC (0x8335...) so WETH is currency0
        PoolKey memory poolKey = PoolKey({
            currency0: Currency.wrap(WETH),
            currency1: Currency.wrap(USDC),
            fee: 3000,
            tickSpacing: int24(60),
            hooks: IHooks(address(0))
        });

        // ============ Step 2: Wrap ETH to WETH ============
        console.log("\n--- Step 2: Wrap ETH to WETH ---");
        uint256 wrapAmount = 0.002 ether;
        (bool wrapSuccess,) = WETH.call{value: wrapAmount}(abi.encodeWithSignature("deposit()"));
        require(wrapSuccess, "WETH wrap failed");
        console.log("Wrapped ETH to WETH");

        // ============ Step 3: Approve tokens for V4Utils ============
        console.log("\n--- Step 3: Approve tokens ---");
        IERC20(WETH).approve(V4_UTILS, type(uint256).max);
        IERC20(USDC).approve(V4_UTILS, type(uint256).max);
        console.log("Approved WETH and USDC for V4Utils");

        // ============ Step 4: swapAndMint ============
        console.log("\n--- Step 4: swapAndMint ---");

        int24 tickLower = int24(-207060); // Wide range below
        int24 tickUpper = int24(-201060); // Wide range above
        // Note: For WETH/USDC where WETH is currency0, the tick is negative
        // tick ≈ log1.0001(2.6e-9) ≈ -203610
        // Set range around this: -207060 to -201060

        IV4Utils.SwapAndMintParams memory mintParams = IV4Utils.SwapAndMintParams({
            poolKey: poolKey,
            tickLower: tickLower,
            tickUpper: tickUpper,
            amount0Desired: 0.0005 ether,
            amount1Desired: 1000000, // 1 USDC
            amount0Max: 0.001 ether,
            amount1Max: 2000000, // 2 USDC
            recipient: deployer,
            deadline: block.timestamp + 1 hours,
            swapSourceCurrency: Currency.wrap(address(0)),
            swapSourceAmount: 0,
            swapData: "",
            maxSwapSlippage: 0
        });

        (uint256 tokenId, uint128 liquidity, uint256 amount0Used, uint256 amount1Used) = v4Utils.swapAndMint(mintParams);
        console.log("Position minted! TokenId:", tokenId);
        console.log("  Liquidity:", uint256(liquidity));
        console.log("  Amount0 used:", amount0Used);
        console.log("  Amount1 used:", amount1Used);

        // ============ Step 5: swapAndIncreaseLiquidity ============
        console.log("\n--- Step 5: swapAndIncreaseLiquidity ---");
        IERC721(POSITION_MANAGER).approve(V4_UTILS, tokenId);

        IV4Utils.SwapAndIncreaseParams memory increaseParams = IV4Utils.SwapAndIncreaseParams({
            tokenId: tokenId,
            amount0Desired: 0.0002 ether,
            amount1Desired: 500000, // 0.5 USDC
            amount0Max: 0.0005 ether,
            amount1Max: 1000000,
            deadline: block.timestamp + 1 hours,
            swapSourceCurrency: Currency.wrap(address(0)),
            swapSourceAmount: 0,
            swapData: "",
            maxSwapSlippage: 0
        });

        (uint128 addedLiq, uint256 inc0, uint256 inc1) = v4Utils.swapAndIncreaseLiquidity(increaseParams);
        console.log("Liquidity increased! Added:", uint256(addedLiq));

        // ============ Step 6: collectFees ============
        console.log("\n--- Step 6: collectFees ---");
        IERC721(POSITION_MANAGER).approve(V4_UTILS, tokenId);

        (uint256 fees0, uint256 fees1) = v4Utils.collectFees(IV4Utils.CollectFeesParams({
            tokenId: tokenId,
            deadline: block.timestamp + 1 hours
        }));
        console.log("Fees collected:", fees0, fees1);

        // ============ Step 7: decreaseLiquidity (partial) ============
        console.log("\n--- Step 7: decreaseLiquidity (partial) ---");
        IERC721(POSITION_MANAGER).approve(V4_UTILS, tokenId);

        uint128 halfLiq = (liquidity + addedLiq) / 2;
        (uint256 dec0, uint256 dec1) = v4Utils.decreaseLiquidity(IV4Utils.DecreaseLiquidityParams({
            tokenId: tokenId,
            liquidity: halfLiq,
            amount0Min: 0,
            amount1Min: 0,
            deadline: block.timestamp + 1 hours
        }));
        console.log("Decreased liquidity:", uint256(halfLiq));
        console.log("  Received:", dec0, dec1);

        // ============ Step 8: V4Compoundor - register ============
        console.log("\n--- Step 8: V4Compoundor register ---");
        IERC721(POSITION_MANAGER).approve(V4_COMPOUNDOR, tokenId);

        compoundor.registerPosition(tokenId, IV4Compoundor.CompoundConfig({
            enabled: true,
            minCompoundInterval: 300,
            minRewardAmount: 0
        }));
        console.log("Position registered on V4Compoundor");

        // Unregister for cleanup
        compoundor.unregisterPosition(tokenId);
        console.log("Position unregistered from V4Compoundor");

        // ============ Step 9: V4AutoRange - configure ============
        console.log("\n--- Step 9: V4AutoRange configure ---");
        IERC721(POSITION_MANAGER).approve(V4_AUTO_RANGE, tokenId);

        autoRange.configureRange(tokenId, IV4AutoRange.RangeConfig({
            enabled: true,
            lowerDelta: int24(3000),
            upperDelta: int24(3000),
            rebalanceThreshold: 8000,
            minRebalanceInterval: 3600,
            collectFeesOnRebalance: true,
            maxSwapSlippage: 500
        }));
        console.log("Position configured on V4AutoRange");

        // Check rebalance status
        (bool needsRebalance, uint8 reason) = autoRange.checkRebalance(tokenId);
        console.log("Needs rebalance:", needsRebalance, "Reason:", reason);

        // Remove config for cleanup
        autoRange.removeRange(tokenId);
        console.log("Position removed from V4AutoRange");

        // ============ Step 10: moveRange ============
        console.log("\n--- Step 10: moveRange ---");
        IERC721(POSITION_MANAGER).approve(V4_UTILS, tokenId);

        (uint256 newTokenId, uint128 newLiquidity) = v4Utils.moveRange(IV4Utils.MoveRangeParams({
            tokenId: tokenId,
            newTickLower: tickLower - int24(120),
            newTickUpper: tickUpper + int24(120),
            liquidityToMove: 0,
            amount0Max: type(uint256).max,
            amount1Max: type(uint256).max,
            deadline: block.timestamp + 1 hours,
            swapData: "",
            maxSwapSlippage: 500
        }));
        console.log("Range moved! New TokenId:", newTokenId);
        console.log("  New Liquidity:", uint256(newLiquidity));

        // ============ Step 11: Full exit ============
        console.log("\n--- Step 11: Full exit ---");
        IERC721(POSITION_MANAGER).approve(V4_UTILS, newTokenId);

        (uint256 exit0, uint256 exit1) = v4Utils.decreaseLiquidity(IV4Utils.DecreaseLiquidityParams({
            tokenId: newTokenId,
            liquidity: 0,
            amount0Min: 0,
            amount1Min: 0,
            deadline: block.timestamp + 1 hours
        }));
        console.log("Full exit! Received:", exit0, exit1);

        // ============ Step 12: Admin - withdrawFees ============
        console.log("\n--- Step 12: Admin tests ---");
        uint256 accFees = v4Utils.accumulatedFees(Currency.wrap(WETH));
        console.log("Accumulated WETH fees:", accFees);
        if (accFees > 0) {
            v4Utils.withdrawFees(Currency.wrap(WETH), deployer);
            console.log("Fees withdrawn");
        }

        console.log("\n=== ALL TESTS PASSED ===");
        console.log("Final ETH Balance:", deployer.balance);
        console.log("Final USDC Balance:", IERC20(USDC).balanceOf(deployer));

        vm.stopBroadcast();
    }
}
