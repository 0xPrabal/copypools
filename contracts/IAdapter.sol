// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/**
 * @title IAdapter
 * @notice Generic adapter interface for multi-DEX liquidity management
 * @dev This interface abstracts DEX-specific logic, enabling support for Uniswap V4, V3, PancakeSwap, etc.
 */
interface IAdapter {
    /**
     * @notice Pool configuration data
     * @param token0 First token in the pool
     * @param token1 Second token in the pool
     * @param fee Pool fee tier (e.g., 3000 for 0.3%)
     * @param tickLower Lower price bound (for concentrated liquidity)
     * @param tickUpper Upper price bound (for concentrated liquidity)
     * @param extraData DEX-specific data (e.g., V4 hooks, pool key)
     */
    struct PoolData {
        address token0;
        address token1;
        uint24 fee;
        int24 tickLower;
        int24 tickUpper;
        bytes extraData;
    }

    /**
     * @notice Parameters for adding liquidity
     * @param pool Pool configuration
     * @param amount0Desired Desired amount of token0
     * @param amount1Desired Desired amount of token1
     * @param amount0Min Minimum amount of token0 (slippage protection)
     * @param amount1Min Minimum amount of token1 (slippage protection)
     * @param recipient Address to receive the position NFT
     */
    struct LiquidityParams {
        PoolData pool;
        uint256 amount0Desired;
        uint256 amount1Desired;
        uint256 amount0Min;
        uint256 amount1Min;
        address recipient;
    }

    /**
     * @notice Opens a new liquidity position
     * @param params Liquidity parameters
     * @param deadline Timestamp after which the transaction will revert
     * @return dexTokenId The DEX-specific position ID
     * @return liquidity The amount of liquidity added
     */
    function openPosition(LiquidityParams calldata params, uint256 deadline)
        external
        payable
        returns (uint256 dexTokenId, uint128 liquidity);

    /**
     * @notice Increases liquidity for an existing position
     * @param tokenId The position ID
     * @param amount0 Amount of token0 to add
     * @param amount1 Amount of token1 to add
     * @param amount0Min Minimum amount of token0 (slippage protection)
     * @param amount1Min Minimum amount of token1 (slippage protection)
     * @param deadline Timestamp after which the transaction will revert
     * @return liquidity The amount of liquidity added
     */
    function increaseLiquidity(
        uint256 tokenId,
        uint256 amount0,
        uint256 amount1,
        uint256 amount0Min,
        uint256 amount1Min,
        uint256 deadline
    ) external payable returns (uint128 liquidity);

    /**
     * @notice Decreases liquidity from a position
     * @param tokenId The position ID
     * @param liquidity The amount of liquidity to remove
     * @param amount0Min Minimum amount of token0 (slippage protection)
     * @param amount1Min Minimum amount of token1 (slippage protection)
     * @param deadline Timestamp after which the transaction will revert
     * @return amount0 Amount of token0 withdrawn
     * @return amount1 Amount of token1 withdrawn
     */
    function decreaseLiquidity(
        uint256 tokenId,
        uint128 liquidity,
        uint256 amount0Min,
        uint256 amount1Min,
        uint256 deadline
    ) external returns (uint256 amount0, uint256 amount1);

    /**
     * @notice Collects accumulated fees from a position
     * @param tokenId The position ID
     * @param deadline Timestamp after which the transaction will revert
     * @return amount0 Amount of token0 fees collected
     * @return amount1 Amount of token1 fees collected
     */
    function collectFees(uint256 tokenId, uint256 deadline)
        external
        returns (uint256 amount0, uint256 amount1);

    /**
     * @notice Burns a position (removes all liquidity and collects all fees)
     * @param tokenId The position ID
     * @param amount0Min Minimum amount of token0 (slippage protection)
     * @param amount1Min Minimum amount of token1 (slippage protection)
     * @param deadline Timestamp after which the transaction will revert
     * @return amount0 Total amount of token0 received
     * @return amount1 Total amount of token1 received
     */
    function burnPosition(
        uint256 tokenId,
        uint256 amount0Min,
        uint256 amount1Min,
        uint256 deadline
    ) external returns (uint256 amount0, uint256 amount1);

    /**
     * @notice Moves a position to a new tick range (preserves pool/fee)
     * @param oldTokenId The current position ID
     * @param newTickLower New lower price bound
     * @param newTickUpper New upper price bound
     * @param amount0Min Minimum amount of token0 (slippage protection)
     * @param amount1Min Minimum amount of token1 (slippage protection)
     * @param deadline Timestamp after which the transaction will revert
     * @return newTokenId The new position ID
     * @return liquidity The amount of liquidity in the new position
     */
    function moveRange(
        uint256 oldTokenId,
        int24 newTickLower,
        int24 newTickUpper,
        uint256 amount0Min,
        uint256 amount1Min,
        uint256 deadline
    ) external returns (uint256 newTokenId, uint128 liquidity);

    /**
     * @notice Gets the pool tokens for a position
     * @param tokenId The position ID
     * @return token0 First token address
     * @return token1 Second token address
     */
    function getPositionTokens(uint256 tokenId)
        external
        view
        returns (address token0, address token1);

    /**
     * @notice Gets complete position information including liquidity
     * @param tokenId The position ID
     * @return owner Position owner address
     * @return token0 First token address
     * @return token1 Second token address
     * @return tickLower Lower tick boundary
     * @return tickUpper Upper tick boundary
     * @return liquidity Current liquidity amount
     */
    function getPositionInfo(uint256 tokenId)
        external
        view
        returns (
            address owner,
            address token0,
            address token1,
            int24 tickLower,
            int24 tickUpper,
            uint128 liquidity
        );

    /**
     * @notice Swaps tokens in a pool
     * @param poolData Pool configuration
     * @param zeroForOne Direction of swap (true = token0 to token1)
     * @param amountSpecified Amount to swap (negative for exact input, positive for exact output)
     * @param sqrtPriceLimitX96 Price limit for the swap (0 = no limit)
     * @param deadline Timestamp after which the transaction will revert
     * @return amount0 Delta of token0 (negative = paid, positive = received)
     * @return amount1 Delta of token1 (negative = paid, positive = received)
     */
    function swap(
        PoolData calldata poolData,
        bool zeroForOne,
        int256 amountSpecified,
        uint160 sqrtPriceLimitX96,
        uint256 deadline
    ) external payable returns (int256 amount0, int256 amount1);
}
