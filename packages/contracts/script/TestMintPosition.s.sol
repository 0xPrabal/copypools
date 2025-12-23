// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script} from "forge-std/Script.sol";
import {console} from "forge-std/console.sol";
import {IPoolManager} from "v4-core/interfaces/IPoolManager.sol";
import {PoolKey} from "v4-core/types/PoolKey.sol";
import {Currency} from "v4-core/types/Currency.sol";
import {IHooks} from "v4-core/interfaces/IHooks.sol";
import {IERC20} from "forge-std/interfaces/IERC20.sol";
import {V4Utils} from "../src/utils/V4Utils.sol";
import {IV4Utils} from "../src/interfaces/IV4Utils.sol";

contract TestMintPosition is Script {
    // Sepolia addresses
    address payable constant V4_UTILS = payable(0xff9C5B6F76444144a36de91F4d2F3289E37Cf956);
    address constant WETH = 0x7b79995e5f793A07Bc00c21412e50Ecae098E7f9;
    address constant USDC = 0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238;

    function run() external {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerPrivateKey);

        console.log("Testing position minting...");
        console.log("Deployer:", deployer);

        // Check balances
        uint256 wethBalance = IERC20(WETH).balanceOf(deployer);
        uint256 usdcBalance = IERC20(USDC).balanceOf(deployer);
        console.log("WETH balance:", wethBalance);
        console.log("USDC balance:", usdcBalance);

        vm.startBroadcast(deployerPrivateKey);

        // Approve tokens
        console.log("\nApproving tokens...");
        IERC20(WETH).approve(V4_UTILS, type(uint256).max);
        IERC20(USDC).approve(V4_UTILS, type(uint256).max);
        console.log("Tokens approved");

        // Sort currencies (USDC < WETH)
        Currency currency0 = Currency.wrap(USDC); // 0x1c7D...
        Currency currency1 = Currency.wrap(WETH); // 0x7b79...

        // Build pool key
        PoolKey memory poolKey = PoolKey({
            currency0: currency0,
            currency1: currency1,
            fee: 3000, // 0.30%
            tickSpacing: 60,
            hooks: IHooks(address(0))
        });

        // Build mint params
        IV4Utils.SwapAndMintParams memory params = IV4Utils.SwapAndMintParams({
            poolKey: poolKey,
            tickLower: -887200,
            tickUpper: 887200,
            amount0Desired: 0.1 ether, // 0.1 USDC (assuming 18 decimals for test)
            amount1Desired: 0.1 ether, // 0.1 WETH
            amount0Max: 0.11 ether,
            amount1Max: 0.11 ether,
            recipient: deployer,
            deadline: block.timestamp + 3600,
            swapSourceCurrency: Currency.wrap(address(0)),
            swapSourceAmount: 0,
            swapData: "",
            maxSwapSlippage: 0
        });

        console.log("\nMinting position...");
        console.log("Currency0 (USDC):", Currency.unwrap(currency0));
        console.log("Currency1 (WETH):", Currency.unwrap(currency1));
        console.log("Fee:", poolKey.fee);
        console.log("TickLower:", params.tickLower);
        console.log("TickUpper:", params.tickUpper);

        try V4Utils(V4_UTILS).swapAndMint(params) returns (
            uint256 tokenId,
            uint128 liquidity,
            uint256 amount0,
            uint256 amount1
        ) {
            console.log("\nSuccess!");
            console.log("Token ID:", tokenId);
            console.log("Liquidity:", liquidity);
            console.log("Amount0 used:", amount0);
            console.log("Amount1 used:", amount1);
        } catch Error(string memory reason) {
            console.log("\nFailed with reason:", reason);
        } catch (bytes memory lowLevelData) {
            console.log("\nFailed with low-level error");
            console.logBytes(lowLevelData);
        }

        vm.stopBroadcast();
    }
}
