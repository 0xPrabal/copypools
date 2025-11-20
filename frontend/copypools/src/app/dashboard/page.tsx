"use client";

import { useState } from "react";
import Navbar from "@/components/navbar/navbar_dash";
import Footer from "@/components/footer/footer";
import DashboardTable from "./components/DashboardTable";
import DashboardFilters from "./components/DashboardFilters";
import PortfolioSidebar from "./components/PortfolioSidebar";
import { poolRows, portfolioSummary, bestPools } from "./mock/mockdata";
import styles from "./dashboard.module.css";

export type ThemeMode = "dark" | "light";

export default function DashboardPage() {
  const [theme, setTheme] = useState<ThemeMode>("dark");

  const handleToggleTheme = () => {
    
    setTheme((prev) => (prev === "dark" ? "light" : "dark"));
  };

  return (
    <div
      className={`${styles.dashboardRoot} ${
        theme === "dark" ? styles.dark : styles.light
      }`}
    >
      <Navbar theme={theme} onToggleTheme={handleToggleTheme} />

      <main className={styles.main}>
        <header className={styles.topBar}>
          <div className={styles.leftTop}>
            <h1 className={styles.pageTitle}>Hot Pools</h1>
            <span className={styles.betaBadge}>BETA</span>
          </div>

          {/* Right-side header controls moved into navbar for dashboard */}
        </header>

        <DashboardFilters theme={theme} />

        <section className={styles.contentSection}>
          <div className={styles.tableWrapper}>
            <DashboardTable rows={poolRows} theme={theme} />
          </div>

          <aside className={styles.sidebarWrapper}>
            <PortfolioSidebar
              summary={portfolioSummary}
              bestPools={bestPools}
              theme={theme}
            />
          </aside>
        </section>
      </main>

      <Footer />
    </div>
  );
}
