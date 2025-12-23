// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import { Script, console } from "forge-std/Script.sol";
import { V4Compoundor } from "../src/automators/V4Compoundor.sol";

/// @title UpgradeCompoundorOnly
/// @notice Upgrade only the V4Compoundor to fix getPendingFees
contract UpgradeCompoundorOnly is Script {
    // Official Uniswap V4 Sepolia Addresses
    address constant POOL_MANAGER = 0xE03A1074c86CFeDd5C142C4F04F1a1536e203543;
    address constant POSITION_MANAGER = 0x429ba70129df741B2Ca2a85BC3A2a3328e5c09b4;
    address constant WETH = 0x7b79995e5f793A07Bc00c21412e50Ecae098E7f9;

    // Existing Sepolia proxy address
    address constant V4_COMPOUNDOR_PROXY = 0xBA8bc095e0BEA3C6B1C6F5FfB56F67AaD76914Ad;

    function run() public {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerPrivateKey);

        require(block.chainid == 11155111, "Must be on Sepolia");

        console.log("==============================================");
        console.log("  Upgrading V4Compoundor (getPendingFees fix)");
        console.log("==============================================");
        console.log("Deployer:", deployer);
        console.log("Balance:", deployer.balance);

        vm.startBroadcast(deployerPrivateKey);

        // Deploy new implementation with fixed getPendingFees
        console.log("\nDeploying new V4Compoundor implementation...");
        V4Compoundor newCompoundorImpl = new V4Compoundor(POOL_MANAGER, POSITION_MANAGER, WETH);
        console.log("New implementation: ", address(newCompoundorImpl));

        // Upgrade proxy
        console.log("\nUpgrading proxy...");
        V4Compoundor(payable(V4_COMPOUNDOR_PROXY)).upgradeToAndCall(
            address(newCompoundorImpl),
            ""
        );
        console.log("V4Compoundor proxy upgraded!");

        // Test the fix
        console.log("\nTesting getPendingFees for position 21449...");
        (uint256 fee0, uint256 fee1) = V4Compoundor(payable(V4_COMPOUNDOR_PROXY)).getPendingFees(21449);
        console.log("Fee0 (ETH):", fee0);
        console.log("Fee1 (USDC):", fee1);

        console.log("\n==============================================");
        console.log("  Upgrade Complete!");
        console.log("==============================================");
        console.log("Proxy address (unchanged): ", V4_COMPOUNDOR_PROXY);
        console.log("New implementation:        ", address(newCompoundorImpl));

        vm.stopBroadcast();
    }
}
