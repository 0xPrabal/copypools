// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script} from "forge-std/Script.sol";
import {console} from "forge-std/console.sol";
import {V4Utils} from "../src/utils/V4Utils.sol";

contract CheckV4Utils is Script {
    address constant V4_UTILS = 0xff9C5B6F76444144a36de91F4d2F3289E37Cf956;

    function run() external view {
        console.log("Checking V4Utils configuration...");

        V4Utils utils = V4Utils(payable(V4_UTILS));

        address poolManager = address(utils.poolManager());
        address positionManager = address(utils.positionManager());
        address weth9 = address(utils.WETH9());
        bool paused = utils.paused();

        console.log("V4Utils address:", V4_UTILS);
        console.log("Pool Manager:", poolManager);
        console.log("Position Manager:", positionManager);
        console.log("WETH9:", weth9);
        console.log("Paused:", paused);

        if (paused) {
            console.log("\nERROR: Contract is PAUSED!");
        }
    }
}
