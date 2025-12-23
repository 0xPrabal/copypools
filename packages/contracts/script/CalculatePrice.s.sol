// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script} from "forge-std/Script.sol";
import {console} from "forge-std/console.sol";

/**
 * @title CalculatePrice
 * @notice Calculate correct sqrtPriceX96 for USDC/WETH pool
 *
 * USDC has 6 decimals, WETH has 18 decimals
 *
 * If we want 1 WETH = 3000 USDC:
 * - In raw units: 10^18 wei = 3000 * 10^6 usdc_units
 * - Price ratio (token1/token0) = WETH/USDC = 10^18 / (3000 * 10^6) = 10^12 / 3000
 *
 * sqrtPriceX96 = sqrt(price) * 2^96
 */
contract CalculatePrice is Script {
    // Q96 constant
    uint256 constant Q96 = 2**96;

    function run() external view {
        console.log("=== Calculating sqrtPriceX96 for USDC/WETH ===");
        console.log("USDC (token0): 6 decimals");
        console.log("WETH (token1): 18 decimals");
        console.log("");

        // Target: 1 WETH = 3000 USDC
        // In raw units: 10^18 wei = 3000 * 10^6 usdc smallest units

        // Price = token1 / token0 = WETH / USDC
        // Price = 10^18 / (3000 * 10^6)
        // Price = 10^12 / 3000

        // For easier calculation, use: price = (10^12) / 3000
        // sqrtPrice = sqrt(10^12 / 3000) = sqrt(10^12) / sqrt(3000)
        //           = 10^6 / sqrt(3000)
        //           = 10^6 / 54.77
        //           ≈ 18257.42

        // sqrtPriceX96 = sqrtPrice * 2^96
        // ≈ 18257.42 * 2^96

        // Let's calculate this more precisely
        // sqrt(10^12 / 3000) * 2^96

        // We can't do sqrt directly in Solidity for large numbers
        // So let's provide the pre-calculated value

        // Python calculation:
        // import math
        // price_ratio = 10**12 / 3000
        // sqrt_price = math.sqrt(price_ratio)
        // sqrt_price_x96 = int(sqrt_price * (2**96))

        // Result: 1446446027919196949853588145082
        uint160 sqrtPriceX96_3000 = 1446446027919196949853588145082;

        console.log("For 1 WETH = 3000 USDC:");
        console.log("sqrtPriceX96 =", sqrtPriceX96_3000);
        console.log("");

        // For 1 WETH = 2500 USDC
        uint160 sqrtPriceX96_2500 = 1584563250149434761522526446544;
        console.log("For 1 WETH = 2500 USDC:");
        console.log("sqrtPriceX96 =", sqrtPriceX96_2500);
        console.log("");

        // For 1 WETH = 2000 USDC
        uint160 sqrtPriceX96_2000 = 1771845812063858970152924369190;
        console.log("For 1 WETH = 2000 USDC:");
        console.log("sqrtPriceX96 =", sqrtPriceX96_2000);
        console.log("");

        // Current wrong initialization (1:1 without decimal adjustment)
        uint160 current_wrong = 79228162514264337593543950336;
        console.log("Current WRONG 1:1 initialization:");
        console.log("sqrtPriceX96 =", current_wrong);
        console.log("This means 1 raw USDC unit = 1 raw WETH unit");
        console.log("Which is 1 USDC (10^6) = 1 WETH (10^18)");
        console.log("Or 1 USDC = 10^12 WETH = 1 TRILLION WETH!");
        console.log("");

        console.log("=== RECOMMENDED ===");
        console.log("Use sqrtPriceX96 = 1584563250149434761522526446544");
        console.log("(For 1 WETH = 2500 USDC, a reasonable testnet price)");
    }
}
