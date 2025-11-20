// src/app/page.tsx
"use client";

import Navbar from "@/components/navbar/navbar";
import Button from "@/components/common/button";
import styles from "./landing.module.css";

export default function LandingPage() {
  return (
    <main className={styles.container}>
      <Navbar />

      <section className={styles.heroSection}>
        <div className={styles.heroInner}>
          <div className={styles.copyBlock}>
            <span className={styles.eyebrow}>CopyPools Intelligence</span>
            <h1 className={styles.heading}>Liquidity Farming Agent</h1>

            <p className={styles.subText}>
              The most powerful Liquidity Management Platform to earn top
              yields across Solana &amp; EVM DEXs
            </p>

            <div className={styles.badgeRow}>
              <span className={styles.badge}>⚡ Solana &amp; EVM DEXs</span>
              <span className={styles.badge}>AI Driven Yield Routes</span>
            </div>

            <div className={styles.buttonRow}>
              <Button variant="primary" href="/dashboard" target="_blank">
                Launch App
              </Button>

              <Button variant="secondary" href="/api-docs">
                API Docs
              </Button>
            </div>
          </div>

          <div className={styles.heroArtwork}>
            <div className={styles.glowOrb} />
          </div>
        </div>
      </section>
    </main>
  );
}
