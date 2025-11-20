import styles from "./PortfolioSidebar.module.css";
import type { PortfolioSummary, PortfolioPool } from "@/types/portfolio";

interface Props {
  summary: PortfolioSummary;
  bestPools: PortfolioPool[];
  theme: "dark" | "light";
}

export default function PortfolioSidebar({ summary, bestPools, theme }: Props) {
  return (
    <div
      className={`${styles.sidebarRoot} ${
        theme === "dark" ? styles.darkTheme : styles.lightTheme
      }`}
    >
      <div className={styles.card}>
        <div className={styles.cardHeader}>
          <h2>Portfolio</h2>
          <button className={styles.connectBtn}>Connect Wallet ↗</button>
        </div>

        <div className={styles.summaryRow}>
          <span>TVL</span>
          <strong>{summary.tvl}</strong>
        </div>
        <div className={styles.summaryRow}>
          <span>Fees Generated</span>
          <strong>{summary.feesGenerated}</strong>
        </div>
        <div className={styles.summaryRow}>
          <span>Volume (24h)</span>
          <strong>{summary.volume}</strong>
        </div>
        <div className={styles.summaryRow}>
          <span>#Vaults</span>
          <strong>{summary.vaults}</strong>
        </div>
      </div>

      <div className={styles.card}>
        <div className={styles.cardHeader}>
          <h3>Best Blue-chip Pools</h3>
          <button className={styles.linkBtn}>See all</button>
        </div>

        <ul className={styles.poolList}>
          {bestPools.map((pool) => (
            <li key={pool.id} className={styles.poolItem}>
              <div>
                <div className={styles.poolName}>{pool.name}</div>
                <div className={styles.poolSubtitle}>{pool.platform}</div>
              </div>
              <div className={styles.poolApr}>{pool.apr}</div>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
