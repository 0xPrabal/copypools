import type { Metadata } from 'next'
import './globals.css'
import { PrivyProvider } from '@/providers/PrivyProvider'

export const metadata: Metadata = {
  title: 'CopyPools Dashboard',
  description: 'Liquidity Management Dashboard',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body>
        <PrivyProvider>{children}</PrivyProvider>
      </body>
    </html>
  )
}
