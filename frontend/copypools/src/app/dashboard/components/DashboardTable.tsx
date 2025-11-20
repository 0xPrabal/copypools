"use client";

import React, { useEffect, useRef, useState } from "react";
import styles from "./DashboardTable.module.css";
import type { PoolRow } from "@/types/pool";

interface Props {
  rows: PoolRow[];
  theme: "dark" | "light";
}

export default function DashboardTable({ rows, theme }: Props) {
  // Start with an empty favorites map on first render so server and client markup match.
  // Load persisted favorites after mount to avoid hydration mismatches.
  const [favorites, setFavorites] = useState<Record<string, boolean>>({});

  useEffect(() => {
    try {
      const raw = localStorage.getItem("cp_favorites");
      const stored: Record<string, boolean> = raw ? JSON.parse(raw) : {};

      // Rows that declare `favorite` should be included unless the stored state overrides.
      const initial: Record<string, boolean> = {};
      rows.forEach((r) => {
        if (r.favorite) initial[r.id] = true;
      });

      setFavorites({ ...initial, ...stored });
    } catch {
      // ignore storage errors
      const initial: Record<string, boolean> = {};
      rows.forEach((r) => {
        if (r.favorite) initial[r.id] = true;
      });
      setFavorites(initial);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Persist favorites whenever they change
  useEffect(() => {
    try {
      localStorage.setItem("cp_favorites", JSON.stringify(favorites));
    } catch {
      // ignore storage errors
    }
  }, [favorites]);

  const toggleFavorite = (id: string) => {
    setFavorites((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    function handleDocClick(e: MouseEvent) {
      const target = e.target as Node | null;
      if (!target) return;
      // if click is outside any open menu, close it
      if (openMenuId && containerRef.current) {
        const inside = (target as Element).closest?.("[data-menu-open]");
        if (!inside) setOpenMenuId(null);
      }
    }

    document.addEventListener("click", handleDocClick);
    return () => document.removeEventListener("click", handleDocClick);
  }, [openMenuId]);

  const toggleMenu = (id: string) => {
    setOpenMenuId((prev) => (prev === id ? null : id));
  };
  return (
    <div
      className={`${styles.tableContainer} ${
        theme === "dark" ? styles.darkTheme : styles.lightTheme
      }`}
    >
      <div className={styles.tableHeader}>
        <span className={styles.headerCellWide}>Pair / Pool</span>
        <span>24h APR</span>
        <span>TVL</span>
        <span>24h Volume</span>
        <span>24h Fees</span>
        <span>24h Volume / TVL</span>
        <span className={styles.headerCellAction}>Actions</span>
      </div>

      <div className={styles.tableBody} ref={containerRef}>
        {rows.map((row) => (
          <div key={row.id} className={styles.row}>
            <div className={styles.pairCell}>
              <div className={styles.pairTop}>
                <button
                  className={`${styles.favBtn} ${favorites[row.id] ? styles.favActive : ""}`}
                  aria-label={favorites[row.id] ? "Unfavorite" : "Add to favorites"}
                  onClick={() => toggleFavorite(row.id)}
                >
                  ★
                </button>
                <span className={styles.pairTitle}>{row.pair}</span>
              </div>
              <div className={styles.pairBottom}>
                {row.dex} • {row.feeTier}
              </div>
            </div>

            <span className={styles.numeric}>{row.apr24h}</span>
            <span className={styles.numeric}>{row.tvl}</span>
            <span className={styles.numeric}>{row.volume24h}</span>
            <span className={styles.numeric}>{row.fees24h}</span>
            <span className={styles.numeric}>{row.volumeTvl}</span>

            <div className={styles.actionCell}>
              <button
                className={styles.plusBtn}
                aria-haspopup="true"
                aria-expanded={openMenuId === row.id}
                onClick={() => toggleMenu(row.id)}
              >
                +
              </button>

              {openMenuId === row.id && (
                <div className={styles.actionMenu} data-menu-open>
                  <button className={styles.menuItem}>Create Position</button>
                  <button className={styles.menuItem}>Create Vault</button>
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
