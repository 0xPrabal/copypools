// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

// Official Uniswap V4 imports
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IUnlockCallback} from "@uniswap/v4-core/src/interfaces/callback/IUnlockCallback.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {Currency, CurrencyLibrary} from "@uniswap/v4-core/src/types/Currency.sol";
import {BalanceDelta} from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {ModifyLiquidityParams, SwapParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {FullMath} from "@uniswap/v4-core/src/libraries/FullMath.sol";
import {FixedPoint96} from "@uniswap/v4-core/src/libraries/FixedPoint96.sol";
import {LiquidityAmounts} from "@uniswap/v4-periphery/src/libraries/LiquidityAmounts.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {StateLibrary} from "@uniswap/v4-core/src/libraries/StateLibrary.sol";

import "./IAdapter.sol";

/**
 * @title UniswapV4AdapterProduction
 * @notice Production adapter with full V4 flash accounting and real PoolManager integration
 * @dev Production-ready implementation with:
 
 */
contract UniswapV4AdapterProduction is IAdapter, IUnlockCallback, Ownable {
    using SafeERC20 for IERC20;
    using PoolIdLibrary for PoolKey;
    using CurrencyLibrary for Currency;
    using StateLibrary for IPoolManager;

    /// @notice The Uniswap V4 PoolManager
    IPoolManager public immutable poolManager;

    /// @notice Counter for position IDs
    uint256 private _nextTokenId;

    /// @notice Callback action types
    enum Action {
        OPEN,
        INCREASE,
        DECREASE,
        COLLECT,
        BURN,
        SWAP,
        AUTO_COMPOUND,
        MOVE_RANGE
    }

    /// @notice Position information
    struct Position {
        PoolKey key;
        address owner;
        int24 tickLower;
        int24 tickUpper;
        uint128 liquidity;
    }

    /// @notice Position storage
    mapping(uint256 => Position) public positions;

    /// @notice Approved operators for each position (position => operator => approved)
    mapping(uint256 => mapping(address => bool)) public approvedOperators;

    /// @notice Events
    event PositionCreated(uint256 indexed id, address indexed owner, uint128 liquidity);
    event LiquidityChanged(uint256 indexed id, int256 delta);
    event FeesCollected(uint256 indexed id, uint256 amount0, uint256 amount1);
    event PositionBurned(uint256 indexed id, uint256 amount0, uint256 amount1);
    event SwapExecuted(address indexed pool, bool zeroForOne, int256 amount0, int256 amount1);
    event AutoCompounded(uint256 indexed id, uint256 fee0, uint256 fee1, uint128 liquidityAdded);
    event OperatorApproved(uint256 indexed positionId, address indexed operator, bool approved);
    event RangeMoved(uint256 indexed oldPositionId, uint256 indexed newPositionId, int24 newTickLower, int24 newTickUpper, uint128 newLiquidity);

    /// @notice Errors
    error InvalidPoolManager();
    error Unauthorized();
    error InvalidPosition();
    error InsufficientETH();
    error SettleFailed();
    error TakeFailed();
    error SlippageCheckFailed(uint256 amount, uint256 minAmount);
    error DeadlineExpired();

    /**
     * @notice Constructor
     * @param _poolManager Uniswap V4 PoolManager address
     */
    constructor(address _poolManager) Ownable(msg.sender) {
        if (_poolManager == address(0)) revert InvalidPoolManager();
        poolManager = IPoolManager(_poolManager);
        _nextTokenId = 1;
    }

    /**
     * @notice Receive ETH for native currency support
     */
    receive() external payable {}

    /**
     * @notice Ensures transaction is executed before deadline
     * @param deadline The timestamp after which the transaction should revert
     */
    modifier checkDeadline(uint256 deadline) {
        if (block.timestamp > deadline) revert DeadlineExpired();
        _;
    }

    /**
     * @inheritdoc IAdapter
     */
    function openPosition(LiquidityParams calldata params, uint256 deadline)
        external
        payable
        override
        checkDeadline(deadline)
        returns (uint256 dexTokenId, uint128 liquidity)
    {
        // Transfer tokens from LPManager (handles both ERC20 and native ETH)
        _transferIn(Currency.wrap(params.pool.token0), msg.sender, params.amount0Desired);
        _transferIn(Currency.wrap(params.pool.token1), msg.sender, params.amount1Desired);

        // Execute via unlock callback with flash accounting
        bytes memory data = abi.encode(Action.OPEN, msg.sender, params);
        bytes memory result = poolManager.unlock(data);
        (dexTokenId, liquidity) = abi.decode(result, (uint256, uint128));
    }

    /**
     * @inheritdoc IAdapter
     */
    function increaseLiquidity(
        uint256 tokenId,
        uint256 amount0,
        uint256 amount1,
        uint256 amount0Min,
        uint256 amount1Min,
        uint256 deadline
    )
        external
        payable
        override
        checkDeadline(deadline)
        returns (uint128 liquidity)
    {
        Position storage pos = positions[tokenId];
        if (pos.owner != msg.sender) revert Unauthorized();

        // Transfer tokens
        if (amount0 > 0) {
            _transferIn(pos.key.currency0, msg.sender, amount0);
        }
        if (amount1 > 0) {
            _transferIn(pos.key.currency1, msg.sender, amount1);
        }

        // Execute via unlock callback with slippage check
        bytes memory data = abi.encode(Action.INCREASE, tokenId, amount0, amount1, amount0Min, amount1Min);
        bytes memory result = poolManager.unlock(data);
        liquidity = abi.decode(result, (uint128));

        pos.liquidity += liquidity;
        emit LiquidityChanged(tokenId, int256(uint256(liquidity)));
    }

    /**
     * @inheritdoc IAdapter
     */
    function decreaseLiquidity(
        uint256 tokenId,
        uint128 liq,
        uint256 amount0Min,
        uint256 amount1Min,
        uint256 deadline
    )
        external
        override
        checkDeadline(deadline)
        returns (uint256 amount0, uint256 amount1)
    {
        Position storage pos = positions[tokenId];
        if (pos.owner != msg.sender) revert Unauthorized();
        if (liq > pos.liquidity) revert InvalidPosition();

        // Execute via unlock callback with slippage check
        bytes memory data = abi.encode(Action.DECREASE, tokenId, liq, amount0Min, amount1Min);
        bytes memory result = poolManager.unlock(data);
        (amount0, amount1) = abi.decode(result, (uint256, uint256));

        pos.liquidity -= liq;

        // Transfer tokens back to user (handles both ERC20 and native ETH)
        _transferOut(pos.key.currency0, msg.sender, amount0);
        _transferOut(pos.key.currency1, msg.sender, amount1);

        emit LiquidityChanged(tokenId, -int256(uint256(liq)));
    }

    /**
     * @inheritdoc IAdapter
     */
    function collectFees(uint256 tokenId, uint256 deadline)
        external
        override
        checkDeadline(deadline)
        returns (uint256 amount0, uint256 amount1)
    {
        Position storage pos = positions[tokenId];
        if (pos.owner != msg.sender) revert Unauthorized();

        // Execute via unlock callback - modifyLiquidity with 0 delta collects fees
        bytes memory data = abi.encode(Action.COLLECT, tokenId);
        bytes memory result = poolManager.unlock(data);
        (amount0, amount1) = abi.decode(result, (uint256, uint256));

        // Transfer collected fees to user
        _transferOut(pos.key.currency0, msg.sender, amount0);
        _transferOut(pos.key.currency1, msg.sender, amount1);

        emit FeesCollected(tokenId, amount0, amount1);
    }

    /**
     * @notice Approve or revoke an operator for a position
     * @dev Operators can call autoCompound on behalf of position owner
     * @param tokenId The position ID
     * @param operator The operator address (e.g., AutoCompounder contract)
     * @param approved True to approve, false to revoke
     */
    function setOperatorApproval(uint256 tokenId, address operator, bool approved) external {
        Position storage pos = positions[tokenId];
        if (pos.owner != msg.sender) revert Unauthorized();

        approvedOperators[tokenId][operator] = approved;

        emit OperatorApproved(tokenId, operator, approved);
    }

    /**
     * @notice Check if caller is authorized for position (owner or approved operator)
     * @param tokenId The position ID
     * @return True if authorized
     */
    function isAuthorized(uint256 tokenId, address caller) public view returns (bool) {
        Position storage pos = positions[tokenId];
        return (pos.owner == caller) || approvedOperators[tokenId][caller];
    }

    /**
     * @notice Auto-compound: Collect fees and automatically reinvest them
     * @dev Collects fees and adds them back as liquidity in a single transaction
     * @dev Can be called by position owner OR approved operators (e.g., backend/keeper)
     * @param tokenId The position to auto-compound
     * @param deadline Transaction deadline
     * @return fee0 Amount of token0 fees collected and reinvested
     * @return fee1 Amount of token1 fees collected and reinvested
     * @return liquidityAdded Additional liquidity added from fees
     */
    function autoCompound(uint256 tokenId, uint256 deadline)
        external
        checkDeadline(deadline)
        returns (uint256 fee0, uint256 fee1, uint128 liquidityAdded)
    {
        // Check if caller is owner or approved operator
        if (!isAuthorized(tokenId, msg.sender)) revert Unauthorized();

        // Execute via unlock callback - collect fees and reinvest
        bytes memory data = abi.encode(Action.AUTO_COMPOUND, tokenId);
        bytes memory result = poolManager.unlock(data);
        (fee0, fee1, liquidityAdded) = abi.decode(result, (uint256, uint256, uint128));

        // Update position liquidity
        Position storage pos = positions[tokenId];
        pos.liquidity += liquidityAdded;

        emit AutoCompounded(tokenId, fee0, fee1, liquidityAdded);
    }

    /**
     * @notice Move position to a new range (like Revert Finance)
     * @dev Withdraws from old position, swaps if needed, creates new position at new range
     * @param oldTokenId The position to move
     * @param newTickLower New lower tick
     * @param newTickUpper New upper tick
     * @param amount0Min Minimum amount0 for slippage protection
     * @param amount1Min Minimum amount1 for slippage protection
     * @param deadline Timestamp after which the transaction will revert
     * @return newTokenId The new position ID
     * @return liquidity Liquidity of new position
     */
    function moveRange(
        uint256 oldTokenId,
        int24 newTickLower,
        int24 newTickUpper,
        uint256 amount0Min,
        uint256 amount1Min,
        uint256 deadline
    )
        external
        checkDeadline(deadline)
        returns (uint256 newTokenId, uint128 liquidity)
    {
        // Check authorization
        if (!isAuthorized(oldTokenId, msg.sender)) revert Unauthorized();

        // Validate new range
        if (newTickLower >= newTickUpper) revert InvalidPosition();

        // Execute move via unlock callback
        bytes memory data = abi.encode(
            Action.MOVE_RANGE,
            oldTokenId,
            newTickLower,
            newTickUpper,
            amount0Min,
            amount1Min
        );
        bytes memory result = poolManager.unlock(data);
        (newTokenId, liquidity) = abi.decode(result, (uint256, uint128));

        emit RangeMoved(oldTokenId, newTokenId, newTickLower, newTickUpper, liquidity);
    }

    /**
     * @inheritdoc IAdapter
     * @notice Burns a position by removing all liquidity and collecting all fees
     */
    function burnPosition(
        uint256 tokenId,
        uint256 amount0Min,
        uint256 amount1Min,
        uint256 deadline
    )
        external
        override
        checkDeadline(deadline)
        returns (uint256 amount0, uint256 amount1)
    {
        Position storage pos = positions[tokenId];
        if (pos.owner != msg.sender) revert Unauthorized();

        // Execute via unlock callback to burn position
        bytes memory data = abi.encode(Action.BURN, tokenId, amount0Min, amount1Min);
        bytes memory result = poolManager.unlock(data);
        (amount0, amount1) = abi.decode(result, (uint256, uint256));

        // Transfer tokens back to user
        _transferOut(pos.key.currency0, msg.sender, amount0);
        _transferOut(pos.key.currency1, msg.sender, amount1);

        // Delete position data
        delete positions[tokenId];

        emit PositionBurned(tokenId, amount0, amount1);
    }

    /**
     * @inheritdoc IAdapter
     */
    function getPositionTokens(uint256 tokenId)
        external
        view
        override
        returns (address token0, address token1)
    {
        Position storage pos = positions[tokenId];
        return (Currency.unwrap(pos.key.currency0), Currency.unwrap(pos.key.currency1));
    }

    /**
     * @inheritdoc IAdapter
     * @notice Swaps tokens in a V4 pool
     */
    function swap(
        IAdapter.PoolData calldata poolData,
        bool zeroForOne,
        int256 amountSpecified,
        uint160 sqrtPriceLimitX96,
        uint256 deadline
    )
        external
        payable
        override
        checkDeadline(deadline)
        returns (int256 amount0, int256 amount1)
    {
        // Build pool key
        PoolKey memory key = _buildPoolKey(poolData);

        // Transfer input token if needed
        Currency inputCurrency = zeroForOne ? key.currency0 : key.currency1;
        if (amountSpecified < 0) {
            // Exact input swap - transfer input token
            uint256 amountIn = uint256(-amountSpecified);
            _transferIn(inputCurrency, msg.sender, amountIn);
        }

        // Use default price limits if not specified
        uint160 priceLimit = sqrtPriceLimitX96;
        if (priceLimit == 0) {
            priceLimit = zeroForOne
                ? TickMath.MIN_SQRT_PRICE + 1
                : TickMath.MAX_SQRT_PRICE - 1;
        }

        // Execute swap via unlock callback
        bytes memory data = abi.encode(
            Action.SWAP,
            key,
            zeroForOne,
            amountSpecified,
            priceLimit
        );

        bytes memory result = poolManager.unlock(data);
        (amount0, amount1) = abi.decode(result, (int256, int256));

        // Transfer output token to user
        Currency outputCurrency = zeroForOne ? key.currency1 : key.currency0;
        int256 outputAmount = zeroForOne ? amount1 : amount0;

        if (outputAmount > 0) {
            _transferOut(outputCurrency, msg.sender, uint256(outputAmount));
        }

        emit SwapExecuted(
            address(0), // Pool address not easily derivable from PoolId
            zeroForOne,
            amount0,
            amount1
        );
    }

    /**
     * @notice Batch multiple operations in a single transaction
     * @dev Allows combining multiple adapter operations to save gas
     * @param calls Array of encoded function calls to execute
     * @return results Array of return data from each call
     */
    function multicall(bytes[] calldata calls) external payable returns (bytes[] memory results) {
        results = new bytes[](calls.length);

        for (uint256 i = 0; i < calls.length; i++) {
            // Execute each call on this contract
            (bool success, bytes memory result) = address(this).delegatecall(calls[i]);

            if (!success) {
                // Bubble up the revert reason
                if (result.length > 0) {
                    assembly {
                        let returndata_size := mload(result)
                        revert(add(32, result), returndata_size)
                    }
                } else {
                    revert("Multicall: call failed");
                }
            }

            results[i] = result;
        }

        return results;
    }

    /**
     * @inheritdoc IUnlockCallback
     * @dev Called by PoolManager - executes V4 operations with flash accounting
     */
    function unlockCallback(bytes calldata data) external override returns (bytes memory) {
        if (msg.sender != address(poolManager)) revert Unauthorized();

        Action action = abi.decode(data, (Action));

        if (action == Action.OPEN) return _handleOpen(data);
        if (action == Action.INCREASE) return _handleIncrease(data);
        if (action == Action.DECREASE) return _handleDecrease(data);
        if (action == Action.COLLECT) return _handleCollect(data);
        if (action == Action.BURN) return _handleBurn(data);
        if (action == Action.SWAP) return _handleSwap(data);
        if (action == Action.AUTO_COMPOUND) return _handleAutoCompound(data);
        if (action == Action.MOVE_RANGE) return _handleMoveRange(data);

        revert();
    }

    /**
     * @dev Handle position opening with REAL V4 operations
     */
    function _handleOpen(bytes calldata data) internal returns (bytes memory) {
        (, address owner, IAdapter.LiquidityParams memory params) =
            abi.decode(data, (Action, address, IAdapter.LiquidityParams));

        PoolKey memory key = _buildPoolKey(params.pool);

        // Get current pool price using StateLibrary
        (uint160 sqrtPriceX96,,,) = StateLibrary.getSlot0(poolManager, key.toId());

        // If pool not initialized, use default price
        if (sqrtPriceX96 == 0) {
            sqrtPriceX96 = TickMath.getSqrtPriceAtTick(0);
        }

        uint160 sqrtPriceAX96 = TickMath.getSqrtPriceAtTick(params.pool.tickLower);
        uint160 sqrtPriceBX96 = TickMath.getSqrtPriceAtTick(params.pool.tickUpper);

        // Calculate liquidity using official V4 library with REAL current price
        uint128 liquidity = LiquidityAmounts.getLiquidityForAmounts(
            sqrtPriceX96,
            sqrtPriceAX96,
            sqrtPriceBX96,
            params.amount0Desired,
            params.amount1Desired
        );

        // REAL V4 OPERATION: Add liquidity via PoolManager
        ModifyLiquidityParams memory modifyParams = ModifyLiquidityParams({
            tickLower: params.pool.tickLower,
            tickUpper: params.pool.tickUpper,
            liquidityDelta: int256(uint256(liquidity)),
            salt: bytes32(0)
        });

        (BalanceDelta delta,) = poolManager.modifyLiquidity(key, modifyParams, "");

        // FLASH ACCOUNTING: Settle tokens with PoolManager
        // Note: delta amounts are negative when we owe the pool
        uint256 actualAmount0;
        uint256 actualAmount1;

        if (delta.amount0() < 0) {
            actualAmount0 = uint256(uint128(-delta.amount0()));
            _settle(key.currency0, actualAmount0);
        }
        if (delta.amount1() < 0) {
            actualAmount1 = uint256(uint128(-delta.amount1()));
            _settle(key.currency1, actualAmount1);
        }

        // SLIPPAGE PROTECTION: Ensure we don't pay more than expected
        if (actualAmount0 > params.amount0Desired || actualAmount1 > params.amount1Desired) {
            revert SlippageCheckFailed(actualAmount0 > params.amount0Desired ? actualAmount0 : actualAmount1,
                                      actualAmount0 > params.amount0Desired ? params.amount0Desired : params.amount1Desired);
        }
        // Ensure we get at least minimum amounts
        if (actualAmount0 < params.amount0Min) {
            revert SlippageCheckFailed(actualAmount0, params.amount0Min);
        }
        if (actualAmount1 < params.amount1Min) {
            revert SlippageCheckFailed(actualAmount1, params.amount1Min);
        }

        // Store position
        uint256 id = _nextTokenId++;
        positions[id] = Position(key, owner, params.pool.tickLower, params.pool.tickUpper, liquidity);

        emit PositionCreated(id, owner, liquidity);

        return abi.encode(id, liquidity);
    }

    /**
     * @dev Handle liquidity increase with REAL V4 operations and slippage protection
     */
    function _handleIncrease(bytes calldata data) internal returns (bytes memory) {
        (, uint256 id, uint256 amt0, uint256 amt1, uint256 amt0Min, uint256 amt1Min) =
            abi.decode(data, (Action, uint256, uint256, uint256, uint256, uint256));

        Position storage pos = positions[id];

        // Get current pool price
        (uint160 sqrtPriceX96,,,) = StateLibrary.getSlot0(poolManager, pos.key.toId());
        uint160 sqrtPriceAX96 = TickMath.getSqrtPriceAtTick(pos.tickLower);
        uint160 sqrtPriceBX96 = TickMath.getSqrtPriceAtTick(pos.tickUpper);

        // Calculate additional liquidity
        uint128 additionalLiquidity = LiquidityAmounts.getLiquidityForAmounts(
            sqrtPriceX96,
            sqrtPriceAX96,
            sqrtPriceBX96,
            amt0,
            amt1
        );

        // REAL V4 OPERATION: Increase liquidity
        ModifyLiquidityParams memory modifyParams = ModifyLiquidityParams({
            tickLower: pos.tickLower,
            tickUpper: pos.tickUpper,
            liquidityDelta: int256(uint256(additionalLiquidity)),
            salt: bytes32(0)
        });

        (BalanceDelta delta,) = poolManager.modifyLiquidity(pos.key, modifyParams, "");

        // FLASH ACCOUNTING: Settle tokens with slippage protection
        uint256 actualAmount0;
        uint256 actualAmount1;

        if (delta.amount0() < 0) {
            actualAmount0 = uint256(uint128(-delta.amount0()));
            _settle(pos.key.currency0, actualAmount0);
        }
        if (delta.amount1() < 0) {
            actualAmount1 = uint256(uint128(-delta.amount1()));
            _settle(pos.key.currency1, actualAmount1);
        }

        // SLIPPAGE PROTECTION: Ensure actual amounts meet minimum requirements
        if (actualAmount0 < amt0Min) {
            revert SlippageCheckFailed(actualAmount0, amt0Min);
        }
        if (actualAmount1 < amt1Min) {
            revert SlippageCheckFailed(actualAmount1, amt1Min);
        }

        return abi.encode(additionalLiquidity);
    }

    /**
     * @dev Handle liquidity decrease with REAL V4 operations and slippage protection
     */
    function _handleDecrease(bytes calldata data) internal returns (bytes memory) {
        (, uint256 id, uint128 liquidityToRemove, uint256 amt0Min, uint256 amt1Min) =
            abi.decode(data, (Action, uint256, uint128, uint256, uint256));

        Position storage pos = positions[id];

        // REAL V4 OPERATION: Remove liquidity (negative delta)
        ModifyLiquidityParams memory modifyParams = ModifyLiquidityParams({
            tickLower: pos.tickLower,
            tickUpper: pos.tickUpper,
            liquidityDelta: -int256(uint256(liquidityToRemove)),
            salt: bytes32(0)
        });

        (BalanceDelta delta,) = poolManager.modifyLiquidity(pos.key, modifyParams, "");

        // FLASH ACCOUNTING: Take tokens from PoolManager
        // Note: delta amounts are positive when the pool owes us
        uint256 amount0 = delta.amount0() > 0 ? uint256(int256(delta.amount0())) : 0;
        uint256 amount1 = delta.amount1() > 0 ? uint256(int256(delta.amount1())) : 0;

        if (amount0 > 0) {
            _take(pos.key.currency0, address(this), amount0);
        }
        if (amount1 > 0) {
            _take(pos.key.currency1, address(this), amount1);
        }

        // SLIPPAGE PROTECTION: Ensure we receive at least minimum amounts
        if (amount0 < amt0Min) {
            revert SlippageCheckFailed(amount0, amt0Min);
        }
        if (amount1 < amt1Min) {
            revert SlippageCheckFailed(amount1, amt1Min);
        }

        return abi.encode(amount0, amount1);
    }

    /**
     * @dev Handle fee collection with REAL V4 operations
     * @notice Calling modifyLiquidity with 0 delta collects fees
     */
    function _handleCollect(bytes calldata data) internal returns (bytes memory) {
        (, uint256 id) = abi.decode(data, (Action, uint256));

        Position storage pos = positions[id];

        // REAL V4 OPERATION: Collect fees by calling modifyLiquidity with 0 delta
        ModifyLiquidityParams memory modifyParams = ModifyLiquidityParams({
            tickLower: pos.tickLower,
            tickUpper: pos.tickUpper,
            liquidityDelta: 0, // Zero delta = collect fees only
            salt: bytes32(0)
        });

        (BalanceDelta delta,) = poolManager.modifyLiquidity(pos.key, modifyParams, "");

        // FLASH ACCOUNTING: Take collected fees from PoolManager
        uint256 fee0 = delta.amount0() > 0 ? uint256(int256(delta.amount0())) : 0;
        uint256 fee1 = delta.amount1() > 0 ? uint256(int256(delta.amount1())) : 0;

        if (fee0 > 0) {
            _take(pos.key.currency0, address(this), fee0);
        }
        if (fee1 > 0) {
            _take(pos.key.currency1, address(this), fee1);
        }

        return abi.encode(fee0, fee1);
    }

    /**
     * @dev Handle auto-compound with REAL V4 operations
     * @notice Collects fees and reinvests them in a single transaction
     */
    function _handleAutoCompound(bytes calldata data) internal returns (bytes memory) {
        (, uint256 id) = abi.decode(data, (Action, uint256));

        Position storage pos = positions[id];

        // STEP 1: Collect fees (modifyLiquidity with 0 delta)
        ModifyLiquidityParams memory collectParams = ModifyLiquidityParams({
            tickLower: pos.tickLower,
            tickUpper: pos.tickUpper,
            liquidityDelta: 0, // Zero delta = collect fees only
            salt: bytes32(0)
        });

        (BalanceDelta feeDelta,) = poolManager.modifyLiquidity(pos.key, collectParams, "");

        // Extract collected fees
        uint256 fee0 = feeDelta.amount0() > 0 ? uint256(int256(feeDelta.amount0())) : 0;
        uint256 fee1 = feeDelta.amount1() > 0 ? uint256(int256(feeDelta.amount1())) : 0;

        // Take fees from PoolManager
        if (fee0 > 0) {
            _take(pos.key.currency0, address(this), fee0);
        }
        if (fee1 > 0) {
            _take(pos.key.currency1, address(this), fee1);
        }

        // If no fees collected, return early
        if (fee0 == 0 && fee1 == 0) {
            return abi.encode(0, 0, uint128(0));
        }

        // STEP 2: Calculate liquidity from collected fees
        (uint160 sqrtPriceX96,,,) = StateLibrary.getSlot0(poolManager, pos.key.toId());

        uint160 sqrtPriceAX96 = TickMath.getSqrtPriceAtTick(pos.tickLower);
        uint160 sqrtPriceBX96 = TickMath.getSqrtPriceAtTick(pos.tickUpper);

        // Calculate how much liquidity we can add with the collected fees
        uint128 liquidityToAdd = LiquidityAmounts.getLiquidityForAmounts(
            sqrtPriceX96,
            sqrtPriceAX96,
            sqrtPriceBX96,
            fee0,
            fee1
        );

        // STEP 3: Add liquidity back to position (reinvest fees)
        if (liquidityToAdd > 0) {
            ModifyLiquidityParams memory addParams = ModifyLiquidityParams({
                tickLower: pos.tickLower,
                tickUpper: pos.tickUpper,
                liquidityDelta: int256(uint256(liquidityToAdd)),
                salt: bytes32(0)
            });

            (BalanceDelta addDelta,) = poolManager.modifyLiquidity(pos.key, addParams, "");

            // FLASH ACCOUNTING: Settle tokens with PoolManager
            uint256 used0;
            uint256 used1;

            if (addDelta.amount0() < 0) {
                used0 = uint256(uint128(-addDelta.amount0()));
                _settle(pos.key.currency0, used0);
            }
            if (addDelta.amount1() < 0) {
                used1 = uint256(uint128(-addDelta.amount1()));
                _settle(pos.key.currency1, used1);
            }

            // Handle any leftover fees (refund to user if fees > what was needed)
            uint256 leftover0 = fee0 > used0 ? fee0 - used0 : 0;
            uint256 leftover1 = fee1 > used1 ? fee1 - used1 : 0;

            if (leftover0 > 0) {
                _transferOut(pos.key.currency0, pos.owner, leftover0);
            }
            if (leftover1 > 0) {
                _transferOut(pos.key.currency1, pos.owner, leftover1);
            }
        }

        return abi.encode(fee0, fee1, liquidityToAdd);
    }

    /**
     * @dev Handle move range - withdraw from old position and create new position
     */
    function _handleMoveRange(bytes calldata data) internal returns (bytes memory) {
        (
            ,
            uint256 oldId,
            int24 newTickLower,
            int24 newTickUpper,
            uint256 amount0Min,
            uint256 amount1Min
        ) = abi.decode(data, (Action, uint256, int24, int24, uint256, uint256));

        Position storage oldPos = positions[oldId];

        // STEP 1: Withdraw all liquidity from old position
        ModifyLiquidityParams memory withdrawParams = ModifyLiquidityParams({
            tickLower: oldPos.tickLower,
            tickUpper: oldPos.tickUpper,
            liquidityDelta: -int256(uint256(oldPos.liquidity)),
            salt: bytes32(0)
        });

        (BalanceDelta withdrawDelta,) = poolManager.modifyLiquidity(oldPos.key, withdrawParams, "");

        // Take withdrawn tokens from PoolManager
        uint256 amount0;
        uint256 amount1;

        if (withdrawDelta.amount0() > 0) {
            amount0 = uint256(int256(withdrawDelta.amount0()));
            _take(oldPos.key.currency0, address(this), amount0);
        }
        if (withdrawDelta.amount1() > 0) {
            amount1 = uint256(int256(withdrawDelta.amount1()));
            _take(oldPos.key.currency1, address(this), amount1);
        }

        // STEP 2: Calculate optimal liquidity for new range
        (uint160 sqrtPriceX96,,,) = StateLibrary.getSlot0(poolManager, oldPos.key.toId());
        uint160 sqrtPriceAX96 = TickMath.getSqrtPriceAtTick(newTickLower);
        uint160 sqrtPriceBX96 = TickMath.getSqrtPriceAtTick(newTickUpper);

        uint128 newLiquidity = LiquidityAmounts.getLiquidityForAmounts(
            sqrtPriceX96,
            sqrtPriceAX96,
            sqrtPriceBX96,
            amount0,
            amount1
        );

        // STEP 3: Create new position at new range
        ModifyLiquidityParams memory addParams = ModifyLiquidityParams({
            tickLower: newTickLower,
            tickUpper: newTickUpper,
            liquidityDelta: int256(uint256(newLiquidity)),
            salt: bytes32(0)
        });

        (BalanceDelta addDelta,) = poolManager.modifyLiquidity(oldPos.key, addParams, "");

        // Settle tokens with PoolManager
        uint256 used0;
        uint256 used1;

        if (addDelta.amount0() < 0) {
            used0 = uint256(uint128(-addDelta.amount0()));
            _settle(oldPos.key.currency0, used0);
        }
        if (addDelta.amount1() < 0) {
            used1 = uint256(uint128(-addDelta.amount1()));
            _settle(oldPos.key.currency1, used1);
        }

        // Slippage check
        if (used0 < amount0Min || used1 < amount1Min) {
            revert SlippageCheckFailed(used0 < amount0Min ? used0 : used1, used0 < amount0Min ? amount0Min : amount1Min);
        }

        // STEP 4: Create new position record
        uint256 newId = _nextTokenId++;

        positions[newId] = Position({
            key: oldPos.key,
            owner: oldPos.owner,
            tickLower: newTickLower,
            tickUpper: newTickUpper,
            liquidity: newLiquidity
        });

        // STEP 5: Refund leftover tokens to user
        uint256 leftover0 = amount0 > used0 ? amount0 - used0 : 0;
        uint256 leftover1 = amount1 > used1 ? amount1 - used1 : 0;

        if (leftover0 > 0) {
            _transferOut(oldPos.key.currency0, oldPos.owner, leftover0);
        }
        if (leftover1 > 0) {
            _transferOut(oldPos.key.currency1, oldPos.owner, leftover1);
        }

        // STEP 6: Delete old position
        delete positions[oldId];

        return abi.encode(newId, newLiquidity);
    }

    /**
     * @dev Handle position burn with REAL V4 operations
     * @notice Burns position by removing all liquidity and collecting all fees
     */
    function _handleBurn(bytes calldata data) internal returns (bytes memory) {
        (, uint256 id, uint256 amt0Min, uint256 amt1Min) =
            abi.decode(data, (Action, uint256, uint256, uint256));

        Position storage pos = positions[id];

        // Step 1: Remove all liquidity (negative delta)
        ModifyLiquidityParams memory modifyParams = ModifyLiquidityParams({
            tickLower: pos.tickLower,
            tickUpper: pos.tickUpper,
            liquidityDelta: -int256(uint256(pos.liquidity)),
            salt: bytes32(0)
        });

        (BalanceDelta delta,) = poolManager.modifyLiquidity(pos.key, modifyParams, "");

        // FLASH ACCOUNTING: Take tokens from PoolManager
        // Note: This includes both liquidity AND accumulated fees
        uint256 amount0 = delta.amount0() > 0 ? uint256(int256(delta.amount0())) : 0;
        uint256 amount1 = delta.amount1() > 0 ? uint256(int256(delta.amount1())) : 0;

        if (amount0 > 0) {
            _take(pos.key.currency0, address(this), amount0);
        }
        if (amount1 > 0) {
            _take(pos.key.currency1, address(this), amount1);
        }

        // SLIPPAGE PROTECTION: Ensure we receive at least minimum amounts
        if (amount0 < amt0Min) {
            revert SlippageCheckFailed(amount0, amt0Min);
        }
        if (amount1 < amt1Min) {
            revert SlippageCheckFailed(amount1, amt1Min);
        }

        return abi.encode(amount0, amount1);
    }

    /**
     * @dev Handle swap with REAL V4 operations
     * @notice Executes token swap via PoolManager.swap()
     */
    function _handleSwap(bytes calldata data) internal returns (bytes memory) {
        (, PoolKey memory key, bool zeroForOne, int256 amountSpecified, uint160 sqrtPriceLimitX96) =
            abi.decode(data, (Action, PoolKey, bool, int256, uint160));

        // REAL V4 OPERATION: Execute swap via PoolManager
        SwapParams memory swapParams = SwapParams({
            zeroForOne: zeroForOne,
            amountSpecified: amountSpecified,
            sqrtPriceLimitX96: sqrtPriceLimitX96
        });

        BalanceDelta delta = poolManager.swap(key, swapParams, "");

        // FLASH ACCOUNTING: Settle/take based on delta
        int256 amount0 = delta.amount0();
        int256 amount1 = delta.amount1();

        // Settle tokens we owe (negative delta)
        if (amount0 < 0) {
            _settle(key.currency0, uint256(-amount0));
        } else if (amount0 > 0) {
            // Take tokens pool owes us (positive delta)
            _take(key.currency0, address(this), uint256(amount0));
        }

        if (amount1 < 0) {
            _settle(key.currency1, uint256(-amount1));
        } else if (amount1 > 0) {
            _take(key.currency1, address(this), uint256(amount1));
        }

        return abi.encode(amount0, amount1);
    }

    /**
     * @dev Settle tokens with PoolManager (flash accounting pattern)
     * @param currency The currency to settle
     * @param amount The amount to settle
     */
    function _settle(Currency currency, uint256 amount) internal {
        if (amount == 0) return;

        if (currency.isAddressZero()) {
            // Settle native ETH
            poolManager.settle{value: amount}();
        } else {
            // Sync, transfer, and settle ERC20
            address token = Currency.unwrap(currency);
            poolManager.sync(currency);
            IERC20(token).safeTransfer(address(poolManager), amount);
            poolManager.settle();
        }
    }

    /**
     * @dev Take tokens from PoolManager (flash accounting pattern)
     * @param currency The currency to take
     * @param recipient The recipient address
     * @param amount The amount to take
     */
    function _take(Currency currency, address recipient, uint256 amount) internal {
        if (amount == 0) return;

        poolManager.take(currency, recipient, amount);
    }

    /**
     * @dev Transfer tokens in (supports both ERC20 and native ETH)
     */
    function _transferIn(Currency currency, address from, uint256 amount) internal {
        if (amount == 0) return;

        if (currency.isAddressZero()) {
            if (msg.value < amount) revert InsufficientETH();
        } else {
            IERC20(Currency.unwrap(currency)).safeTransferFrom(from, address(this), amount);
        }
    }

    /**
     * @dev Transfer tokens out (supports both ERC20 and native ETH)
     */
    function _transferOut(Currency currency, address to, uint256 amount) internal {
        if (amount == 0) return;

        if (currency.isAddressZero()) {
            (bool success,) = to.call{value: amount}("");
            require(success, "ETH transfer failed");
        } else {
            IERC20(Currency.unwrap(currency)).safeTransfer(to, amount);
        }
    }

    /**
     * @dev Build PoolKey from adapter params
     */
    function _buildPoolKey(IAdapter.PoolData memory pool) internal pure returns (PoolKey memory) {
        address hooks = pool.extraData.length >= 32 ? abi.decode(pool.extraData, (address)) : address(0);

        return PoolKey({
            currency0: Currency.wrap(pool.token0),
            currency1: Currency.wrap(pool.token1),
            fee: pool.fee,
            tickSpacing: _getTickSpacing(pool.fee),
            hooks: IHooks(hooks)
        });
    }

    /**
     * @dev Get tick spacing for fee tier
     */
    function _getTickSpacing(uint24 fee) internal pure returns (int24) {
        if (fee == 100) return 1;
        if (fee == 500) return 10;
        if (fee == 3000) return 60;
        if (fee == 10000) return 200;
        return 60;
    }

    // ==================== POOL EXPLORER VIEW FUNCTIONS ====================

    /**
     * @notice Get current pool information
     * @param poolData Pool configuration
     * @return sqrtPriceX96 Current sqrt price
     * @return tick Current tick
     * @return protocolFee Protocol fee
     * @return lpFee LP fee
     */
    function getPoolInfo(IAdapter.PoolData calldata poolData)
        external
        view
        returns (
            uint160 sqrtPriceX96,
            int24 tick,
            uint24 protocolFee,
            uint24 lpFee
        )
    {
        PoolKey memory key = _buildPoolKey(poolData);
        (sqrtPriceX96, tick, protocolFee, lpFee) = StateLibrary.getSlot0(poolManager, key.toId());
    }

    /**
     * @notice Get position information
     * @param tokenId Position ID
     * @return owner Position owner
     * @return token0 First token address
     * @return token1 Second token address
     * @return tickLower Lower tick
     * @return tickUpper Upper tick
     * @return liquidity Current liquidity
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
        )
    {
        Position storage pos = positions[tokenId];
        return (
            pos.owner,
            Currency.unwrap(pos.key.currency0),
            Currency.unwrap(pos.key.currency1),
            pos.tickLower,
            pos.tickUpper,
            pos.liquidity
        );
    }

    /**
     * @notice Check if position is currently in range
     * @param tokenId Position ID
     * @return inRange True if current price is within position's range
     */
    function isPositionInRange(uint256 tokenId) external view returns (bool inRange) {
        Position storage pos = positions[tokenId];

        // Get current tick
        (, int24 currentTick,,) = StateLibrary.getSlot0(poolManager, pos.key.toId());

        // Check if current tick is within range
        inRange = currentTick >= pos.tickLower && currentTick <= pos.tickUpper;
    }

    /**
     * @notice Get position health (distance from edge of range)
     * @param tokenId Position ID
     * @return health Health percentage (100 = in middle, 0 = at edge or out of range)
     */
    function getPositionHealth(uint256 tokenId) external view returns (uint256 health) {
        Position storage pos = positions[tokenId];

        // Get current tick
        (, int24 currentTick,,) = StateLibrary.getSlot0(poolManager, pos.key.toId());

        // If out of range, health is 0
        if (currentTick < pos.tickLower || currentTick > pos.tickUpper) {
            return 0;
        }

        // Calculate position in range (0 to 100)
        int24 rangeSize = pos.tickUpper - pos.tickLower;
        if (rangeSize == 0) return 100;

        int24 distanceFromLower = currentTick - pos.tickLower;
        int24 distanceFromUpper = pos.tickUpper - currentTick;

        // Health is based on distance from nearest edge
        // 100 = in middle, 0 = at edge
        int24 distanceFromEdge = distanceFromLower < distanceFromUpper ? distanceFromLower : distanceFromUpper;

        // Calculate as percentage of half-range
        // Convert int24 to uint256 safely
        uint256 edgeDistance = distanceFromEdge >= 0 ? uint256(int256(distanceFromEdge)) : 0;
        uint256 rangeSizeUint = rangeSize >= 0 ? uint256(int256(rangeSize)) : 0;

        if (rangeSizeUint > 0) {
            health = edgeDistance * 200 / rangeSizeUint;
            if (health > 100) health = 100;
        } else {
            health = 100;
        }
    }

    /**
     * @notice Get estimated position value in token terms
     * @param tokenId Position ID
     * @return amount0 Estimated amount of token0
     * @return amount1 Estimated amount of token1
     */
    function getPositionValue(uint256 tokenId)
        external
        view
        returns (uint256 amount0, uint256 amount1)
    {
        Position storage pos = positions[tokenId];

        if (pos.liquidity == 0) {
            return (0, 0);
        }

        // Get current price
        (uint160 sqrtPriceX96,,,) = StateLibrary.getSlot0(poolManager, pos.key.toId());

        // Get sqrt prices at tick boundaries
        uint160 sqrtPriceAX96 = TickMath.getSqrtPriceAtTick(pos.tickLower);
        uint160 sqrtPriceBX96 = TickMath.getSqrtPriceAtTick(pos.tickUpper);

        // Calculate amounts using Uniswap V4 math (reverse of getLiquidityForAmounts)
        // Based on official Uniswap formulas
        if (sqrtPriceX96 <= sqrtPriceAX96) {
            // Price below range - all token1
            // amount1 = liquidity * (sqrtPriceA - sqrtPriceX96) / 2^96
            amount0 = 0;
            amount1 = FullMath.mulDiv(
                pos.liquidity,
                sqrtPriceAX96 - sqrtPriceX96,
                FixedPoint96.Q96
            );
        } else if (sqrtPriceX96 >= sqrtPriceBX96) {
            // Price above range - all token0
            // amount0 = liquidity * (sqrtPriceB - sqrtPriceX96) / (sqrtPriceX96 * sqrtPriceB / 2^96)
            amount0 = FullMath.mulDiv(
                pos.liquidity,
                sqrtPriceBX96 - sqrtPriceAX96,
                FullMath.mulDiv(sqrtPriceBX96, sqrtPriceAX96, FixedPoint96.Q96)
            );
            amount1 = 0;
        } else {
            // Price in range - both tokens
            // amount0 = liquidity * (sqrtPriceB - sqrtPriceX96) / (sqrtPriceX96 * sqrtPriceB / 2^96)
            amount0 = FullMath.mulDiv(
                pos.liquidity,
                sqrtPriceBX96 - sqrtPriceX96,
                FullMath.mulDiv(sqrtPriceBX96, sqrtPriceX96, FixedPoint96.Q96)
            );
            // amount1 = liquidity * (sqrtPriceX96 - sqrtPriceA) / 2^96
            amount1 = FullMath.mulDiv(
                pos.liquidity,
                sqrtPriceX96 - sqrtPriceAX96,
                FixedPoint96.Q96
            );
        }
    }

    /**
     * @notice Get pool liquidity
     * @param poolData Pool configuration
     * @return liquidity Total pool liquidity
     */
    function getPoolLiquidity(IAdapter.PoolData calldata poolData)
        external
        view
        returns (uint128 liquidity)
    {
        PoolKey memory key = _buildPoolKey(poolData);
        liquidity = StateLibrary.getLiquidity(poolManager, key.toId());
    }
}
