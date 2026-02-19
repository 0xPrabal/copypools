// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import { Script, console } from "forge-std/Script.sol";
import { ERC1967Proxy } from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";

import { V4Utils } from "../src/utils/V4Utils.sol";
import { V4Compoundor } from "../src/automators/V4Compoundor.sol";
import { V4AutoRange } from "../src/automators/V4AutoRange.sol";
import { V4AutoExit } from "../src/automators/V4AutoExit.sol";
import { Addresses } from "../src/constants/Addresses.sol";

/// @title DeployScript
/// @notice Deploy all Revert V4 contracts (auto-detects chain)
contract DeployScript is Script {
    function run() public {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerPrivateKey);
        uint256 chainId = block.chainid;

        console.log("Deployer:", deployer);
        console.log("Chain ID:", chainId);
        console.log("Balance:", deployer.balance);

        // Get addresses for current chain
        address poolManager = Addresses.getPoolManager(chainId);
        address positionManager = Addresses.getPositionManager(chainId);
        address weth = Addresses.getWETH(chainId);

        console.log("\n=== Uniswap V4 Addresses ===");
        console.log("PoolManager:", poolManager);
        console.log("PositionManager:", positionManager);
        console.log("WETH:", weth);

        vm.startBroadcast(deployerPrivateKey);

        // Deploy V4Utils
        V4Utils v4UtilsImpl = new V4Utils(poolManager, positionManager, weth);
        ERC1967Proxy v4UtilsProxy = new ERC1967Proxy(
            address(v4UtilsImpl),
            abi.encodeWithSelector(V4Utils.initialize.selector, deployer)
        );
        V4Utils v4Utils = V4Utils(payable(address(v4UtilsProxy)));
        console.log("\nV4Utils deployed:", address(v4Utils));

        // Deploy V4Compoundor
        V4Compoundor compoundorImpl = new V4Compoundor(poolManager, positionManager, weth);
        ERC1967Proxy compoundorProxy = new ERC1967Proxy(
            address(compoundorImpl),
            abi.encodeWithSelector(V4Compoundor.initialize.selector, deployer)
        );
        V4Compoundor compoundor = V4Compoundor(payable(address(compoundorProxy)));
        console.log("V4Compoundor deployed:", address(compoundor));

        // Deploy V4AutoRange
        V4AutoRange autoRangeImpl = new V4AutoRange(poolManager, positionManager, weth);
        ERC1967Proxy autoRangeProxy = new ERC1967Proxy(
            address(autoRangeImpl),
            abi.encodeWithSelector(V4AutoRange.initialize.selector, deployer)
        );
        V4AutoRange autoRange = V4AutoRange(payable(address(autoRangeProxy)));
        console.log("V4AutoRange deployed:", address(autoRange));

        // Deploy V4AutoExit
        V4AutoExit autoExitImpl = new V4AutoExit(poolManager, positionManager, weth);
        ERC1967Proxy autoExitProxy = new ERC1967Proxy(
            address(autoExitImpl),
            abi.encodeWithSelector(V4AutoExit.initialize.selector, deployer)
        );
        V4AutoExit autoExit = V4AutoExit(payable(address(autoExitProxy)));
        console.log("V4AutoExit deployed:", address(autoExit));

        // Log deployment summary
        console.log("\n=== Deployment Summary ===");
        console.log("V4Utils:      ", address(v4Utils));
        console.log("V4Compoundor: ", address(compoundor));
        console.log("V4AutoRange:  ", address(autoRange));
        console.log("V4AutoExit:   ", address(autoExit));

        vm.stopBroadcast();
    }
}

/// @title DeploySepolia
/// @notice Deploy specifically to Sepolia testnet with official V4 addresses
contract DeploySepolia is Script {
    // ============ Official Uniswap V4 Sepolia Addresses ============
    address constant POOL_MANAGER = 0xE03A1074c86CFeDd5C142C4F04F1a1536e203543;
    address constant UNIVERSAL_ROUTER = 0x3A9D48AB9751398BbFa63ad67599Bb04e4BdF98b;
    address constant POSITION_MANAGER = 0x429ba70129df741B2Ca2a85BC3A2a3328e5c09b4;
    address constant STATE_VIEW = 0xE1Dd9c3fA50EDB962E442f60DfBc432e24537E4C;
    address constant QUOTER = 0x61B3f2011A92d183C7dbaDBdA940a7555Ccf9227;
    address constant PERMIT2 = 0x000000000022D473030F116dDEE9F6B43aC78BA3;

    // Sepolia WETH
    address constant WETH = 0x7b79995e5f793A07Bc00c21412e50Ecae098E7f9;

    function run() public {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerPrivateKey);

        require(block.chainid == 11155111, "Must be on Sepolia (chainId: 11155111)");

        console.log("==============================================");
        console.log("  Deploying Revert V4 to Sepolia Testnet");
        console.log("==============================================");
        console.log("Deployer:", deployer);
        console.log("Balance:", deployer.balance);
        console.log("\n=== Official Uniswap V4 Addresses ===");
        console.log("PoolManager:     ", POOL_MANAGER);
        console.log("PositionManager: ", POSITION_MANAGER);
        console.log("UniversalRouter: ", UNIVERSAL_ROUTER);
        console.log("StateView:       ", STATE_VIEW);
        console.log("Quoter:          ", QUOTER);
        console.log("Permit2:         ", PERMIT2);

        vm.startBroadcast(deployerPrivateKey);

        // Deploy V4Utils
        V4Utils v4UtilsImpl = new V4Utils(POOL_MANAGER, POSITION_MANAGER, WETH);
        ERC1967Proxy v4UtilsProxy = new ERC1967Proxy(
            address(v4UtilsImpl),
            abi.encodeWithSelector(V4Utils.initialize.selector, deployer)
        );
        V4Utils v4Utils = V4Utils(payable(address(v4UtilsProxy)));

        // Deploy V4Compoundor
        V4Compoundor compoundorImpl = new V4Compoundor(POOL_MANAGER, POSITION_MANAGER, WETH);
        ERC1967Proxy compoundorProxy = new ERC1967Proxy(
            address(compoundorImpl),
            abi.encodeWithSelector(V4Compoundor.initialize.selector, deployer)
        );
        V4Compoundor compoundor = V4Compoundor(payable(address(compoundorProxy)));

        // Deploy V4AutoRange
        V4AutoRange autoRangeImpl = new V4AutoRange(POOL_MANAGER, POSITION_MANAGER, WETH);
        ERC1967Proxy autoRangeProxy = new ERC1967Proxy(
            address(autoRangeImpl),
            abi.encodeWithSelector(V4AutoRange.initialize.selector, deployer)
        );
        V4AutoRange autoRange = V4AutoRange(payable(address(autoRangeProxy)));

        // Deploy V4AutoExit
        V4AutoExit autoExitImpl = new V4AutoExit(POOL_MANAGER, POSITION_MANAGER, WETH);
        ERC1967Proxy autoExitProxy = new ERC1967Proxy(
            address(autoExitImpl),
            abi.encodeWithSelector(V4AutoExit.initialize.selector, deployer)
        );
        V4AutoExit autoExit = V4AutoExit(payable(address(autoExitProxy)));

        // Approve Universal Router on all contracts
        v4Utils.setRouterApproval(UNIVERSAL_ROUTER, true);
        compoundor.setRouterApproval(UNIVERSAL_ROUTER, true);
        autoRange.setRouterApproval(UNIVERSAL_ROUTER, true);
        autoExit.setRouterApproval(UNIVERSAL_ROUTER, true);

        console.log("\n==============================================");
        console.log("  Sepolia Deployment Complete!");
        console.log("==============================================");
        console.log("V4Utils:      ", address(v4Utils));
        console.log("V4Compoundor: ", address(compoundor));
        console.log("V4AutoRange:  ", address(autoRange));
        console.log("V4AutoExit:   ", address(autoExit));
        console.log("\nUniversal Router approved on all contracts");

        vm.stopBroadcast();
    }
}

/// @title DeployBase
/// @notice Deploy specifically to Base mainnet with official V4 addresses
contract DeployBase is Script {
    // ============ Official Uniswap V4 Base Mainnet Addresses ============
    address constant POOL_MANAGER = 0x498581fF718922c3f8e6A244956aF099B2652b2b;
    address constant UNIVERSAL_ROUTER = 0x6fF5693b99212Da76ad316178A184AB56D299b43;
    address constant POSITION_MANAGER = 0x7C5f5A4bBd8fD63184577525326123B519429bDc;
    address constant POSITION_DESCRIPTOR = 0x25D093633990DC94BeDEeD76C8F3CDaa75f3E7D5;
    address constant STATE_VIEW = 0xA3c0c9b65baD0b08107Aa264b0f3dB444b867A71;
    address constant QUOTER = 0x0d5e0F971ED27FBfF6c2837bf31316121532048D;
    address constant PERMIT2 = 0x000000000022D473030F116dDEE9F6B43aC78BA3;

    // Base WETH (Wrapped ETH on Base)
    address constant WETH = 0x4200000000000000000000000000000000000006;

    function run() public {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerPrivateKey);

        require(block.chainid == 8453, "Must be on Base mainnet (chainId: 8453)");

        console.log("==============================================");
        console.log("  Deploying Revert V4 to Base Mainnet");
        console.log("==============================================");
        console.log("Deployer:", deployer);
        console.log("Balance:", deployer.balance);
        console.log("\n=== Official Uniswap V4 Addresses ===");
        console.log("PoolManager:     ", POOL_MANAGER);
        console.log("PositionManager: ", POSITION_MANAGER);
        console.log("UniversalRouter: ", UNIVERSAL_ROUTER);
        console.log("StateView:       ", STATE_VIEW);
        console.log("Quoter:          ", QUOTER);
        console.log("Permit2:         ", PERMIT2);

        vm.startBroadcast(deployerPrivateKey);

        // Deploy V4Utils
        V4Utils v4UtilsImpl = new V4Utils(POOL_MANAGER, POSITION_MANAGER, WETH);
        ERC1967Proxy v4UtilsProxy = new ERC1967Proxy(
            address(v4UtilsImpl),
            abi.encodeWithSelector(V4Utils.initialize.selector, deployer)
        );
        V4Utils v4Utils = V4Utils(payable(address(v4UtilsProxy)));

        // Deploy V4Compoundor
        V4Compoundor compoundorImpl = new V4Compoundor(POOL_MANAGER, POSITION_MANAGER, WETH);
        ERC1967Proxy compoundorProxy = new ERC1967Proxy(
            address(compoundorImpl),
            abi.encodeWithSelector(V4Compoundor.initialize.selector, deployer)
        );
        V4Compoundor compoundor = V4Compoundor(payable(address(compoundorProxy)));

        // Deploy V4AutoRange
        V4AutoRange autoRangeImpl = new V4AutoRange(POOL_MANAGER, POSITION_MANAGER, WETH);
        ERC1967Proxy autoRangeProxy = new ERC1967Proxy(
            address(autoRangeImpl),
            abi.encodeWithSelector(V4AutoRange.initialize.selector, deployer)
        );
        V4AutoRange autoRange = V4AutoRange(payable(address(autoRangeProxy)));

        // Deploy V4AutoExit
        V4AutoExit autoExitImpl = new V4AutoExit(POOL_MANAGER, POSITION_MANAGER, WETH);
        ERC1967Proxy autoExitProxy = new ERC1967Proxy(
            address(autoExitImpl),
            abi.encodeWithSelector(V4AutoExit.initialize.selector, deployer)
        );
        V4AutoExit autoExit = V4AutoExit(payable(address(autoExitProxy)));

        // Approve Universal Router on all contracts
        v4Utils.setRouterApproval(UNIVERSAL_ROUTER, true);
        compoundor.setRouterApproval(UNIVERSAL_ROUTER, true);
        autoRange.setRouterApproval(UNIVERSAL_ROUTER, true);
        autoExit.setRouterApproval(UNIVERSAL_ROUTER, true);

        console.log("\n==============================================");
        console.log("  Base Mainnet Deployment Complete!");
        console.log("==============================================");
        console.log("V4Utils:      ", address(v4Utils));
        console.log("V4Compoundor: ", address(compoundor));
        console.log("V4AutoRange:  ", address(autoRange));
        console.log("V4AutoExit:   ", address(autoExit));
        console.log("\nUniversal Router approved on all contracts");

        vm.stopBroadcast();
    }
}

/// @title ConfigureRouters
/// @notice Configure approved swap routers on all contracts
contract ConfigureRouters is Script {
    function run() public {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");

        address v4Utils = vm.envAddress("V4_UTILS");
        address compoundor = vm.envAddress("V4_COMPOUNDOR");
        address autoRange = vm.envAddress("V4_AUTO_RANGE");
        address autoExit = vm.envAddress("V4_AUTO_EXIT");

        // Universal router for the chain
        address universalRouter = Addresses.getUniversalRouter(block.chainid);

        console.log("Configuring routers...");
        console.log("Universal Router:", universalRouter);

        vm.startBroadcast(deployerPrivateKey);

        // Approve Universal Router on all contracts
        V4Utils(payable(v4Utils)).setRouterApproval(universalRouter, true);
        V4Compoundor(payable(compoundor)).setRouterApproval(universalRouter, true);
        V4AutoRange(payable(autoRange)).setRouterApproval(universalRouter, true);
        V4AutoExit(payable(autoExit)).setRouterApproval(universalRouter, true);

        // Also approve 0x and 1inch if on mainnet
        if (block.chainid == 1) {
            V4Utils(payable(v4Utils)).setRouterApproval(Addresses.ZEROX_EXCHANGE_PROXY, true);
            V4Utils(payable(v4Utils)).setRouterApproval(Addresses.ONEINCH_ROUTER_V6, true);

            V4Compoundor(payable(compoundor)).setRouterApproval(Addresses.ZEROX_EXCHANGE_PROXY, true);
            V4Compoundor(payable(compoundor)).setRouterApproval(Addresses.ONEINCH_ROUTER_V6, true);

            V4AutoRange(payable(autoRange)).setRouterApproval(Addresses.ZEROX_EXCHANGE_PROXY, true);
            V4AutoRange(payable(autoRange)).setRouterApproval(Addresses.ONEINCH_ROUTER_V6, true);

            V4AutoExit(payable(autoExit)).setRouterApproval(Addresses.ZEROX_EXCHANGE_PROXY, true);
            V4AutoExit(payable(autoExit)).setRouterApproval(Addresses.ONEINCH_ROUTER_V6, true);
        }

        console.log("Routers configured successfully");

        vm.stopBroadcast();
    }
}

/// @title SetOperators
/// @notice Configure operator addresses for automation bots
contract SetOperators is Script {
    function run() public {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");

        address compoundor = vm.envAddress("V4_COMPOUNDOR");
        address autoRange = vm.envAddress("V4_AUTO_RANGE");
        address autoExit = vm.envAddress("V4_AUTO_EXIT");
        address operator = vm.envAddress("OPERATOR");

        console.log("Setting operator:", operator);

        vm.startBroadcast(deployerPrivateKey);

        V4Compoundor(payable(compoundor)).setOperatorApproval(operator, true);
        V4AutoRange(payable(autoRange)).setOperatorApproval(operator, true);
        V4AutoExit(payable(autoExit)).setOperatorApproval(operator, true);

        console.log("Operator configured successfully");

        vm.stopBroadcast();
    }
}
