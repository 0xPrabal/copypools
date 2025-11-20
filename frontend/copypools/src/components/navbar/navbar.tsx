// src/components/navbar/navbar.tsx
"use client";

import Link from "next/link";
import Image from "next/image";
import styles from "./navbar.module.css";

const navLinks = [
  { label: "Products", href: "/products", dropdown: true },
  { label: "Investors", href: "/investors" },
  { label: "Docs", href: "/docs" },
  { label: "Careers", href: "/careers" }
];

const socials = [
  { label: "X", href: "https://x.com", icon: "x" as const },
  { label: "Discord", href: "https://discord.com", icon: "discord" as const },
  { label: "Telegram", href: "https://t.me", icon: "telegram" as const }
];

export default function Navbar() {
  return (
    <nav className={styles.navbar}>
      <div className={styles.brandGroup}>
        <div className={styles.logoBadge}>
          <Image
            src="/assets/logos/logo.png"
            width={72}
            height={72}
            alt="CopyPools Logo"
            className={styles.logoImg}
            priority
          />
        </div>
        <span className={styles.brand}>copypools</span>
      </div>

      <div className={styles.menuPill}>
        <div className={styles.linkGroup}>
          {navLinks.map(({ label, href, dropdown }) => (
            <Link key={label} href={href} className={styles.menuLink}>
              <span>{label}</span>
              {dropdown && (
                <svg
                  className={styles.dropdownIcon}
                  viewBox="0 0 12 12"
                  aria-hidden="true"
                >
                  <path
                    d="M3 4.5L6 7.5L9 4.5"
                    stroke="currentColor"
                    strokeWidth="1.4"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              )}
            </Link>
          ))}
        </div>

        <div className={styles.socialGroup}>
          {socials.map(({ label, href, icon }) => (
            <Link
              key={label}
              href={href}
              target="_blank"
              rel="noreferrer"
              className={styles.socialBtn}
            >
              <span aria-hidden="true" className={styles.socialIcon}>
                {icon === "x" && XIcon()}
                {icon === "discord" && DiscordIcon()}
                {icon === "telegram" && TelegramIcon()}
              </span>
              <span className={styles.srOnly}>{label}</span>
            </Link>
          ))}
        </div>
      </div>

      <div className={styles.ctaGroup}>
        <Link href="/api-docs" className={styles.buttonOutline}>
          API Docs
        </Link>
        <Link href="/dashboard" className={styles.buttonFill}>
          Launch App
        </Link>
      </div>
    </nav>
  );
}

function XIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M4 4L20 20" />
      <path d="M20 4L4 20" />
    </svg>
  );
}

function DiscordIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M7 17C7 17 5 16 4 14C4 10 5 6 9 6" />
      <path d="M17 17C17 17 19 16 20 14C20 10 19 6 15 6" />
      <path d="M9 6C10 7 11 7 12 7C13 7 14 7 15 6" />
      <circle cx="9" cy="12" r="1" fill="currentColor" />
      <circle cx="15" cy="12" r="1" fill="currentColor" />
    </svg>
  );
}

function TelegramIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M4 12L20 4L17 20L11 15L8 18L8.5 12.5L4 12Z" strokeLinejoin="round" />
    </svg>
  );
}
