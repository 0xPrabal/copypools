import styles from "./Footer.module.css";

export default function Footer() {
  return (
    <footer className={styles.footer}>
      <span>© {new Date().getFullYear()} CopyPools. All rights reserved.</span>
      <span className={styles.right}>
        <a href="#" rel="noreferrer">
          Status
        </a>
        <a href="#" rel="noreferrer">
          Privacy
        </a>
        <a href="#" rel="noreferrer">
          Terms
        </a>
      </span>
    </footer>
  );
}
