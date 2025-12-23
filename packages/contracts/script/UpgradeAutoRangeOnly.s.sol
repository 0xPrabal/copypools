// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import { Script, console } from "forge-std/Script.sol";

import { V4AutoRange } from "../src/automators/V4AutoRange.sol";

/// @title UpgradeAutoRangeOnly
/// @notice Upgrade only the V4AutoRange contract to fix fee collection issue
contract UpgradeAutoRangeOnly is Script {
    // Official Uniswap V4 Sepolia Addresses
    address constant POOL_MANAGER = 0xE03A1074c86CFeDd5C142C4F04F1a1536e203543;
    address constant POSITION_MANAGER = 0x429ba70129df741B2Ca2a85BC3A2a3328e5c09b4;
    address constant WETH = 0x7b79995e5f793A07Bc00c21412e50Ecae098E7f9;

    // Existing V4AutoRange proxy
    address constant V4_AUTO_RANGE_PROXY = 0xD6e1ED971f2A83EB94dDC0Ceb6841D6D7628EEfD;

    function run() public {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerPrivateKey);

        require(block.chainid == 11155111, "Must be on Sepolia");

        console.log("==============================================");
        console.log("  Upgrading V4AutoRange Only");
        console.log("  Fix: Handle fee collection failures");
        console.log("==============================================");
        console.log("Deployer:", deployer);
        console.log("Balance:", deployer.balance);
        console.log("Proxy Address:", V4_AUTO_RANGE_PROXY);

        vm.startBroadcast(deployerPrivateKey);

        // Deploy new implementation with fee collection fix
        console.log("\nDeploying new V4AutoRange implementation...");
        V4AutoRange newAutoRangeImpl = new V4AutoRange(POOL_MANAGER, POSITION_MANAGER, WETH);
        console.log("New Implementation:", address(newAutoRangeImpl));

        // Upgrade proxy
        console.log("\nUpgrading proxy...");
        V4AutoRange(payable(V4_AUTO_RANGE_PROXY)).upgradeToAndCall(
            address(newAutoRangeImpl),
            ""
        );
        console.log("V4AutoRange proxy upgraded!");

        console.log("\n==============================================");
        console.log("  Upgrade Complete!");
        console.log("==============================================");
        console.log("Proxy Address (unchanged):", V4_AUTO_RANGE_PROXY);
        console.log("New Implementation:", address(newAutoRangeImpl));
        console.log("\nFix: Fee collection now wrapped in try-catch");
        console.log("Rebalance will work even if no fees to collect");

        vm.stopBroadcast();
    }
}
