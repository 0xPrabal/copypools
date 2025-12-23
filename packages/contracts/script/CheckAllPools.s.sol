// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script} from "forge-std/Script.sol";
import {console} from "forge-std/console.sol";
import {IPoolManager} from "v4-core/interfaces/IPoolManager.sol";
import {PoolKey} from "v4-core/types/PoolKey.sol";
import {Currency} from "v4-core/types/Currency.sol";
import {IHooks} from "v4-core/interfaces/IHooks.sol";
import {PoolId, PoolIdLibrary} from "v4-core/types/PoolId.sol";
import {StateLibrary} from "v4-core/libraries/StateLibrary.sol";

contract CheckAllPools is Script {
    using PoolIdLibrary for PoolKey;
    using StateLibrary for IPoolManager;

    IPoolManager constant POOL_MANAGER = IPoolManager(0xE03A1074c86CFeDd5C142C4F04F1a1536e203543);
    address constant WETH = 0x7b79995e5f793A07Bc00c21412e50Ecae098E7f9;
    address constant USDC = 0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238;

    function run() external view {
        console.log("=== Checking All WETH/USDC Pools ===\n");

        checkPool(500, 10);
        checkPool(3000, 60);
        checkPool(10000, 200);
    }

    function checkPool(uint24 fee, int24 tickSpacing) internal view {
        // Sort currencies (USDC < WETH)
        Currency currency0 = Currency.wrap(USDC);
        Currency currency1 = Currency.wrap(WETH);

        PoolKey memory key = PoolKey({
            currency0: currency0,
            currency1: currency1,
            fee: fee,
            tickSpacing: tickSpacing,
            hooks: IHooks(address(0))
        });

        PoolId poolId = key.toId();

        console.log("Pool: WETH/USDC", fee, "fee");
        console.log("Pool ID:", uint256(PoolId.unwrap(poolId)));

        // Check if pool is initialized
        (uint160 sqrtPriceX96, int24 tick, uint24 protocolFee, uint24 lpFee) = POOL_MANAGER.getSlot0(poolId);

        if (sqrtPriceX96 == 0) {
            console.log("  Status: NOT INITIALIZED\n");
        } else {
            console.log("  Status: INITIALIZED");
            console.log("  sqrtPriceX96:", sqrtPriceX96);
            console.log("  tick:", tick);
            console.log("  lpFee:", lpFee);

            // Check if it's at the wrong price (MIN_TICK area)
            if (tick < -800000) {
                console.log("  WARNING: Pool at MIN_TICK! Wrong initialization!");
            } else if (tick > -100000 && tick < 100000) {
                console.log("  OK: Reasonable price range");
            } else {
                console.log("  WARNING: Unusual tick value");
            }
            console.log("");
        }
    }
}
