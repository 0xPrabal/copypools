// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "forge-std/Script.sol";

interface IV4Utils {
    function setRouterApproval(address router, bool approved) external;
    function approvedRouters(address router) external view returns (bool);
    function owner() external view returns (address);
}

contract ApproveRouterScript is Script {
    // V4Utils contract on Base Mainnet
    address constant V4_UTILS = 0x37A199B0Baea8943AD493f04Cc2da8c4fa7C2cE1;

    // 0x Exchange Proxy on Base
    address constant ZEROX_EXCHANGE_PROXY = 0xDef1C0ded9bec7F1a1670819833240f027b25EfF;

    function run() external {
        // Get private key from environment
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");

        IV4Utils v4Utils = IV4Utils(V4_UTILS);

        // Log current state
        console.log("V4Utils address:", V4_UTILS);
        console.log("0x Router address:", ZEROX_EXCHANGE_PROXY);
        console.log("Contract owner:", v4Utils.owner());
        console.log("Router currently approved:", v4Utils.approvedRouters(ZEROX_EXCHANGE_PROXY));

        // Start broadcast
        vm.startBroadcast(deployerPrivateKey);

        // Approve the router
        v4Utils.setRouterApproval(ZEROX_EXCHANGE_PROXY, true);

        vm.stopBroadcast();

        // Verify
        console.log("Router approved successfully!");
        console.log("Router now approved:", v4Utils.approvedRouters(ZEROX_EXCHANGE_PROXY));
    }
}
