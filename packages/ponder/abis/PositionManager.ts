// Minimal PositionManager ABI for indexing positions
export const PositionManagerAbi = [
  // ERC721 Transfer event - emitted when positions are minted/transferred/burned
  {
    type: "event",
    name: "Transfer",
    inputs: [
      { indexed: true, name: "from", type: "address" },
      { indexed: true, name: "to", type: "address" },
      { indexed: true, name: "tokenId", type: "uint256" },
    ],
  },
  // ModifyLiquidity event - emitted when liquidity is added/removed
  {
    type: "event",
    name: "ModifyLiquidity",
    inputs: [
      { indexed: true, name: "tokenId", type: "uint256" },
      { indexed: false, name: "liquidityDelta", type: "int256" },
      { indexed: false, name: "amount0", type: "int256" },
      { indexed: false, name: "amount1", type: "int256" },
    ],
  },
  // Subscription event - when position is subscribed to a notifier
  {
    type: "event",
    name: "Subscription",
    inputs: [
      { indexed: true, name: "tokenId", type: "uint256" },
      { indexed: true, name: "subscriber", type: "address" },
    ],
  },
  // Unsubscription event
  {
    type: "event",
    name: "Unsubscription",
    inputs: [
      { indexed: true, name: "tokenId", type: "uint256" },
      { indexed: true, name: "subscriber", type: "address" },
    ],
  },
] as const;
