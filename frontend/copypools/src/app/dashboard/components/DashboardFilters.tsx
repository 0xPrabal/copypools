import styles from "./DashboardFilters.module.css";

interface Props {
  theme: "dark" | "light";
}

export default function DashboardFilters({ theme }: Props) {
  return (
    <div
      className={`${styles.filtersRoot} ${
        theme === "dark" ? styles.darkTheme : styles.lightTheme
      }`}
    >
      <div className={styles.left}>
        <div className={styles.pill}>🔥 Trending</div>
        <div className={styles.pill}>All Networks ▾</div>
        <div className={styles.pill}>Platforms ▾</div>
      </div>

      <div className={styles.right}>
        <input
          className={styles.search}
          placeholder="Search by pool address, token pair, tags..."
        />
      </div>
    </div>
  );
}
