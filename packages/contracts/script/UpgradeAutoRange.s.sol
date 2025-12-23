// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import { Script, console } from "forge-std/Script.sol";
import { V4AutoRange } from "../src/automators/V4AutoRange.sol";

/// @title UpgradeAutoRange
/// @notice Upgrade V4AutoRange to v1.2.0 - fixes range calculation after internal swap
contract UpgradeAutoRange is Script {
    // Official Uniswap V4 Sepolia Addresses
    address constant POOL_MANAGER = 0xE03A1074c86CFeDd5C142C4F04F1a1536e203543;
    address constant POSITION_MANAGER = 0x429ba70129df741B2Ca2a85BC3A2a3328e5c09b4;
    address constant WETH = 0x7b79995e5f793A07Bc00c21412e50Ecae098E7f9;

    // Existing Sepolia proxy address
    address constant V4_AUTO_RANGE_PROXY = 0xD6e1ED971f2A83EB94dDC0Ceb6841D6D7628EEfD;

    function run() public {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerPrivateKey);

        require(block.chainid == 11155111, "Must be on Sepolia");

        console.log("==============================================");
        console.log("  Upgrading V4AutoRange to v1.2.0");
        console.log("  Fix: Recalculate range after internal swap");
        console.log("==============================================");
        console.log("Deployer:", deployer);
        console.log("Balance:", deployer.balance / 1e15, "mETH");
        console.log("Proxy:", V4_AUTO_RANGE_PROXY);

        // Check current version
        string memory currentVersion = V4AutoRange(payable(V4_AUTO_RANGE_PROXY)).VERSION();
        console.log("Current Version:", currentVersion);

        vm.startBroadcast(deployerPrivateKey);

        // Deploy new implementation with internal swap support
        console.log("\nDeploying new V4AutoRange implementation...");
        V4AutoRange newAutoRangeImpl = new V4AutoRange(POOL_MANAGER, POSITION_MANAGER, WETH);

        console.log("New Implementation:", address(newAutoRangeImpl));

        // Upgrade proxy
        console.log("\nUpgrading proxy...");
        V4AutoRange(payable(V4_AUTO_RANGE_PROXY)).upgradeToAndCall(
            address(newAutoRangeImpl),
            ""
        );

        vm.stopBroadcast();

        // Verify upgrade
        string memory newVersion = V4AutoRange(payable(V4_AUTO_RANGE_PROXY)).VERSION();
        console.log("\n==============================================");
        console.log("  Upgrade Complete!");
        console.log("==============================================");
        console.log("Proxy Address (unchanged):", V4_AUTO_RANGE_PROXY);
        console.log("New Implementation:", address(newAutoRangeImpl));
        console.log("New Version:", newVersion);
        console.log("\nV4AutoRange v1.2.0 now correctly recalculates range after swap!");
        console.log("Positions will be IN RANGE after rebalancing.");
    }
}
