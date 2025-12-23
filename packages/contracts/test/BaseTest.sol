// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import { Test, console2 } from "forge-std/Test.sol";
import { ERC1967Proxy } from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import { ERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import { IPoolManager } from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import { PoolKey } from "@uniswap/v4-core/src/types/PoolKey.sol";
import { PoolId, PoolIdLibrary } from "@uniswap/v4-core/src/types/PoolId.sol";
import { Currency, CurrencyLibrary } from "@uniswap/v4-core/src/types/Currency.sol";
import { IHooks } from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import { TickMath } from "@uniswap/v4-core/src/libraries/TickMath.sol";

import { IPositionManager } from "@uniswap/v4-periphery/src/interfaces/IPositionManager.sol";

/// @title MockERC20
/// @notice Simple ERC20 mock for testing
contract MockERC20 is ERC20 {
    uint8 private _decimals;

    constructor(string memory name, string memory symbol, uint8 decimals_) ERC20(name, symbol) {
        _decimals = decimals_;
    }

    function decimals() public view override returns (uint8) {
        return _decimals;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function burn(address from, uint256 amount) external {
        _burn(from, amount);
    }
}

/// @title MockWETH9
/// @notice WETH9 mock for testing
contract MockWETH9 is MockERC20 {
    constructor() MockERC20("Wrapped Ether", "WETH", 18) {}

    function deposit() external payable {
        _mint(msg.sender, msg.value);
    }

    function withdraw(uint256 amount) external {
        _burn(msg.sender, amount);
        (bool success,) = msg.sender.call{value: amount}("");
        require(success, "ETH transfer failed");
    }

    receive() external payable {
        _mint(msg.sender, msg.value);
    }
}

/// @title MockPoolManager
/// @notice Minimal PoolManager mock for testing
contract MockPoolManager {
    using PoolIdLibrary for PoolKey;

    struct Slot0 {
        uint160 sqrtPriceX96;
        int24 tick;
        uint24 protocolFee;
        uint24 lpFee;
    }

    mapping(PoolId => Slot0) public slots;

    function initialize(PoolKey memory key, uint160 sqrtPriceX96) external returns (int24 tick) {
        tick = TickMath.getTickAtSqrtPrice(sqrtPriceX96);
        slots[key.toId()] = Slot0({
            sqrtPriceX96: sqrtPriceX96,
            tick: tick,
            protocolFee: 0,
            lpFee: key.fee
        });
    }

    function getSlot0(PoolId id) external view returns (uint160, int24, uint24, uint24) {
        Slot0 memory slot = slots[id];
        return (slot.sqrtPriceX96, slot.tick, slot.protocolFee, slot.lpFee);
    }

    function setSlot0(PoolId id, uint160 sqrtPriceX96, int24 tick) external {
        slots[id].sqrtPriceX96 = sqrtPriceX96;
        slots[id].tick = tick;
    }

    // IExtsload implementation for StateLibrary compatibility
    function extsload(bytes32 slot) external view returns (bytes32 value) {
        assembly {
            value := sload(slot)
        }
    }

    function extsload(bytes32 startSlot, uint256 nSlots) external view returns (bytes32[] memory values) {
        values = new bytes32[](nSlots);
        assembly {
            for { let i := 0 } lt(i, nSlots) { i := add(i, 1) } {
                let slot := add(startSlot, i)
                mstore(add(add(values, 0x20), mul(i, 0x20)), sload(slot))
            }
        }
    }

    function extsload(bytes32[] calldata slots) external view returns (bytes32[] memory values) {
        values = new bytes32[](slots.length);
        for (uint256 i = 0; i < slots.length; i++) {
            assembly {
                mstore(add(add(values, 0x20), mul(i, 0x20)), sload(calldataload(add(slots.offset, mul(i, 0x20)))))
            }
        }
    }
}

/// @title MockPositionManager
/// @notice Minimal PositionManager mock for testing
contract MockPositionManager {
    using PoolIdLibrary for PoolKey;

    struct Position {
        address owner;
        PoolKey poolKey;
        int24 tickLower;
        int24 tickUpper;
        uint128 liquidity;
        uint256 feeOwed0;
        uint256 feeOwed1;
    }

    uint256 public nextTokenId = 1;
    mapping(uint256 => Position) public positions;
    mapping(uint256 => address) public approvals;
    mapping(address => mapping(address => bool)) public operatorApprovals;

    function ownerOf(uint256 tokenId) external view returns (address) {
        return positions[tokenId].owner;
    }

    function getApproved(uint256 tokenId) external view returns (address) {
        return approvals[tokenId];
    }

    function isApprovedForAll(address owner, address operator) external view returns (bool) {
        return operatorApprovals[owner][operator];
    }

    function approve(address to, uint256 tokenId) external {
        require(positions[tokenId].owner == msg.sender, "Not owner");
        approvals[tokenId] = to;
    }

    function setApprovalForAll(address operator, bool approved) external {
        operatorApprovals[msg.sender][operator] = approved;
    }

    function getPositionLiquidity(uint256 tokenId) external view returns (uint128) {
        return positions[tokenId].liquidity;
    }

    function getPoolAndPositionInfo(uint256 tokenId)
        external
        view
        returns (PoolKey memory poolKey, uint256 info)
    {
        Position memory pos = positions[tokenId];
        poolKey = pos.poolKey;
        // Pack position info: tickLower (24 bits) | tickUpper (24 bits) | hasSubscriber (8 bits)
        info = (uint256(uint24(pos.tickLower)) << 8) | (uint256(uint24(pos.tickUpper)) << 32);
    }

    function modifyLiquidities(bytes calldata unlockData, uint256) external payable returns (uint256 tokenId_) {
        // Decode the actions and params
        (bytes memory actions, bytes[] memory params) = abi.decode(unlockData, (bytes, bytes[]));

        // Process each action
        for (uint256 i = 0; i < actions.length; i++) {
            uint8 action = uint8(actions[i]);

            // MINT_POSITION = 0x02
            if (action == 0x02) {
                (
                    PoolKey memory poolKey,
                    int24 tickLower,
                    int24 tickUpper,
                    uint128 liquidity,
                    ,  // amount0Min
                    ,  // amount1Min
                    address recipient,
                      // hookData
                ) = abi.decode(params[i], (PoolKey, int24, int24, uint128, uint256, uint256, address, bytes));

                // Validate tick range
                require(tickLower < tickUpper, "Invalid tick range");
                require(liquidity > 0, "Liquidity must be > 0");

                tokenId_ = this.mintPosition(recipient, poolKey, tickLower, tickUpper, liquidity);
            }
            // INCREASE_LIQUIDITY = 0x00
            else if (action == 0x00) {
                (uint256 tokenId, uint128 liquidityToAdd,,) = abi.decode(params[i], (uint256, uint128, uint256, uint256));
                require(liquidityToAdd > 0, "Liquidity must be > 0");
                positions[tokenId].liquidity += liquidityToAdd;
            }
            // DECREASE_LIQUIDITY = 0x01
            else if (action == 0x01) {
                (uint256 tokenId, uint128 liquidityToRemove,,) = abi.decode(params[i], (uint256, uint128, uint256, uint256));

                // If decreasing by 0, this is a fee collection call
                if (liquidityToRemove == 0) {
                    // Just collect fees, don't modify liquidity
                    // Fees will be taken in TAKE_PAIR action
                } else {
                    positions[tokenId].liquidity -= liquidityToRemove;
                    // Mark that tokens should be returned (will be handled by TAKE_PAIR)
                    // For simplicity, we'll add the liquidity amount to fees temporarily
                    // This allows TAKE_PAIR to mint tokens back
                    positions[tokenId].feeOwed0 += uint256(liquidityToRemove);
                    positions[tokenId].feeOwed1 += uint256(liquidityToRemove);
                }
            }
            // TAKE_PAIR = 0x11 - Transfer collected fees/tokens
            else if (action == 0x11) {
                (Currency currency0, Currency currency1, address recipient) = abi.decode(params[i], (Currency, Currency, address));

                // Get tokenId from previous DECREASE_LIQUIDITY action (simplified for mock)
                // In a real implementation, this would track the deltas
                // For testing, we'll transfer any pending fees from positions
                // This is a simplified approach - look for a position that has fees
                for (uint256 tid = 1; tid < nextTokenId; tid++) {
                    if (positions[tid].feeOwed0 > 0 || positions[tid].feeOwed1 > 0) {
                        // Mint fee tokens to recipient (mock)
                        if (positions[tid].feeOwed0 > 0 && !currency0.isAddressZero()) {
                            MockERC20(Currency.unwrap(currency0)).mint(recipient, positions[tid].feeOwed0);
                        }
                        if (positions[tid].feeOwed1 > 0 && !currency1.isAddressZero()) {
                            MockERC20(Currency.unwrap(currency1)).mint(recipient, positions[tid].feeOwed1);
                        }

                        // Clear fees
                        positions[tid].feeOwed0 = 0;
                        positions[tid].feeOwed1 = 0;
                        break;  // Only process first position with fees for simplicity
                    }
                }
            }
            // BURN_POSITION = 0x03
            else if (action == 0x03) {
                (uint256 tokenId,) = abi.decode(params[i], (uint256, address));
                delete positions[tokenId];
            }
            // SETTLE_PAIR = 0x0d - just skip for mock
            // TAKE_PAIR = 0x11 - just skip for mock
            // Other actions can be added as needed
        }
    }

    // Add a function to collect fees (used by V4Utils)
    function collect(
        uint256 tokenId,
        address recipient,
        uint128,  // amount0Max
        uint128   // amount1Max
    ) external returns (uint256 amount0, uint256 amount1) {
        amount0 = positions[tokenId].feeOwed0;
        amount1 = positions[tokenId].feeOwed1;

        // Reset fees
        positions[tokenId].feeOwed0 = 0;
        positions[tokenId].feeOwed1 = 0;

        // Mock would transfer tokens to recipient here
        // For testing, just return the amounts
    }

    // Test helpers
    function mintPosition(
        address owner,
        PoolKey memory poolKey,
        int24 tickLower,
        int24 tickUpper,
        uint128 liquidity
    ) external returns (uint256 tokenId) {
        tokenId = nextTokenId++;
        positions[tokenId] = Position({
            owner: owner,
            poolKey: poolKey,
            tickLower: tickLower,
            tickUpper: tickUpper,
            liquidity: liquidity,
            feeOwed0: 0,
            feeOwed1: 0
        });
    }

    function addFees(uint256 tokenId, uint256 fee0, uint256 fee1) external {
        positions[tokenId].feeOwed0 += fee0;
        positions[tokenId].feeOwed1 += fee1;
    }

    function setLiquidity(uint256 tokenId, uint128 liquidity) external {
        positions[tokenId].liquidity = liquidity;
    }
}

/// @title MockRouter
/// @notice Mock swap router for testing
contract MockRouter {
    function swap(
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256   // minAmountOut - ignored for mock
    ) external returns (uint256 amountOut) {
        // If amountIn is specified (> 0), use it
        // Otherwise fall back to checking the actual approved amount
        // (CollectAndSwap tests encode 0 since amount is determined at runtime)
        uint256 actualAmount = amountIn;
        if (actualAmount == 0) {
            actualAmount = IERC20(tokenIn).allowance(msg.sender, address(this));
        }

        if (actualAmount > 0) {
            // Transfer the specified/approved amount
            IERC20(tokenIn).transferFrom(msg.sender, address(this), actualAmount);
            amountOut = actualAmount; // 1:1 for simplicity

            // Mint output tokens (assuming MockERC20)
            MockERC20(tokenOut).mint(msg.sender, amountOut);
        }
    }

    // Fallback to handle arbitrary swap data
    fallback() external payable {
        // For simplicity, assume first 3 slots of calldata contain: tokenIn, tokenOut, amountIn
        // This is a simplified mock - real routers have complex encoding
        if (msg.data.length >= 96) {
            address tokenIn;
            address tokenOut;
            uint256 amountIn;

            assembly {
                tokenIn := calldataload(4)
                tokenOut := calldataload(36)
                amountIn := calldataload(68)
            }

            // Get actual balance to swap (V4Utils sends tokens before calling)
            uint256 balance = IERC20(tokenIn).balanceOf(address(this));
            if (balance > 0) {
                // Do 1:1 swap with the balance
                MockERC20(tokenOut).mint(msg.sender, balance);
            }
        }
    }

    receive() external payable {}
}

/// @title BaseTest
/// @notice Base test contract with common setup for all tests
abstract contract BaseTest is Test {
    using CurrencyLibrary for Currency;
    using PoolIdLibrary for PoolKey;

    // Test accounts
    address public owner;
    address public user1;
    address public user2;
    address public operator;

    // Mock contracts
    MockPoolManager public poolManager;
    MockPositionManager public positionManager;
    MockERC20 public token0;
    MockERC20 public token1;
    MockWETH9 public weth;
    MockRouter public router;

    // Pool configuration
    PoolKey public poolKey;
    int24 public constant TICK_SPACING = 60;
    int24 public constant TICK_LOWER = -120;
    int24 public constant TICK_UPPER = 120;
    uint160 public constant SQRT_PRICE_1_1 = 79228162514264337593543950336; // 1:1 price

    function setUp() public virtual {
        // Setup accounts
        owner = makeAddr("owner");
        user1 = makeAddr("user1");
        user2 = makeAddr("user2");
        operator = makeAddr("operator");

        // Fund accounts with ETH
        vm.deal(owner, 100 ether);
        vm.deal(user1, 100 ether);
        vm.deal(user2, 100 ether);

        // Deploy mock contracts
        poolManager = new MockPoolManager();
        positionManager = new MockPositionManager();
        weth = new MockWETH9();
        router = new MockRouter();

        // Deploy mock tokens (ensure token0 < token1 by address)
        MockERC20 tokenA = new MockERC20("Token A", "TKA", 18);
        MockERC20 tokenB = new MockERC20("Token B", "TKB", 18);

        if (address(tokenA) < address(tokenB)) {
            token0 = tokenA;
            token1 = tokenB;
        } else {
            token0 = tokenB;
            token1 = tokenA;
        }

        // Mint tokens to users
        token0.mint(user1, 1_000_000e18);
        token1.mint(user1, 1_000_000e18);
        token0.mint(user2, 1_000_000e18);
        token1.mint(user2, 1_000_000e18);

        // Setup pool key
        poolKey = PoolKey({
            currency0: Currency.wrap(address(token0)),
            currency1: Currency.wrap(address(token1)),
            fee: 3000, // 0.3%
            tickSpacing: TICK_SPACING,
            hooks: IHooks(address(0))
        });

        // Initialize pool
        poolManager.initialize(poolKey, SQRT_PRICE_1_1);
    }

    // ============ Helper Functions ============

    function deployProxy(address implementation, bytes memory initData) internal returns (address) {
        return address(new ERC1967Proxy(implementation, initData));
    }

    function approveTokens(address user, address spender, uint256 amount) internal {
        vm.startPrank(user);
        token0.approve(spender, amount);
        token1.approve(spender, amount);
        vm.stopPrank();
    }

    function labelAddresses() internal {
        vm.label(owner, "Owner");
        vm.label(user1, "User1");
        vm.label(user2, "User2");
        vm.label(operator, "Operator");
        vm.label(address(poolManager), "PoolManager");
        vm.label(address(positionManager), "PositionManager");
        vm.label(address(token0), "Token0");
        vm.label(address(token1), "Token1");
        vm.label(address(weth), "WETH");
        vm.label(address(router), "Router");
    }

    function getRouterCallData(
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256 minAmountOut
    ) internal view returns (bytes memory) {
        return abi.encode(
            address(router),
            abi.encodeWithSelector(
                MockRouter.swap.selector,
                tokenIn,
                tokenOut,
                amountIn,
                minAmountOut
            )
        );
    }

    function createPosition(
        address posOwner,
        uint256 amount0,
        uint256 amount1
    ) internal returns (uint256 tokenId) {
        tokenId = positionManager.mintPosition(
            posOwner,
            poolKey,
            TICK_LOWER,
            TICK_UPPER,
            uint128(amount0) // Simplified liquidity calc
        );
    }
}
