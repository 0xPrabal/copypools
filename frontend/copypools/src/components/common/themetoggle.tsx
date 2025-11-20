"use client";

import styles from "./ThemeToggle.module.css";
import type { ThemeMode } from "@/app/dashboard/page";

interface Props {
  theme: ThemeMode;
  onToggle: () => void;
}

export default function ThemeToggle({ theme, onToggle }: Props) {
  return (
    <button className={styles.toggleBtn} onClick={onToggle}>
      <span className={styles.icon}>{theme === "dark" ? "🌙" : "☀️"}</span>
      <span className={styles.label}>
        {theme === "dark" ? "Dark" : "Light"}
      </span>
    </button>
  );
}
