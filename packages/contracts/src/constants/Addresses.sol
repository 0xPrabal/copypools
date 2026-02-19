// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/// @title Addresses
/// @notice Official Uniswap V4 contract addresses per network
library Addresses {
    // ============ Base Mainnet (Chain ID: 8453) ============
    address constant BASE_POOL_MANAGER = 0x498581fF718922c3f8e6A244956aF099B2652b2b;
    address constant BASE_UNIVERSAL_ROUTER = 0x6fF5693b99212Da76ad316178A184AB56D299b43;
    address constant BASE_POSITION_MANAGER = 0x7C5f5A4bBd8fD63184577525326123B519429bDc;
    address constant BASE_POSITION_DESCRIPTOR = 0x25D093633990DC94BeDEeD76C8F3CDaa75f3E7D5;
    address constant BASE_STATE_VIEW = 0xA3c0c9b65baD0b08107Aa264b0f3dB444b867A71;
    address constant BASE_QUOTER = 0x0d5e0F971ED27FBfF6c2837bf31316121532048D;
    address constant BASE_PERMIT2 = 0x000000000022D473030F116dDEE9F6B43aC78BA3;
    address constant BASE_WETH = 0x4200000000000000000000000000000000000006;

    // ============ Ethereum Mainnet (Chain ID: 1) ============
    // Note: Update these when V4 is deployed to mainnet
    address constant MAINNET_POOL_MANAGER = address(0);
    address constant MAINNET_POSITION_MANAGER = address(0);
    address constant MAINNET_UNIVERSAL_ROUTER = address(0);
    address constant MAINNET_PERMIT2 = 0x000000000022D473030F116dDEE9F6B43aC78BA3;
    address constant MAINNET_WETH = 0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2;

    // ============ Swap Routers ============
    address constant ZEROX_EXCHANGE_PROXY = 0xDef1C0ded9bec7F1a1670819833240f027b25EfF;
    address constant ONEINCH_ROUTER_V5 = 0x1111111254EEB25477B68fb85Ed929f73A960582;
    address constant ONEINCH_ROUTER_V6 = 0x111111125421cA6dc452d289314280a0f8842A65;

    // ============ Helper Functions ============

    function getPoolManager(uint256 chainId) internal pure returns (address) {
        if (chainId == 8453) return BASE_POOL_MANAGER;
        if (chainId == 1) return MAINNET_POOL_MANAGER;
        revert("Unsupported chain");
    }

    function getPositionManager(uint256 chainId) internal pure returns (address) {
        if (chainId == 8453) return BASE_POSITION_MANAGER;
        if (chainId == 1) return MAINNET_POSITION_MANAGER;
        revert("Unsupported chain");
    }

    function getUniversalRouter(uint256 chainId) internal pure returns (address) {
        if (chainId == 8453) return BASE_UNIVERSAL_ROUTER;
        if (chainId == 1) return MAINNET_UNIVERSAL_ROUTER;
        revert("Unsupported chain");
    }

    function getPermit2(uint256 chainId) internal pure returns (address) {
        if (chainId == 8453) return BASE_PERMIT2;
        if (chainId == 1) return MAINNET_PERMIT2;
        revert("Unsupported chain");
    }

    function getWETH(uint256 chainId) internal pure returns (address) {
        if (chainId == 8453) return BASE_WETH;
        if (chainId == 1) return MAINNET_WETH;
        revert("Unsupported chain");
    }

    function getStateView(uint256 chainId) internal pure returns (address) {
        if (chainId == 8453) return BASE_STATE_VIEW;
        revert("Unsupported chain");
    }

    function getQuoter(uint256 chainId) internal pure returns (address) {
        if (chainId == 8453) return BASE_QUOTER;
        revert("Unsupported chain");
    }
}
