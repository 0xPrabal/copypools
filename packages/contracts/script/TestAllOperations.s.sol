// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "forge-std/Script.sol";
import {Currency} from "v4-core/types/Currency.sol";
import {PoolKey} from "v4-core/types/PoolKey.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {IV4Utils} from "../src/interfaces/IV4Utils.sol";
import {IERC20} from "forge-std/interfaces/IERC20.sol";
import {IERC721} from "forge-std/interfaces/IERC721.sol";

contract TestAllOperations is Script {
    // Base Mainnet addresses
    address constant V4_UTILS = 0x8d81Bb4daA4c8D6ad99a741d1E7C9563EAFda423;
    address constant POSITION_MANAGER = 0x7C5f5A4bBd8fD63184577525326123B519429bDc;

    address constant USDC = 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913;
    address constant USDT = 0xfde4C96c8593536E31F229EA8f37b2ADa2699bb2;
    address constant WETH = 0x4200000000000000000000000000000000000006;
    address constant NATIVE_ETH = address(0);

    IV4Utils v4Utils = IV4Utils(V4_UTILS);

    function run() external {
        uint256 deployerKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerKey);
        uint256 deadline = block.timestamp + 3600;

        console.log("=== CopyPools Full Integration Test ===");
        console.log("Deployer:", deployer);
        console.log("Deadline:", deadline);
        console.log("");

        vm.startBroadcast(deployerKey);

        // ============ TEST 1: ETH/USDC Position (both tokens) ============
        console.log("--- TEST 1: Create ETH/USDC position (both tokens) ---");
        {
            // ETH (native) < USDC lexicographically → currency0=ETH, currency1=USDC
            PoolKey memory poolKey = PoolKey({
                currency0: Currency.wrap(NATIVE_ETH),
                currency1: Currency.wrap(USDC),
                fee: 500,
                tickSpacing: 10,
                hooks: IHooks(address(0))
            });

            // Approve USDC for V4Utils
            IERC20(USDC).approve(V4_UTILS, type(uint256).max);

            // Full range ticks for tickSpacing=10
            int24 tickLower = -887270; // floor(-887272 / 10) * 10
            int24 tickUpper = 887270;  // floor(887272 / 10) * 10

            // 0.001 ETH + 1 USDC
            uint256 amount0 = 0.001 ether; // ETH
            uint256 amount1 = 1e6;         // 1 USDC

            IV4Utils.SwapAndMintParams memory mintParams = IV4Utils.SwapAndMintParams({
                poolKey: poolKey,
                tickLower: tickLower,
                tickUpper: tickUpper,
                amount0Desired: amount0,
                amount1Desired: amount1,
                amount0Max: amount0 * 110 / 100,
                amount1Max: amount1 * 110 / 100,
                recipient: deployer,
                deadline: deadline,
                swapSourceCurrency: Currency.wrap(address(0)),
                swapSourceAmount: 0,
                swapData: "",
                maxSwapSlippage: 0
            });

            (uint256 tokenId1, uint128 liq1, uint256 used0_1, uint256 used1_1) =
                v4Utils.swapAndMint{value: amount0 * 110 / 100}(mintParams);

            console.log("  Token ID:", tokenId1);
            console.log("  Liquidity:", uint256(liq1));
            console.log("  ETH used:", used0_1);
            console.log("  USDC used:", used1_1);
            console.log("  SUCCESS");
            console.log("");

            // ============ TEST 4a: Increase Liquidity ============
            console.log("--- TEST 4a: Increase liquidity on position ---");
            {
                // Approve NFT for V4Utils
                IERC721(POSITION_MANAGER).approve(V4_UTILS, tokenId1);

                uint256 addAmount0 = 0.0005 ether;
                uint256 addAmount1 = 0.5e6; // 0.5 USDC

                IV4Utils.SwapAndIncreaseParams memory incParams = IV4Utils.SwapAndIncreaseParams({
                    tokenId: tokenId1,
                    amount0Desired: addAmount0,
                    amount1Desired: addAmount1,
                    amount0Max: addAmount0 * 110 / 100,
                    amount1Max: addAmount1 * 110 / 100,
                    deadline: deadline,
                    swapSourceCurrency: Currency.wrap(address(0)),
                    swapSourceAmount: 0,
                    swapData: "",
                    maxSwapSlippage: 0
                });

                (uint128 addedLiq, uint256 addUsed0, uint256 addUsed1) =
                    v4Utils.swapAndIncreaseLiquidity{value: addAmount0 * 110 / 100}(incParams);

                console.log("  Added liquidity:", uint256(addedLiq));
                console.log("  ETH used:", addUsed0);
                console.log("  USDC used:", addUsed1);
                console.log("  SUCCESS");
                console.log("");
            }

            // ============ TEST 4b: Collect Fees ============
            console.log("--- TEST 4b: Collect fees ---");
            {
                IV4Utils.CollectFeesParams memory collectParams = IV4Utils.CollectFeesParams({
                    tokenId: tokenId1,
                    deadline: deadline
                });

                (uint256 fees0, uint256 fees1) = v4Utils.collectFees(collectParams);
                console.log("  Fees ETH:", fees0);
                console.log("  Fees USDC:", fees1);
                console.log("  SUCCESS (fees may be 0 for new position)");
                console.log("");
            }

            // ============ TEST 4c: Decrease Liquidity (partial) ============
            console.log("--- TEST 4c: Decrease liquidity (partial) ---");
            {
                // Remove half the liquidity
                uint128 removeAmount = liq1 / 2;

                IV4Utils.DecreaseLiquidityParams memory decParams = IV4Utils.DecreaseLiquidityParams({
                    tokenId: tokenId1,
                    liquidity: removeAmount,
                    amount0Min: 0,
                    amount1Min: 0,
                    deadline: deadline
                });

                (uint256 got0, uint256 got1) = v4Utils.decreaseLiquidity(decParams);
                console.log("  Removed liquidity:", uint256(removeAmount));
                console.log("  ETH received:", got0);
                console.log("  USDC received:", got1);
                console.log("  SUCCESS");
                console.log("");
            }

            // ============ TEST 4d: Decrease all remaining (close position) ============
            console.log("--- TEST 4d: Close position (remove all) ---");
            {
                IV4Utils.DecreaseLiquidityParams memory closeParams = IV4Utils.DecreaseLiquidityParams({
                    tokenId: tokenId1,
                    liquidity: 0, // 0 means all
                    amount0Min: 0,
                    amount1Min: 0,
                    deadline: deadline
                });

                (uint256 final0, uint256 final1) = v4Utils.decreaseLiquidity(closeParams);
                console.log("  ETH received:", final0);
                console.log("  USDC received:", final1);
                console.log("  SUCCESS (position closed)");
                console.log("");
            }
        }

        // ============ TEST 2: USDC-only Zap into ETH/USDC ============
        console.log("--- TEST 2: Single-token (USDC) zap into ETH/USDC ---");
        {
            PoolKey memory poolKey = PoolKey({
                currency0: Currency.wrap(NATIVE_ETH),
                currency1: Currency.wrap(USDC),
                fee: 500,
                tickSpacing: 10,
                hooks: IHooks(address(0))
            });

            int24 tickLower = -887270;
            int24 tickUpper = 887270;

            // Zap with 1 USDC — provide it all as currency1, no swap needed for full range
            uint256 zapAmount = 1e6; // 1 USDC

            IV4Utils.SwapAndMintParams memory zapParams = IV4Utils.SwapAndMintParams({
                poolKey: poolKey,
                tickLower: tickLower,
                tickUpper: tickUpper,
                amount0Desired: 0,         // No ETH
                amount1Desired: zapAmount,  // All USDC
                amount0Max: 0,
                amount1Max: zapAmount * 110 / 100,
                recipient: deployer,
                deadline: deadline,
                swapSourceCurrency: Currency.wrap(address(0)),
                swapSourceAmount: 0,
                swapData: "",
                maxSwapSlippage: 0
            });

            (uint256 tokenId2, uint128 liq2, uint256 used0_2, uint256 used1_2) =
                v4Utils.swapAndMint(zapParams);

            console.log("  Token ID:", tokenId2);
            console.log("  Liquidity:", uint256(liq2));
            console.log("  ETH used:", used0_2);
            console.log("  USDC used:", used1_2);
            console.log("  SUCCESS");
            console.log("");

            // Close this position too
            IERC721(POSITION_MANAGER).approve(V4_UTILS, tokenId2);
            v4Utils.decreaseLiquidity(IV4Utils.DecreaseLiquidityParams({
                tokenId: tokenId2,
                liquidity: 0,
                amount0Min: 0,
                amount1Min: 0,
                deadline: deadline
            }));
            console.log("  Position closed");
            console.log("");
        }

        // ============ TEST 3: USDC/USDT Stablecoin Position ============
        console.log("--- TEST 3: USDC/USDT stablecoin position (fee=100) ---");
        {
            // USDC (0x833...) < USDT (0xfde...) → currency0=USDC, currency1=USDT
            PoolKey memory poolKey = PoolKey({
                currency0: Currency.wrap(USDC),
                currency1: Currency.wrap(USDT),
                fee: 100,
                tickSpacing: 1,
                hooks: IHooks(address(0))
            });

            // Approve USDT for V4Utils
            IERC20(USDT).approve(V4_UTILS, type(uint256).max);

            // Concentrated range around tick 14 (current tick)
            int24 tickLower = -100; // wider range for stablecoin
            int24 tickUpper = 100;

            // 0.5 USDC + 0 USDT (we have no USDT)
            uint256 usdcAmount = 0.5e6; // 0.5 USDC

            IV4Utils.SwapAndMintParams memory stableParams = IV4Utils.SwapAndMintParams({
                poolKey: poolKey,
                tickLower: tickLower,
                tickUpper: tickUpper,
                amount0Desired: usdcAmount,
                amount1Desired: 0,
                amount0Max: usdcAmount * 110 / 100,
                amount1Max: 0,
                recipient: deployer,
                deadline: deadline,
                swapSourceCurrency: Currency.wrap(address(0)),
                swapSourceAmount: 0,
                swapData: "",
                maxSwapSlippage: 0
            });

            (uint256 tokenId3, uint128 liq3, uint256 used0_3, uint256 used1_3) =
                v4Utils.swapAndMint(stableParams);

            console.log("  Token ID:", tokenId3);
            console.log("  Liquidity:", uint256(liq3));
            console.log("  USDC used:", used0_3);
            console.log("  USDT used:", used1_3);
            console.log("  SUCCESS");
            console.log("");

            // Close this position
            IERC721(POSITION_MANAGER).approve(V4_UTILS, tokenId3);
            v4Utils.decreaseLiquidity(IV4Utils.DecreaseLiquidityParams({
                tokenId: tokenId3,
                liquidity: 0,
                amount0Min: 0,
                amount1Min: 0,
                deadline: deadline
            }));
            console.log("  Position closed");
            console.log("");
        }

        vm.stopBroadcast();

        console.log("=== ALL TESTS PASSED ===");
    }
}

