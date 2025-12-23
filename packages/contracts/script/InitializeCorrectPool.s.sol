// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script} from "forge-std/Script.sol";
import {console} from "forge-std/console.sol";
import {IPoolManager} from "v4-core/interfaces/IPoolManager.sol";
import {PoolKey} from "v4-core/types/PoolKey.sol";
import {Currency} from "v4-core/types/Currency.sol";
import {IHooks} from "v4-core/interfaces/IHooks.sol";
import {PoolId, PoolIdLibrary} from "v4-core/types/PoolId.sol";

/**
 * @title InitializeCorrectPool
 * @notice Initialize WETH/USDC 1.00% pool with CORRECT price
 *
 * Corrects the decimal mismatch issue:
 * - USDC has 6 decimals
 * - WETH has 18 decimals
 * - Target price: 1 WETH = 2500 USDC
 * - sqrtPriceX96 = 1584563250149434761522526446544
 */
contract InitializeCorrectPool is Script {
    using PoolIdLibrary for PoolKey;

    // Sepolia addresses
    IPoolManager constant POOL_MANAGER = IPoolManager(0xE03A1074c86CFeDd5C142C4F04F1a1536e203543);
    address constant WETH = 0x7b79995e5f793A07Bc00c21412e50Ecae098E7f9;
    address constant USDC = 0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238;

    // CORRECT sqrtPriceX96 for 1 WETH = 2500 USDC (accounting for decimals)
    // Calculated as: sqrt((10^18 / (2500 * 10^6))) * 2^96
    uint160 constant SQRT_PRICE_CORRECT = 1584563250149434761522526446544;

    function run() external {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        vm.startBroadcast(deployerPrivateKey);

        console.log("=== Initializing CORRECT WETH/USDC Pool ===");
        console.log("Target: 1 WETH = 2500 USDC");
        console.log("sqrtPriceX96:", SQRT_PRICE_CORRECT);
        console.log("");

        // Sort currencies (USDC < WETH)
        Currency currency0 = Currency.wrap(USDC);
        Currency currency1 = Currency.wrap(WETH);

        // Use 1.00% fee tier (which is not initialized yet)
        uint24 fee = 10000;
        int24 tickSpacing = 200;

        PoolKey memory key = PoolKey({
            currency0: currency0,
            currency1: currency1,
            fee: fee,
            tickSpacing: tickSpacing,
            hooks: IHooks(address(0))
        });

        PoolId poolId = key.toId();

        console.log("Pool Configuration:");
        console.log("  Currency0 (USDC):", Currency.unwrap(currency0));
        console.log("  Currency1 (WETH):", Currency.unwrap(currency1));
        console.log("  Fee: 1.00% (10000)");
        console.log("  Tick Spacing:", uint256(uint24(tickSpacing)));
        console.log("  Pool ID:");
        console.logBytes32(PoolId.unwrap(poolId));
        console.log("");

        try POOL_MANAGER.initialize(key, SQRT_PRICE_CORRECT) returns (int24 tick) {
            console.log("SUCCESS!");
            console.log("Pool initialized at tick:", tick);
            console.log("");
            console.log("Expected tick: around -200000 to -160000");
            console.log("(Actual calculation: log_1.0001(2500^2 * 10^-12))");
        } catch Error(string memory reason) {
            console.log("FAILED:", reason);
        } catch (bytes memory) {
            console.log("FAILED: Pool may already be initialized or other error");
        }

        vm.stopBroadcast();
    }
}
