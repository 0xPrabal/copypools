// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import { Script, console } from "forge-std/Script.sol";
import { IPoolManager } from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import { PoolKey } from "@uniswap/v4-core/src/types/PoolKey.sol";
import { PoolId, PoolIdLibrary } from "@uniswap/v4-core/src/types/PoolId.sol";
import { Currency } from "@uniswap/v4-core/src/types/Currency.sol";
import { StateLibrary } from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import { IHooks } from "@uniswap/v4-core/src/interfaces/IHooks.sol";

contract CheckPools is Script {
    using PoolIdLibrary for PoolKey;
    using StateLibrary for IPoolManager;

    IPoolManager constant PM = IPoolManager(0x498581fF718922c3f8e6A244956aF099B2652b2b);
    address constant WETH = 0x4200000000000000000000000000000000000006;
    address constant USDC = 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913;

    function run() public view {
        console.log("=== Checking WETH/USDC pools on Base V4 ===");

        _check(500, 10, "fee=500/ts=10");
        _check(500, 1, "fee=500/ts=1");
        _check(3000, 60, "fee=3000/ts=60");
        _check(3000, 1, "fee=3000/ts=1");
        _check(10000, 200, "fee=10000/ts=200");
        _check(100, 1, "fee=100/ts=1");
        _check(100, 2, "fee=100/ts=2");
        _check(2000, 40, "fee=2000/ts=40");
        _check(500, 60, "fee=500/ts=60");
        _check(1000, 20, "fee=1000/ts=20");
    }

    function _check(uint24 fee, int24 ts, string memory label) internal view {
        PoolKey memory pk = PoolKey({
            currency0: Currency.wrap(WETH),
            currency1: Currency.wrap(USDC),
            fee: fee,
            tickSpacing: ts,
            hooks: IHooks(address(0))
        });
        (uint160 sqrtPriceX96, int24 tick,,) = PM.getSlot0(pk.toId());
        if (sqrtPriceX96 > 0 && sqrtPriceX96 < 1461446703485210103287273052203988822378723970342) {
            console.log("  ACTIVE:", label);
            console.log("    sqrtPriceX96:", uint256(sqrtPriceX96));
            if (tick >= 0) {
                console.log("    tick:", uint256(int256(tick)));
            } else {
                console.log("    tick (neg):", uint256(int256(-int256(tick))));
            }
        } else if (sqrtPriceX96 > 0) {
            console.log("  DEAD (MAX_PRICE):", label);
        } else {
            console.log("  NOT INIT:", label);
        }
    }
}
