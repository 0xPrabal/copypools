/** @type {import('next').NextConfig} */
const nextConfig = {
  // Enable standalone output for Docker
  output: 'standalone',

  // Optimize production builds
  reactStrictMode: true,

  // Production optimizations
  compress: true,
  poweredByHeader: false,

  // Image optimization
  images: {
    domains: [],
    formats: ['image/avif', 'image/webp'],
  },

  // Environment variables
  env: {
    NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000',
    NEXT_PUBLIC_BACKEND_URL: process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:3000',
  },

  // Server external packages (moved from experimental in Next.js 16)
  serverExternalPackages: [
    '@reown/appkit',
    '@reown/appkit-core',
    '@reown/appkit-utils',
    '@reown/appkit-controllers',
    '@privy-io/react-auth',
    'pino',
    'pino-pretty',
    'thread-stream',
    '@walletconnect/ethereum-provider',
    '@walletconnect/universal-provider',
  ],

  // Turbopack configuration (Next.js 16 default)
  turbopack: {
    resolveAlias: {
      // Prevent bundling test dependencies
      'why-is-node-running': false,
      'tap': false,
    },
  },

  // Webpack configuration (fallback for when --webpack flag is used)
  webpack: (config, { isServer }) => {
    config.resolve = config.resolve || {}
    config.resolve.alias = {
      ...config.resolve.alias,
      'why-is-node-running': false,
      'tap': false,
    }

    config.externals = config.externals || []
    if (isServer) {
      config.externals.push(
        'why-is-node-running',
        'tap'
      )
    }

    return config
  },

  // Headers for security
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          {
            key: 'X-DNS-Prefetch-Control',
            value: 'on'
          },
          {
            key: 'X-Frame-Options',
            value: 'SAMEORIGIN'
          },
          {
            key: 'X-Content-Type-Options',
            value: 'nosniff'
          },
          {
            key: 'Referrer-Policy',
            value: 'origin-when-cross-origin'
          },
        ],
      },
    ]
  },
}

module.exports = nextConfig
