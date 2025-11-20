// src/components/navbar/navbar_dash.tsx
"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import Image from "next/image";
import styles from "./navbar.module.css";

const navLinks = [
  { label: "Hot Pools", href: "/hot-pools" },
  { label: "Vaults", href: "/vaults", badge: "BETA" },
  { label: "Strategies", href: "/strategies" },
  { label: "Leaderboard", href: "/leaderboard" },
  { label: "Profile", href: "/profile" },
  { label: "Docs", href: "/docs" },
  { label: "More", href: "#", dropdown: true }
];

const socials = [
  { label: "X", href: "https://x.com", icon: "x" as const },
  { label: "Discord", href: "https://discord.com", icon: "discord" as const },
  { label: "Telegram", href: "https://t.me", icon: "telegram" as const }
];

interface NavbarDashProps {
  theme?: "dark" | "light";
  onToggleTheme?: () => void;
}

export default function NavbarDash({ theme = "dark", onToggleTheme }: NavbarDashProps) {
  const router = useRouter();
  return (
    <nav className={`${styles.navbar} ${theme === "dark" ? styles.darkNav : styles.lightNav}`}>
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
          {navLinks.map(({ label, href, dropdown, badge }) => (
            dropdown ? (
              <div key={label} className={styles.moreItem}>
                <Link href={href} className={`${styles.menuLink} ${styles.moreToggle}`} aria-haspopup="true" aria-expanded="false">
                  <span className={styles.menuLabel}>{label}</span>
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
                </Link>

                <div className={styles.megaMenu} role="menu" aria-label="More menu">
                  <div className={styles.megaCols}>
                    <div className={styles.megaCol}>
                      <div className={styles.megaHeading}>Discover</div>
                      <button type="button" onClick={() => router.push('/vaults')} className={styles.megaLink} role="menuitem">Vaults <span className={styles.badgeSmall}>BETA</span></button>
                      <button type="button" onClick={() => router.push('/strategies')} className={styles.megaLink} role="menuitem">Strategies</button>
                      <button type="button" onClick={() => router.push('/hot-pools')} className={styles.megaLink} role="menuitem">Hot Pools</button>
                      <button type="button" onClick={() => router.push('/leaderboard')} className={styles.megaLink} role="menuitem">Leaderboard</button>
                    </div>

                    <div className={styles.megaCol}>
                      <div className={styles.megaHeading}>Dashboard</div>
                      <button type="button" onClick={() => router.push('/profile')} className={styles.megaLink} role="menuitem">My Profile</button>
                      <button type="button" onClick={() => router.push('/automation')} className={styles.megaLink} role="menuitem">My Automation</button>
                    </div>

                    <div className={styles.megaCol}>
                      <div className={styles.megaHeading}>Create</div>
                      <button type="button" onClick={() => router.push('/create/vault')} className={styles.megaLink} role="menuitem">Create Vault <span className={styles.badgeSmall}>BETA</span></button>
                      <button type="button" onClick={() => router.push('/create/position')} className={styles.megaLink} role="menuitem">Create Position</button>
                    </div>

                    <div className={styles.megaCol}>
                      <div className={styles.megaHeading}>Tools</div>
                      <button type="button" onClick={() => router.push('/swap')} className={styles.megaLink} role="menuitem">Swap</button>
                      <button type="button" onClick={() => router.push('/send')} className={styles.megaLink} role="menuitem">Send</button>
                      <button type="button" onClick={() => router.push('/multisend')} className={styles.megaLink} role="menuitem">Multi-send</button>
                      <button type="button" onClick={() => router.push('/token-approval')} className={styles.megaLink} role="menuitem">Token Approval</button>
                    </div>

                    <div className={styles.megaCol}>
                      <div className={styles.megaHeading}>Others</div>
                      <button type="button" onClick={() => router.push('/points')} className={styles.megaLink} role="menuitem">Points</button>
                      <button type="button" onClick={() => router.push('/campaigns')} className={styles.megaLink} role="menuitem">Campaigns</button>
                      <button type="button" onClick={() => router.push('/settings')} className={styles.megaLink} role="menuitem">Settings</button>
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              <Link key={label} href={href} className={styles.menuLink}>
                <span className={styles.menuLabel}>{label}</span>
                {badge && <span className={styles.badgeSmall}>{badge}</span>}
              </Link>
            )
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

      <div className={styles.rightGroup}>
        <div className={styles.searchBox}>
          <svg viewBox="0 0 24 24" className={styles.searchIcon} aria-hidden>
            <path d="M21 21l-4.35-4.35" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            <circle cx="11" cy="11" r="6" stroke="currentColor" strokeWidth="1.5" fill="none" />
          </svg>
          <input className={styles.searchInput} placeholder="Search anything" aria-label="Search" />
        </div>

        <button className={styles.createBtn}>+ Create</button>
        <button className={styles.connectBtn}>Connect Wallet</button>
        <button
          className={styles.themeToggle}
          aria-label={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
          onClick={() => onToggleTheme && onToggleTheme()}
        >
          {theme === "dark" ? SunIcon() : MoonIcon()}
        </button>
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

function SunIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" width="18" height="18">
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2" />
      <path d="M12 20v2" />
      <path d="M4.22 4.22l1.42 1.42" />
      <path d="M18.36 18.36l1.42 1.42" />
      <path d="M2 12h2" />
      <path d="M20 12h2" />
      <path d="M4.22 19.78l1.42-1.42" />
      <path d="M18.36 5.64l1.42-1.42" />
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" width="18" height="18">
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
    </svg>
  );
}
