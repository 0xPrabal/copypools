// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "forge-std/Script.sol";

interface IV4Base {
    function setRouterApproval(address router, bool approved) external;
    function approvedRouters(address router) external view returns (bool);
    function owner() external view returns (address);
}

contract ApproveRouterScript is Script {
    // Contract proxy addresses on Base Mainnet
    address constant V4_UTILS = 0x8d81Bb4daA4c8D6ad99a741d1E7C9563EAFda423;
    address constant V4_COMPOUNDOR = 0x2056eDc7590B42b5464f357589810fA3441216E3;
    address constant V4_AUTO_RANGE = 0xB6E684266259d172a8CC85F524ab2E845886242b;
    address constant V4_AUTO_EXIT = 0xb9ab855339036df10790728A773dD3a8c9e538B0;

    // KyberSwap Meta Aggregation Router V2 on Base
    address constant KYBERSWAP_ROUTER = 0x6131B5fae19EA4f9D964eAc0408E4408b66337b5;

    function run() external {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");

        address[4] memory contracts = [V4_UTILS, V4_COMPOUNDOR, V4_AUTO_RANGE, V4_AUTO_EXIT];
        string[4] memory names = ["V4Utils", "V4Compoundor", "V4AutoRange", "V4AutoExit"];

        console.log("=== KyberSwap Router Approval ===");
        console.log("Router:", KYBERSWAP_ROUTER);
        console.log("");

        vm.startBroadcast(deployerPrivateKey);

        for (uint256 i = 0; i < contracts.length; i++) {
            IV4Base target = IV4Base(contracts[i]);
            bool alreadyApproved = target.approvedRouters(KYBERSWAP_ROUTER);

            console.log(names[i], ":", contracts[i]);
            console.log("  Owner:", target.owner());
            console.log("  Already approved:", alreadyApproved);

            if (!alreadyApproved) {
                target.setRouterApproval(KYBERSWAP_ROUTER, true);
                console.log("  -> Approved!");
            } else {
                console.log("  -> Skipped (already approved)");
            }
        }

        vm.stopBroadcast();

        // Verify all approvals
        console.log("");
        console.log("=== Verification ===");
        for (uint256 i = 0; i < contracts.length; i++) {
            bool approved = IV4Base(contracts[i]).approvedRouters(KYBERSWAP_ROUTER);
            console.log(names[i], "approved:", approved);
        }
    }
}
