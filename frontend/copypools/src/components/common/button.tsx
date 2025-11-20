// src/components/common/button.tsx
import Link from "next/link";
import styles from "./button.module.css";

interface ButtonProps {
  children: React.ReactNode;
  variant?: "primary" | "secondary";
  href?: string;
  target?: string;
}

export default function Button({
  children,
  variant = "primary",
  href = "#",
  target
}: ButtonProps) {
  return (
    <Link href={href} target={target} className={styles[variant]}>
      {children}
    </Link>
  );
}
