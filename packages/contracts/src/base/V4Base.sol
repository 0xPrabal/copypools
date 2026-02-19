// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import { IPoolManager } from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import { PoolKey } from "@uniswap/v4-core/src/types/PoolKey.sol";
import { PoolId, PoolIdLibrary } from "@uniswap/v4-core/src/types/PoolId.sol";
import { Currency, CurrencyLibrary } from "@uniswap/v4-core/src/types/Currency.sol";
import { BalanceDelta } from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import { StateLibrary } from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import { TransientStateLibrary } from "@uniswap/v4-core/src/libraries/TransientStateLibrary.sol";
import { IPositionManager } from "@uniswap/v4-periphery/src/interfaces/IPositionManager.sol";
import { PositionInfo, PositionInfoLibrary } from "@uniswap/v4-periphery/src/libraries/PositionInfoLibrary.sol";
import { SlippageCheck } from "@uniswap/v4-periphery/src/libraries/SlippageCheck.sol";
import { IERC721 } from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { ReentrancyGuard } from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import { PausableUpgradeable } from "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
import { OwnableUpgradeable } from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import { UUPSUpgradeable } from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";

/// @title V4Base
/// @notice Base contract for all Revert V4 contracts
/// @dev Provides common functionality for interacting with Uniswap V4
/// @dev NOTE: Uses non-upgradeable ReentrancyGuard to preserve storage layout of deployed proxies.
///      For new deployments (not upgrades of existing proxies), prefer ReentrancyGuardUpgradeable.
abstract contract V4Base is
    ReentrancyGuard,
    PausableUpgradeable,
    OwnableUpgradeable,
    UUPSUpgradeable
{
    using SafeERC20 for IERC20;
    using CurrencyLibrary for Currency;
    using PoolIdLibrary for PoolKey;
    using StateLibrary for IPoolManager;
    using PositionInfoLibrary for PositionInfo;
    using SlippageCheck for BalanceDelta;

    /// @notice The Uniswap V4 PoolManager
    IPoolManager public immutable poolManager;

    /// @notice The Uniswap V4 PositionManager (for NFT positions)
    IPositionManager public immutable positionManager;

    /// @notice WETH9 address
    address public immutable WETH9;

    /// @notice Approved swap routers (0x, 1inch, etc.)
    mapping(address => bool) public approvedRouters;

    /// @notice Operator approvals (address that can execute on behalf of owner)
    mapping(address => mapping(address => bool)) public operatorApprovals;

    /// @notice Error when caller is not position owner or approved
    error NotAuthorized();

    /// @notice Error when deadline has passed
    error DeadlineExpired();

    /// @notice Error when amount is insufficient
    error InsufficientAmount();

    /// @notice Error when router is not approved
    error RouterNotApproved();

    /// @notice Error when position doesn't exist
    error PositionNotFound();

    /// @notice Emitted when router approval changes
    event RouterApprovalChanged(address indexed router, bool approved);

    /// @notice Emitted when operator approval changes
    event OperatorApprovalChanged(address indexed owner, address indexed operator, bool approved);

    /// @notice Modifier to check deadline
    modifier checkDeadline(uint256 deadline) {
        if (block.timestamp > deadline) revert DeadlineExpired();
        _;
    }

    /// @notice Modifier to check position ownership or approval
    modifier onlyPositionOwnerOrApproved(uint256 tokenId) {
        address owner = IERC721(address(positionManager)).ownerOf(tokenId);
        if (
            msg.sender != owner &&
            !IERC721(address(positionManager)).isApprovedForAll(owner, msg.sender) &&
            IERC721(address(positionManager)).getApproved(tokenId) != msg.sender &&
            !operatorApprovals[owner][msg.sender]
        ) {
            revert NotAuthorized();
        }
        _;
    }

    /// @notice Constructor
    /// @param _poolManager The Uniswap V4 PoolManager address
    /// @param _positionManager The Uniswap V4 PositionManager address
    /// @param _weth9 The WETH9 address
    constructor(address _poolManager, address _positionManager, address _weth9) {
        require(_poolManager != address(0), "Zero pool manager");
        require(_positionManager != address(0), "Zero position manager");
        require(_weth9 != address(0), "Zero WETH9");
        poolManager = IPoolManager(_poolManager);
        positionManager = IPositionManager(_positionManager);
        WETH9 = _weth9;
    }

    /// @notice Initialize the contract
    /// @param _owner The owner address
    function __V4Base_init(address _owner) internal onlyInitializing {
        __Pausable_init();
        __Ownable_init(_owner);
    }

    /// @notice Authorize upgrade (UUPS)
    /// @dev M-01: For production, implement a timelock (e.g., 48h delay) via a
    ///      TimelockController or 2-step upgrade pattern to give users time to exit.
    function _authorizeUpgrade(address newImplementation) internal override onlyOwner {}

    /// @notice Set router approval
    /// @param router Router address
    /// @param approved Whether approved
    function setRouterApproval(address router, bool approved) external onlyOwner {
        approvedRouters[router] = approved;
        emit RouterApprovalChanged(router, approved);
    }

    /// @notice Set operator approval
    /// @param operator Operator address
    /// @param approved Whether approved
    function setOperatorApproval(address operator, bool approved) external {
        operatorApprovals[msg.sender][operator] = approved;
        emit OperatorApprovalChanged(msg.sender, operator, approved);
    }

    /// @notice Pause the contract
    function pause() external onlyOwner {
        _pause();
    }

    /// @notice Unpause the contract
    function unpause() external onlyOwner {
        _unpause();
    }

    /// @notice Get position info from PositionManager
    /// @param tokenId The position token ID
    /// @return poolKey The pool key
    /// @return tickLower Lower tick
    /// @return tickUpper Upper tick
    /// @return liquidity The liquidity
    function getPositionInfo(uint256 tokenId)
        public
        view
        returns (PoolKey memory poolKey, int24 tickLower, int24 tickUpper, uint128 liquidity)
    {
        PositionInfo info;
        (poolKey, info) = positionManager.getPoolAndPositionInfo(tokenId);
        tickLower = info.tickLower();
        tickUpper = info.tickUpper();
        liquidity = positionManager.getPositionLiquidity(tokenId);
    }

    /// @notice Transfer currency to recipient
    /// @param currency The currency to transfer
    /// @param to Recipient address
    /// @param amount Amount to transfer
    function _transferCurrency(Currency currency, address to, uint256 amount) internal {
        if (amount == 0) return;

        if (currency.isAddressZero()) {
            (bool success,) = to.call{value: amount}("");
            require(success, "ETH transfer failed");
        } else {
            IERC20(Currency.unwrap(currency)).safeTransfer(to, amount);
        }
    }

    /// @notice Floor division for tick alignment (rounds toward negative infinity)
    /// @dev Solidity's / operator rounds toward zero; this corrects for negative ticks
    function _floorDiv(int24 a, int24 b) internal pure returns (int24) {
        return a / b - (a % b != 0 && (a ^ b) < 0 ? int24(1) : int24(0));
    }

    /// @notice Receive ETH
    receive() external payable {}
}
