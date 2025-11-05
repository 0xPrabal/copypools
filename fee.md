## 💰 Fee Types & Breakdown

| **Fee Type**                          | **Who Pays**            | **Rate (Typical)**               | **Trigger Event**                   | **Destination**                    | **Notes**                                                               |
| ------------------------------------- | ----------------------- | -------------------------------- | ----------------------------------- | ---------------------------------- | ----------------------------------------------------------------------- |
| **Performance Fee (Auto-Compounder)** | Liquidity Provider (LP) | 3 % of harvested fees          | During `compound()`                 | Revert Treasury / Strategy Creator | Main revenue source; deducted from the earned fees before reinvestment. |
| **Management Fee**                    | Vault participant       | 0.5 % annualized (when active)   | Periodically (off-chain accounting) | Treasury                           | Used rarely; compensates for analytics infra and bot operation.         |
| **Deposit / Withdrawal Fee**          | User                    | 0 % (default) – 0.1 % (optional) | On deposit/withdrawal               | Strategy contract                  | Optional deterrent for rapid entry/exit exploitation.                   |
| **Swap / DEX Fee**                    | User (indirect)         | 0.05–1 %                         | On swaps inside Uniswap v3          | Liquidity pool                     | Native AMM fee; not Revert’s revenue.                                   |
| **Revenue Split**                     | —                       | 80–90 % user / 10–20 % protocol  | On each compound cycle              | Treasury + automation pool         | Treasury supports analytics infra, keepers, and audits.                 |

---

## ⚙️ Fee Flow — On-chain Sequence

1. **Auto-compounding trigger:**

   * Vault or keeper calls `compound()` on a Revert vault.
   * Fees from Uniswap v3 LP NFT are collected.
2. **Performance fee deduction:**

   * A small fraction (1–2 %) of the harvested tokens are transferred to the Revert treasury address.
3. **Remainder reinvested:**

   * Remaining tokens are swapped to the right ratio and added back to the liquidity position.
4. **Event emission:**

   * Contracts emit `FeeCollected(address vault, uint256 amount, address treasury)` for tracking.
5. **Analytics sync:**

   * The event is picked by Revert’s off-chain indexers (The Graph/subgraph) and reflected in vault dashboards.

---


