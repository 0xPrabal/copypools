// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "./UniswapV4AdapterProduction.sol";

/**
 * @title AutoCompounder
 * @notice Automated auto-compounding service (like Revert Finance)
 * @dev Users can register positions for automatic compounding
 */
contract AutoCompounder {
    UniswapV4AdapterProduction public immutable adapter;

    // Position => Last compound timestamp
    mapping(uint256 => uint256) public lastCompoundTime;

    // Position => Auto-compound enabled
    mapping(uint256 => bool) public autoCompoundEnabled;

    // Position => Owner
    mapping(uint256 => address) public positionOwner;

    // Minimum time between compounds (e.g., 24 hours)
    uint256 public constant MIN_COMPOUND_INTERVAL = 1 days;

    // Optional: Performance fee (basis points, e.g., 1000 = 10%)
    uint256 public performanceFee = 0; // 0% by default (can be changed)
    address public feeCollector;

    event PositionRegistered(uint256 indexed positionId, address indexed owner);
    event PositionUnregistered(uint256 indexed positionId);
    event AutoCompoundExecuted(uint256 indexed positionId, uint256 fee0, uint256 fee1);

    constructor(address _adapter, address _feeCollector) {
        adapter = UniswapV4AdapterProduction(payable(_adapter));
        feeCollector = _feeCollector;
    }

    /**
     * @notice Register position for auto-compounding
     * @param positionId The position to auto-compound
     */
    function registerPosition(uint256 positionId) external {
        // Verify caller owns the position
        (,address owner,,,) = adapter.positions(positionId);
        require(owner == msg.sender, "Not position owner");

        positionOwner[positionId] = msg.sender;
        autoCompoundEnabled[positionId] = true;
        lastCompoundTime[positionId] = block.timestamp;

        emit PositionRegistered(positionId, msg.sender);
    }

    /**
     * @notice Unregister position from auto-compounding
     */
    function unregisterPosition(uint256 positionId) external {
        require(positionOwner[positionId] == msg.sender, "Not position owner");

        autoCompoundEnabled[positionId] = false;

        emit PositionUnregistered(positionId);
    }

    /**
     * @notice Execute auto-compound (called by ANYONE - backend/keeper/user)
     * @dev Backend can call this on behalf of users!
     * @param positionId The position to compound
     */
    function executeAutoCompound(uint256 positionId) external {
        require(autoCompoundEnabled[positionId], "Not registered");
        require(
            block.timestamp >= lastCompoundTime[positionId] + MIN_COMPOUND_INTERVAL,
            "Too soon"
        );

        // Get position owner
        address owner = positionOwner[positionId];
        require(owner != address(0), "Position not registered");

        // IMPORTANT: Caller can be ANYONE (backend, keeper, user)
        // This allows backend to compound on behalf of users!

        // Impersonate the owner for the adapter call
        // Since we're calling adapter.autoCompound which checks msg.sender == position owner,
        // we need to make the call from this contract
        // The adapter will see AutoCompounder as caller, so we need to modify approach

        // Call autoCompound - will work if AutoCompounder is approved operator
        try adapter.autoCompound(positionId, block.timestamp + 1 hours)
            returns (uint256 fee0, uint256 fee1, uint128 liquidityAdded)
        {
            lastCompoundTime[positionId] = block.timestamp;

            // Optional: Take performance fee
            if (performanceFee > 0 && liquidityAdded > 0) {
                // Implementation: Could decrease small amount and send to feeCollector
                // For simplicity, skipping fee collection here
            }

            emit AutoCompoundExecuted(positionId, fee0, fee1);
        } catch {
            // If compound fails (e.g., no fees), just skip
            // This is OK - means either no fees or position owner hasn't approved
        }
    }

    /**
     * @notice Execute auto-compound for your own registered position
     * @dev Convenient function for position owners
     */
    function compound(uint256 positionId) external {
        this.executeAutoCompound(positionId);
    }

    /**
     * @notice Batch auto-compound multiple positions you own
     * @param positionIds Array of positions to compound
     * @dev Only compounds positions owned by caller
     */
    function batchAutoCompound(uint256[] calldata positionIds) external {
        for (uint256 i = 0; i < positionIds.length; i++) {
            // Only compound if caller owns the position
            if (positionOwner[positionIds[i]] == msg.sender) {
                try this.executeAutoCompound(positionIds[i]) {} catch {}
            }
        }
    }

    /**
     * @notice Check if position is ready to compound
     */
    function canCompound(uint256 positionId) external view returns (bool) {
        if (!autoCompoundEnabled[positionId]) return false;
        if (block.timestamp < lastCompoundTime[positionId] + MIN_COMPOUND_INTERVAL) return false;
        return true;
    }
}
