
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "./IAdapter.sol";

/**
 * @title LPManagerV1
 * @notice Main liquidity management contract using the Adapter pattern
 * @dev UUPS upgradeable contract that manages user positions across multiple DEXs
 */
contract LPManagerV1 is UUPSUpgradeable, OwnableUpgradeable, ReentrancyGuardUpgradeable {
    using SafeERC20 for IERC20;

    /// @notice Protocol fee in basis points (200 = 2%)
    uint256 public protocolFeeBps;

    /// @notice Address receiving protocol fees
    address public feeCollector;

    /// @notice Counter for generating unique position IDs
    uint256 private _nextPositionId;

    /// @notice Position data structure
    struct Position {
        string protocol; // e.g., "UNISWAP_V4"
        uint256 dexTokenId; // The actual position ID in the DEX
        address owner; // Position owner
        address token0; // First token
        address token1; // Second token
        bool active; // Whether position is active
    }

    /// @notice Mapping from position ID to position data
    mapping(uint256 => Position) public positions;

    /// @notice Mapping from protocol name to adapter address
    mapping(bytes32 => address) public adapters;

    /// @notice Events
    event AdapterRegistered(string protocol, address adapter);
    event PositionOpened(
        uint256 indexed positionId,
        address indexed owner,
        string protocol,
        uint256 dexTokenId
    );
    event PositionClosed(
        uint256 indexed positionId,
        uint256 amount0,
        uint256 amount1
    );
    event LiquidityIncreased(uint256 indexed positionId, uint128 liquidity);
    event FeesCollected(
        uint256 indexed positionId,
        uint256 amount0,
        uint256 amount1,
        uint256 protocolFee0,
        uint256 protocolFee1
    );
    event Compounded(uint256 indexed positionId, uint128 addedLiquidity);
    event RangeMoved(
        uint256 indexed oldPositionId,
        uint256 indexed newPositionId,
        int24 newTickLower,
        int24 newTickUpper
    );
    event FeeCollectorUpdated(address newFeeCollector);
    event ProtocolFeeUpdated(uint256 newFeeBps);

    /// @notice Errors
    error InvalidFeeCollector();
    error InvalidProtocolFee();
    error InvalidAdapter();
    error PositionNotFound();
    error Unauthorized();
    error AdapterNotFound();
    error InsufficientFees();

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    /**
     * @notice Initialize the contract
     * @param _feeCollector Address to receive protocol fees
     */
    function initialize(address _feeCollector) public initializer {
        __UUPSUpgradeable_init();
        __Ownable_init(msg.sender);
        __ReentrancyGuard_init();

        if (_feeCollector == address(0)) revert InvalidFeeCollector();

        feeCollector = _feeCollector;
        protocolFeeBps = 200; // 2%
        _nextPositionId = 1;

        emit FeeCollectorUpdated(_feeCollector);
        emit ProtocolFeeUpdated(200);
    }

    /**
     * @notice Register a new DEX adapter
     * @param protocol Protocol name (e.g., "UNISWAP_V4")
     * @param adapter Adapter contract address
     */
    function registerAdapter(string calldata protocol, address adapter) external onlyOwner {
        if (adapter == address(0)) revert InvalidAdapter();
        bytes32 protocolHash = keccak256(bytes(protocol));
        adapters[protocolHash] = adapter;
        emit AdapterRegistered(protocol, adapter);
    }

    /**
     * @notice Add liquidity to a DEX through an adapter
     * @param protocol Protocol name
     * @param params Liquidity parameters
     * @return positionId The created position ID
     */
    function addLiquidity(string calldata protocol, IAdapter.LiquidityParams calldata params)
        external
        nonReentrant
        returns (uint256 positionId)
    {
        // Get adapter
        bytes32 protocolHash = keccak256(bytes(protocol));
        address adapter = adapters[protocolHash];
        if (adapter == address(0)) revert AdapterNotFound();

        // Transfer tokens from user to this contract
        IERC20(params.pool.token0).safeTransferFrom(
            msg.sender,
            address(this),
            params.amount0Desired
        );
        IERC20(params.pool.token1).safeTransferFrom(
            msg.sender,
            address(this),
            params.amount1Desired
        );

        // Approve adapter to spend tokens
        IERC20(params.pool.token0).forceApprove(adapter, params.amount0Desired);
        IERC20(params.pool.token1).forceApprove(adapter, params.amount1Desired);

        // Create modified params with this contract as recipient
        IAdapter.LiquidityParams memory adapterParams = params;
        adapterParams.recipient = address(this);

        // Open position through adapter (deadline: 1 hour from now)
        (uint256 dexTokenId, uint128 liquidity) = IAdapter(adapter).openPosition(adapterParams, block.timestamp + 3600);

        // Create position record
        positionId = _nextPositionId++;
        positions[positionId] = Position({
            protocol: protocol,
            dexTokenId: dexTokenId,
            owner: msg.sender,
            token0: params.pool.token0,
            token1: params.pool.token1,
            active: true
        });

        emit PositionOpened(positionId, msg.sender, protocol, dexTokenId);

        // Refund any unused tokens
        _refundDust(params.pool.token0, params.pool.token1, msg.sender);
    }

    /**
     * @notice Compound fees back into the position
     * @param positionId The position ID
     * @param doSwap Whether to perform token swapping for rebalancing
     * @param swapData Swap parameters (if doSwap is true)
     * @return addedLiquidity The amount of liquidity added
     */
    function compound(
        uint256 positionId,
        bool doSwap,
        bytes calldata swapData
    ) external nonReentrant returns (uint128 addedLiquidity) {
        Position storage position = positions[positionId];
        if (!position.active) revert PositionNotFound();
        if (position.owner != msg.sender) revert Unauthorized();

        // Get adapter
        bytes32 protocolHash = keccak256(bytes(position.protocol));
        address adapter = adapters[protocolHash];

        // Step 1: Collect fees (deadline: 1 hour from now)
        (uint256 amount0, uint256 amount1) = IAdapter(adapter).collectFees(position.dexTokenId, block.timestamp + 3600);

        if (amount0 == 0 && amount1 == 0) revert InsufficientFees();

        // Step 2: Calculate and transfer protocol fee (2%)
        uint256 protocolFee0 = (amount0 * protocolFeeBps) / 10000;
        uint256 protocolFee1 = (amount1 * protocolFeeBps) / 10000;

        if (protocolFee0 > 0) {
            IERC20(position.token0).safeTransfer(feeCollector, protocolFee0);
        }
        if (protocolFee1 > 0) {
            IERC20(position.token1).safeTransfer(feeCollector, protocolFee1);
        }

        emit FeesCollected(positionId, amount0, amount1, protocolFee0, protocolFee1);

        // Remaining amounts after fee
        uint256 remaining0 = amount0 - protocolFee0;
        uint256 remaining1 = amount1 - protocolFee1;

        // Step 3: Optional swap for rebalancing
        if (doSwap && swapData.length > 0) {
            (remaining0, remaining1) = _performSwap(
                positionId,
                position.token0,
                position.token1,
                remaining0,
                remaining1,
                swapData
            );
        }

        // Step 4: Reinvest into position
        if (remaining0 > 0 || remaining1 > 0) {
            IERC20(position.token0).forceApprove(adapter, remaining0);
            IERC20(position.token1).forceApprove(adapter, remaining1);

            addedLiquidity = IAdapter(adapter).increaseLiquidity(
                position.dexTokenId,
                remaining0,
                remaining1,
                0, // No slippage protection for reinvestment
                0, // No slippage protection for reinvestment
                block.timestamp + 3600 // 1 hour deadline
            );

            emit Compounded(positionId, addedLiquidity);
        }

        // Refund any dust
        _refundDust(position.token0, position.token1, msg.sender);
    }

    /**
     * @notice Increase liquidity in an existing position
     * @param positionId The position ID
     * @param amount0 Amount of token0 to add
     * @param amount1 Amount of token1 to add
     * @param amount0Min Minimum amount of token0 (slippage protection)
     * @param amount1Min Minimum amount of token1 (slippage protection)
     */
    function increaseLiquidity(
        uint256 positionId,
        uint256 amount0,
        uint256 amount1,
        uint256 amount0Min,
        uint256 amount1Min
    ) external nonReentrant {
        Position storage position = positions[positionId];
        if (!position.active) revert PositionNotFound();
        if (position.owner != msg.sender) revert Unauthorized();

        // Get adapter
        bytes32 protocolHash = keccak256(bytes(position.protocol));
        address adapter = adapters[protocolHash];

        // Transfer tokens from user to this contract
        if (amount0 > 0) {
            IERC20(position.token0).safeTransferFrom(msg.sender, address(this), amount0);
            IERC20(position.token0).forceApprove(adapter, amount0);
        }
        if (amount1 > 0) {
            IERC20(position.token1).safeTransferFrom(msg.sender, address(this), amount1);
            IERC20(position.token1).forceApprove(adapter, amount1);
        }

        // Call adapter to increase liquidity
        IAdapter(adapter).increaseLiquidity(
            position.dexTokenId,
            amount0,
            amount1,
            amount0Min,
            amount1Min,
            block.timestamp + 3600
        );

        // Refund any unused tokens
        _refundDust(position.token0, position.token1, msg.sender);
    }

    /**
     * @notice Decrease liquidity from a position
     * @param positionId The position ID
     * @param liquidity Amount of liquidity to remove
     * @param amount0Min Minimum amount of token0 (slippage protection)
     * @param amount1Min Minimum amount of token1 (slippage protection)
     */
    function decreaseLiquidity(
        uint256 positionId,
        uint128 liquidity,
        uint256 amount0Min,
        uint256 amount1Min
    ) external nonReentrant {
        Position storage position = positions[positionId];
        if (!position.active) revert PositionNotFound();
        if (position.owner != msg.sender) revert Unauthorized();

        // Get adapter
        bytes32 protocolHash = keccak256(bytes(position.protocol));
        address adapter = adapters[protocolHash];

        // Remove liquidity
        (uint256 amount0, uint256 amount1) = IAdapter(adapter).decreaseLiquidity(
            position.dexTokenId,
            liquidity,
            amount0Min,
            amount1Min,
            block.timestamp + 3600
        );

        // Transfer tokens to user
        if (amount0 > 0) {
            IERC20(position.token0).safeTransfer(msg.sender, amount0);
        }
        if (amount1 > 0) {
            IERC20(position.token1).safeTransfer(msg.sender, amount1);
        }

        // Refund any dust
        _refundDust(position.token0, position.token1, msg.sender);
    }

    /**
     * @notice Collect accumulated fees from a position
     * @param positionId The position ID
     */
    function collectFees(uint256 positionId) external nonReentrant {
        Position storage position = positions[positionId];
        if (!position.active) revert PositionNotFound();
        if (position.owner != msg.sender) revert Unauthorized();

        // Get adapter
        bytes32 protocolHash = keccak256(bytes(position.protocol));
        address adapter = adapters[protocolHash];

        // Collect fees
        (uint256 amount0, uint256 amount1) = IAdapter(adapter).collectFees(
            position.dexTokenId,
            block.timestamp + 3600
        );

        // Transfer fees to user
        if (amount0 > 0) {
            IERC20(position.token0).safeTransfer(msg.sender, amount0);
        }
        if (amount1 > 0) {
            IERC20(position.token1).safeTransfer(msg.sender, amount1);
        }

        // Refund any dust
        _refundDust(position.token0, position.token1, msg.sender);
    }

    /**
     * @notice Close a position and withdraw liquidity
     * @param positionId The position ID
     * @param liquidity Amount of liquidity to remove
     */
    function closePosition(uint256 positionId, uint128 liquidity) external nonReentrant {
        Position storage position = positions[positionId];
        if (!position.active) revert PositionNotFound();
        if (position.owner != msg.sender) revert Unauthorized();

        // Get adapter
        bytes32 protocolHash = keccak256(bytes(position.protocol));
        address adapter = adapters[protocolHash];

        // Remove liquidity (deadline: 1 hour from now)
        // Note: decreaseLiquidity automatically includes accumulated fees in the returned amounts
        (uint256 amount0, uint256 amount1) = IAdapter(adapter).decreaseLiquidity(
            position.dexTokenId,
            liquidity,
            0, // No slippage protection for closing
            0, // No slippage protection for closing
            block.timestamp + 3600
        );

        // No need to call collectFees separately - fees are already included in amount0/amount1
        // Calling collectFees on a zero-liquidity position would revert with CannotUpdateEmptyPosition

        // Transfer tokens to user
        if (amount0 > 0) {
            IERC20(position.token0).safeTransfer(msg.sender, amount0);
        }
        if (amount1 > 0) {
            IERC20(position.token1).safeTransfer(msg.sender, amount1);
        }

        // Query remaining liquidity from adapter
        (, , , , , uint128 remainingLiquidity) = IAdapter(adapter).getPositionInfo(position.dexTokenId);

        // Only mark as inactive if position is fully closed (no remaining liquidity)
        if (remainingLiquidity == 0) {
            position.active = false;
        }

        emit PositionClosed(positionId, amount0, amount1);

        // Refund any dust
        _refundDust(position.token0, position.token1, msg.sender);
    }

    /**
     * @notice Reactivate a position that was incorrectly marked as inactive
     * @param positionId The position ID to reactivate
     * @dev Owner-only function to fix positions that still have liquidity but were marked inactive
     */
    function reactivatePosition(uint256 positionId) external onlyOwner {
        Position storage position = positions[positionId];

        // Get adapter and check if position still has liquidity
        bytes32 protocolHash = keccak256(bytes(position.protocol));
        address adapter = adapters[protocolHash];

        (, , , , , uint128 remainingLiquidity) = IAdapter(adapter).getPositionInfo(position.dexTokenId);

        // Only reactivate if there's liquidity remaining
        if (remainingLiquidity > 0) {
            position.active = true;
            emit PositionOpened(positionId, position.owner, position.protocol, position.dexTokenId);
        }
    }

    /**
     * @notice Update fee collector address
     * @param newFeeCollector New fee collector address
     */
    function setFeeCollector(address newFeeCollector) external onlyOwner {
        if (newFeeCollector == address(0)) revert InvalidFeeCollector();
        feeCollector = newFeeCollector;
        emit FeeCollectorUpdated(newFeeCollector);
    }

    /**
     * @notice Update protocol fee
     * @param newFeeBps New fee in basis points (max 1000 = 10%)
     */
    function setProtocolFee(uint256 newFeeBps) external onlyOwner {
        if (newFeeBps > 1000) revert InvalidProtocolFee();
        protocolFeeBps = newFeeBps;
        emit ProtocolFeeUpdated(newFeeBps);
    }

    /**
     * @notice Get adapter address for a protocol
     * @param protocol Protocol name
     * @return Adapter address
     */
    function getAdapter(string calldata protocol) external view returns (address) {
        return adapters[keccak256(bytes(protocol))];
    }

    /**
     * @dev Internal function to perform token swaps for rebalancing
     * @param positionId The position ID
     * @param token0 First token address
     * @param token1 Second token address
     * @param amount0 Current amount of token0
     * @param amount1 Current amount of token1
     * @param swapData Encoded swap parameters (poolData, zeroForOne, amountToSwap)
     * @return newAmount0 Amount of token0 after swap
     * @return newAmount1 Amount of token1 after swap
     */
    function _performSwap(
        uint256 positionId,
        address token0,
        address token1,
        uint256 amount0,
        uint256 amount1,
        bytes calldata swapData
    ) internal virtual returns (uint256 newAmount0, uint256 newAmount1) {
        // Decode swap parameters
        (IAdapter.PoolData memory poolData, bool zeroForOne, uint256 amountToSwap) =
            abi.decode(swapData, (IAdapter.PoolData, bool, uint256));

        // Get adapter for this position's protocol using the correct position ID
        Position storage position = positions[positionId];
        if (!position.active) revert PositionNotFound();

        bytes32 protocolHash = keccak256(bytes(position.protocol));
        address adapter = adapters[protocolHash];

        if (adapter == address(0) || amountToSwap == 0) {
            // No swap needed or adapter not found
            return (amount0, amount1);
        }

        // Validate swap amount doesn't exceed available balance
        if (zeroForOne) {
            if (amountToSwap > amount0) revert("Swap amount exceeds balance");
        } else {
            if (amountToSwap > amount1) revert("Swap amount exceeds balance");
        }

        // Approve adapter to spend the input token
        address tokenIn = zeroForOne ? token0 : token1;
        IERC20(tokenIn).forceApprove(adapter, amountToSwap);

        // Execute swap via adapter (negative amountSpecified = exact input)
        (int256 delta0, int256 delta1) = IAdapter(adapter).swap(
            poolData,
            zeroForOne,
            -int256(amountToSwap), // Negative = exact input swap
            0, // No price limit (use default)
            block.timestamp + 3600 // 1 hour deadline
        );

        // Calculate new amounts based on deltas
        // Negative delta = we paid, positive delta = we received
        if (zeroForOne) {
            // Swapped token0 for token1
            // delta0 should be negative (we paid token0)
            // delta1 should be positive (we received token1)
            uint256 paid0 = delta0 < 0 ? uint256(-delta0) : 0;
            uint256 received1 = delta1 > 0 ? uint256(delta1) : 0;

            // Ensure we didn't pay more than we intended
            if (paid0 > amountToSwap) revert("Swap consumed more than expected");

            newAmount0 = amount0 - paid0;
            newAmount1 = amount1 + received1;
        } else {
            // Swapped token1 for token0
            // delta1 should be negative (we paid token1)
            // delta0 should be positive (we received token0)
            uint256 received0 = delta0 > 0 ? uint256(delta0) : 0;
            uint256 paid1 = delta1 < 0 ? uint256(-delta1) : 0;

            // Ensure we didn't pay more than we intended
            if (paid1 > amountToSwap) revert("Swap consumed more than expected");

            newAmount0 = amount0 + received0;
            newAmount1 = amount1 - paid1;
        }
    }

    /**
     * @dev Refund any leftover tokens to user
     */
    function _refundDust(address token0, address token1, address recipient) internal {
        uint256 balance0 = IERC20(token0).balanceOf(address(this));
        uint256 balance1 = IERC20(token1).balanceOf(address(this));

        if (balance0 > 0) {
            IERC20(token0).safeTransfer(recipient, balance0);
        }
        if (balance1 > 0) {
            IERC20(token1).safeTransfer(recipient, balance1);
        }
    }

    /**
     * @notice Move position to new range (rebalance)
     * @param oldPositionId Position to move
     * @param newTickLower New lower tick
     * @param newTickUpper New upper tick
     * @param doSwap Whether to swap to optimal ratio
     * @param swapData Swap parameters if doSwap is true
     * @return newPositionId The new position ID
     */
    function moveRange(
        uint256 oldPositionId,
        int24 newTickLower,
        int24 newTickUpper,
        bool doSwap,
        bytes calldata swapData
    ) external nonReentrant returns (uint256 newPositionId) {
        Position storage oldPos = positions[oldPositionId];
        if (!oldPos.active) revert PositionNotFound();
        if (oldPos.owner != msg.sender) revert Unauthorized();

        // Get adapter
        bytes32 protocolHash = keccak256(bytes(oldPos.protocol));
        address adapter = adapters[protocolHash];

        // Use adapter's moveRange which preserves the pool's fee tier
        (uint256 newDexTokenId, uint128 liquidity) = IAdapter(adapter).moveRange(
            oldPos.dexTokenId,
            newTickLower,
            newTickUpper,
            0, // amount0Min - no slippage protection for range moves
            0, // amount1Min
            block.timestamp + 3600
        );

        // Mark old position as inactive
        oldPos.active = false;
        emit PositionClosed(oldPositionId, 0, 0);

        // Create new position record with same pool (preserving fee tier)
        newPositionId = _nextPositionId++;
        positions[newPositionId] = Position({
            protocol: oldPos.protocol,
            dexTokenId: newDexTokenId,
            owner: msg.sender,
            token0: oldPos.token0,
            token1: oldPos.token1,
            active: true
        });

        emit PositionOpened(newPositionId, msg.sender, oldPos.protocol, newDexTokenId);
        emit RangeMoved(oldPositionId, newPositionId, newTickLower, newTickUpper);

        // Refund any dust
        _refundDust(oldPos.token0, oldPos.token1, msg.sender);
    }

    /**
     * @dev Authorize upgrade (UUPS pattern)
     */
    function _authorizeUpgrade(address newImplementation) internal override onlyOwner {}
}
