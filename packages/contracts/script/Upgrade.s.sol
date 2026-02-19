// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import { Script, console } from "forge-std/Script.sol";
import { UUPSUpgradeable } from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";

import { V4Utils } from "../src/utils/V4Utils.sol";
import { V4Compoundor } from "../src/automators/V4Compoundor.sol";
import { V4AutoRange } from "../src/automators/V4AutoRange.sol";
import { V4AutoExit } from "../src/automators/V4AutoExit.sol";
import { Addresses } from "../src/constants/Addresses.sol";

/// @title UpgradeScript
/// @notice Upgrade existing UUPS proxies with new implementations
/// @dev Use this to upgrade contracts with SlippageCheck integration
contract UpgradeScript is Script {
    function run() public {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        uint256 chainId = block.chainid;

        address poolManager = Addresses.getPoolManager(chainId);
        address positionManager = Addresses.getPositionManager(chainId);
        address weth = Addresses.getWETH(chainId);

        // Existing proxy addresses
        address v4UtilsProxy = vm.envAddress("V4_UTILS");
        address v4CompoundorProxy = vm.envAddress("V4_COMPOUNDOR");
        address v4AutoRangeProxy = vm.envAddress("V4_AUTO_RANGE");

        console.log("==============================================");
        console.log("  Upgrading UUPS Proxies");
        console.log("==============================================");
        console.log("Chain ID:", chainId);
        console.log("\nExisting Proxies:");
        console.log("V4Utils:      ", v4UtilsProxy);
        console.log("V4Compoundor: ", v4CompoundorProxy);
        console.log("V4AutoRange:  ", v4AutoRangeProxy);

        vm.startBroadcast(deployerPrivateKey);

        // Deploy new implementations
        console.log("\nDeploying new implementations...");
        V4Utils newV4UtilsImpl = new V4Utils(poolManager, positionManager, weth);
        V4Compoundor newCompoundorImpl = new V4Compoundor(poolManager, positionManager, weth);
        V4AutoRange newAutoRangeImpl = new V4AutoRange(poolManager, positionManager, weth);

        console.log("\nNew Implementations:");
        console.log("V4Utils Impl:      ", address(newV4UtilsImpl));
        console.log("V4Compoundor Impl: ", address(newCompoundorImpl));
        console.log("V4AutoRange Impl:  ", address(newAutoRangeImpl));

        // Upgrade proxies
        console.log("\nUpgrading proxies...");

        V4Utils(payable(v4UtilsProxy)).upgradeToAndCall(
            address(newV4UtilsImpl),
            ""
        );
        console.log("V4Utils upgraded");

        V4Compoundor(payable(v4CompoundorProxy)).upgradeToAndCall(
            address(newCompoundorImpl),
            ""
        );
        console.log("V4Compoundor upgraded");

        V4AutoRange(payable(v4AutoRangeProxy)).upgradeToAndCall(
            address(newAutoRangeImpl),
            ""
        );
        console.log("V4AutoRange upgraded");

        console.log("\n==============================================");
        console.log("  Upgrade Complete!");
        console.log("==============================================");
        console.log("Proxy addresses remain the same");
        console.log("New implementations deployed with SlippageCheck");

        vm.stopBroadcast();
    }
}

/// @title UpgradeSepolia
/// @notice Upgrade Sepolia testnet proxies
contract UpgradeSepolia is Script {
    // Official Uniswap V4 Sepolia Addresses
    address constant POOL_MANAGER = 0xE03A1074c86CFeDd5C142C4F04F1a1536e203543;
    address constant POSITION_MANAGER = 0x429ba70129df741B2Ca2a85BC3A2a3328e5c09b4;
    address constant WETH = 0x7b79995e5f793A07Bc00c21412e50Ecae098E7f9;

    // Existing Sepolia proxy addresses
    address constant V4_UTILS_PROXY = 0xff9C5B6F76444144a36de91F4d2F3289E37Cf956;
    address constant V4_COMPOUNDOR_PROXY = 0xBA8bc095e0BEA3C6B1C6F5FfB56F67AaD76914Ad;
    address constant V4_AUTO_RANGE_PROXY = 0xD6e1ED971f2A83EB94dDC0Ceb6841D6D7628EEfD;

    function run() public {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerPrivateKey);

        require(block.chainid == 11155111, "Must be on Sepolia");

        console.log("==============================================");
        console.log("  Upgrading Sepolia Proxies");
        console.log("  SlippageCheck Integration");
        console.log("==============================================");
        console.log("Deployer:", deployer);
        console.log("Balance:", deployer.balance);

        vm.startBroadcast(deployerPrivateKey);

        // Deploy new implementations with SlippageCheck
        console.log("\nDeploying new implementations...");
        V4Utils newV4UtilsImpl = new V4Utils(POOL_MANAGER, POSITION_MANAGER, WETH);
        V4Compoundor newCompoundorImpl = new V4Compoundor(POOL_MANAGER, POSITION_MANAGER, WETH);
        V4AutoRange newAutoRangeImpl = new V4AutoRange(POOL_MANAGER, POSITION_MANAGER, WETH);

        console.log("\nNew Implementations Deployed:");
        console.log("V4Utils:      ", address(newV4UtilsImpl));
        console.log("V4Compoundor: ", address(newCompoundorImpl));
        console.log("V4AutoRange:  ", address(newAutoRangeImpl));

        // Upgrade proxies
        console.log("\nUpgrading proxies...");

        V4Utils(payable(V4_UTILS_PROXY)).upgradeToAndCall(
            address(newV4UtilsImpl),
            ""
        );
        console.log("V4Utils proxy upgraded");

        V4Compoundor(payable(V4_COMPOUNDOR_PROXY)).upgradeToAndCall(
            address(newCompoundorImpl),
            ""
        );
        console.log("V4Compoundor proxy upgraded");

        V4AutoRange(payable(V4_AUTO_RANGE_PROXY)).upgradeToAndCall(
            address(newAutoRangeImpl),
            ""
        );
        console.log("V4AutoRange proxy upgraded");

        console.log("\n==============================================");
        console.log("  Sepolia Upgrade Complete!");
        console.log("==============================================");
        console.log("\nProxy Addresses (unchanged):");
        console.log("V4Utils:      ", V4_UTILS_PROXY);
        console.log("V4Compoundor: ", V4_COMPOUNDOR_PROXY);
        console.log("V4AutoRange:  ", V4_AUTO_RANGE_PROXY);
        console.log("\nNew Implementation Addresses:");
        console.log("V4Utils Impl:      ", address(newV4UtilsImpl));
        console.log("V4Compoundor Impl: ", address(newCompoundorImpl));
        console.log("V4AutoRange Impl:  ", address(newAutoRangeImpl));
        console.log("\nAll contracts now use SlippageCheck library");

        vm.stopBroadcast();
    }
}

/// @title UpgradeBase
/// @notice Upgrade Base Mainnet proxies — audit fixes (H-02, H-03, M-04, M-05, L-04, L-05, L-07)
contract UpgradeBase is Script {
    // Official Uniswap V4 Base Mainnet Addresses
    address constant POOL_MANAGER = 0x498581fF718922c3f8e6A244956aF099B2652b2b;
    address constant POSITION_MANAGER = 0x7C5f5A4bBd8fD63184577525326123B519429bDc;
    address constant WETH = 0x4200000000000000000000000000000000000006;

    // Current Base Mainnet proxy addresses (Feb 19, 2026 deployment)
    address constant V4_UTILS_PROXY = 0x8d81Bb4daA4c8D6ad99a741d1E7C9563EAFda423;
    address constant V4_COMPOUNDOR_PROXY = 0x2056eDc7590B42b5464f357589810fA3441216E3;
    address constant V4_AUTO_RANGE_PROXY = 0xB6E684266259d172a8CC85F524ab2E845886242b;
    address constant V4_AUTO_EXIT_PROXY = 0xb9ab855339036df10790728A773dD3a8c9e538B0;

    function run() public {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerPrivateKey);

        require(block.chainid == 8453, "Must be on Base Mainnet");

        console.log("==============================================");
        console.log("  Upgrading Base Mainnet Proxies");
        console.log("  Audit Fixes: H-02, H-03, M-04, M-05,");
        console.log("               L-04, L-05, L-07");
        console.log("==============================================");
        console.log("Deployer:", deployer);
        console.log("Balance:", deployer.balance);

        vm.startBroadcast(deployerPrivateKey);

        // Deploy new implementations
        console.log("\nDeploying new implementations...");
        V4Utils newV4UtilsImpl = new V4Utils(POOL_MANAGER, POSITION_MANAGER, WETH);
        V4Compoundor newCompoundorImpl = new V4Compoundor(POOL_MANAGER, POSITION_MANAGER, WETH);
        V4AutoRange newAutoRangeImpl = new V4AutoRange(POOL_MANAGER, POSITION_MANAGER, WETH);
        V4AutoExit newAutoExitImpl = new V4AutoExit(POOL_MANAGER, POSITION_MANAGER, WETH);

        console.log("\nNew Implementations Deployed:");
        console.log("V4Utils:      ", address(newV4UtilsImpl));
        console.log("V4Compoundor: ", address(newCompoundorImpl));
        console.log("V4AutoRange:  ", address(newAutoRangeImpl));
        console.log("V4AutoExit:   ", address(newAutoExitImpl));

        // Upgrade proxies
        console.log("\nUpgrading proxies...");

        V4Utils(payable(V4_UTILS_PROXY)).upgradeToAndCall(
            address(newV4UtilsImpl),
            ""
        );
        console.log("V4Utils proxy upgraded");

        V4Compoundor(payable(V4_COMPOUNDOR_PROXY)).upgradeToAndCall(
            address(newCompoundorImpl),
            ""
        );
        console.log("V4Compoundor proxy upgraded");

        V4AutoRange(payable(V4_AUTO_RANGE_PROXY)).upgradeToAndCall(
            address(newAutoRangeImpl),
            ""
        );
        console.log("V4AutoRange proxy upgraded");

        V4AutoExit(payable(V4_AUTO_EXIT_PROXY)).upgradeToAndCall(
            address(newAutoExitImpl),
            ""
        );
        console.log("V4AutoExit proxy upgraded");

        console.log("\n==============================================");
        console.log("  Base Mainnet Upgrade Complete!");
        console.log("==============================================");
        console.log("\nProxy Addresses (unchanged):");
        console.log("V4Utils:      ", V4_UTILS_PROXY);
        console.log("V4Compoundor: ", V4_COMPOUNDOR_PROXY);
        console.log("V4AutoRange:  ", V4_AUTO_RANGE_PROXY);
        console.log("V4AutoExit:   ", V4_AUTO_EXIT_PROXY);
        console.log("\nNew Implementation Addresses:");
        console.log("V4Utils Impl:      ", address(newV4UtilsImpl));
        console.log("V4Compoundor Impl: ", address(newCompoundorImpl));
        console.log("V4AutoRange Impl:  ", address(newAutoRangeImpl));
        console.log("V4AutoExit Impl:   ", address(newAutoExitImpl));

        vm.stopBroadcast();
    }
}
