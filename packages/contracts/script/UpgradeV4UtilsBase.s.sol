// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import { Script, console } from "forge-std/Script.sol";
import { V4Utils } from "../src/utils/V4Utils.sol";

/// @title UpgradeV4UtilsBase
/// @notice Upgrade V4Utils proxy on Base Mainnet - fixes WETH unwrap in SwapLib for single-token zap
contract UpgradeV4UtilsBase is Script {
    // Official Uniswap V4 Base Mainnet Addresses
    address constant POOL_MANAGER = 0x498581fF718922c3f8e6A244956aF099B2652b2b;
    address constant POSITION_MANAGER = 0x7C5f5A4bBd8fD63184577525326123B519429bDc;
    address constant WETH = 0x4200000000000000000000000000000000000006;

    // Existing Base Mainnet proxy address
    address constant V4_UTILS_PROXY = 0x37A199B0Baea8943AD493f04Cc2da8c4fa7C2cE1;

    function run() public {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerPrivateKey);

        require(block.chainid == 8453, "Must be on Base Mainnet");

        console.log("==============================================");
        console.log("  Upgrading V4Utils on Base Mainnet");
        console.log("  Fix: WETH unwrap in SwapLib for single-token zap");
        console.log("==============================================");
        console.log("Deployer:", deployer);
        console.log("Balance:", deployer.balance);

        vm.startBroadcast(deployerPrivateKey);

        // Deploy new V4Utils implementation
        console.log("\nDeploying new V4Utils implementation...");
        V4Utils newV4UtilsImpl = new V4Utils(POOL_MANAGER, POSITION_MANAGER, WETH);
        console.log("New V4Utils Implementation:", address(newV4UtilsImpl));

        // Upgrade proxy
        console.log("\nUpgrading V4Utils proxy...");
        V4Utils(payable(V4_UTILS_PROXY)).upgradeToAndCall(
            address(newV4UtilsImpl),
            ""
        );
        console.log("V4Utils proxy upgraded!");

        console.log("\n==============================================");
        console.log("  Base Mainnet V4Utils Upgrade Complete!");
        console.log("==============================================");
        console.log("\nProxy Address (unchanged):", V4_UTILS_PROXY);
        console.log("New Implementation:", address(newV4UtilsImpl));
        console.log("\nFix Applied:");
        console.log("- SwapLib now unwraps WETH to native ETH when target is native");
        console.log("- Fixes single-token zap (USDC -> ETH/USDC position)");

        vm.stopBroadcast();
    }
}
