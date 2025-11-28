import type { Metadata } from 'next'
import './globals.css'
import { PrivyProvider } from '@/providers/PrivyProvider'

export const metadata: Metadata = {
  title: 'CopyPools Dashboard',
  description: 'Liquidity Management Dashboard',
}

// Force dynamic rendering for all pages to support client-side wallet providers
export const dynamic = 'force-dynamic'

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
