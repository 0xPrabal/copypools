import type { Metadata } from "next";
// @ts-expect-error Next.js handles global CSS imports via the bundler
import "./globals.css";

export const metadata: Metadata = {
  title: "CopyPools - Liquidity Farming Agent",
  description: "The most powerful Liquidity Management Platform to earn top yields across Solana & EVM DEXs",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
