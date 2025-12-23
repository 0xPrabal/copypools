// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script} from "forge-std/Script.sol";
import {console} from "forge-std/console.sol";
import {IPoolManager} from "v4-core/interfaces/IPoolManager.sol";
import {PoolKey} from "v4-core/types/PoolKey.sol";
import {Currency} from "v4-core/types/Currency.sol";
import {IHooks} from "v4-core/interfaces/IHooks.sol";
import {PoolId, PoolIdLibrary} from "v4-core/types/PoolId.sol";

contract InitializePools is Script {
    using PoolIdLibrary for PoolKey;

    // Sepolia addresses (Official Uniswap V4 PoolManager)
    IPoolManager constant POOL_MANAGER = IPoolManager(0xE03A1074c86CFeDd5C142C4F04F1a1536e203543);

    // Tokens
    address constant WETH = 0x7b79995e5f793A07Bc00c21412e50Ecae098E7f9;
    address constant USDC = 0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238;
    address constant DAI = 0x68194a729C2450ad26072b3D33ADaCbcef39D574;

    // sqrtPriceX96 for 1:1 price = sqrt(1) * 2^96
    uint160 constant SQRT_PRICE_1_1 = 79228162514264337593543950336;

    function run() external {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        vm.startBroadcast(deployerPrivateKey);

        console.log("Initializing pools...");

        // Initialize WETH/USDC pools
        initializePool(WETH, USDC, 500);   // 0.05%
        initializePool(WETH, USDC, 3000);  // 0.30%
        initializePool(WETH, USDC, 10000); // 1.00%

        // Initialize WETH/DAI pools
        initializePool(WETH, DAI, 500);
        initializePool(WETH, DAI, 3000);
        initializePool(WETH, DAI, 10000);

        // Initialize USDC/DAI pools
        initializePool(USDC, DAI, 500);
        initializePool(USDC, DAI, 3000);
        initializePool(USDC, DAI, 10000);

        vm.stopBroadcast();
        console.log("All pools initialized!");
    }

    function initializePool(address token0, address token1, uint24 fee) internal {
        // Sort currencies
        (Currency currency0, Currency currency1) = token0 < token1
            ? (Currency.wrap(token0), Currency.wrap(token1))
            : (Currency.wrap(token1), Currency.wrap(token0));

        // Determine tick spacing
        int24 tickSpacing = fee == 500 ? int24(10) : fee == 3000 ? int24(60) : int24(200);

        PoolKey memory key = PoolKey({
            currency0: currency0,
            currency1: currency1,
            fee: fee,
            tickSpacing: tickSpacing,
            hooks: IHooks(address(0))
        });

        console.log("Initializing pool:");
        console.log("  Currency0:", Currency.unwrap(currency0));
        console.log("  Currency1:", Currency.unwrap(currency1));
        console.log("  Fee:", fee);

        try POOL_MANAGER.initialize(key, SQRT_PRICE_1_1) returns (int24 tick) {
            console.log("  Success! Tick:", tick);
        } catch Error(string memory reason) {
            console.log("  Failed:", reason);
        } catch (bytes memory lowLevelData) {
            console.log("  Failed: Pool may already be initialized");
        }
    }
}
