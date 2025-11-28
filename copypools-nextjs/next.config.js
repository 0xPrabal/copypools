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

  // Experimental features to handle problematic dependencies
  experimental: {
    serverComponentsExternalPackages: [
      '@reown/appkit',
      '@privy-io/react-auth',
      'pino',
      'thread-stream',
    ],
  },

  // Webpack configuration to exclude test files and resolve issues
  webpack: (config, { isServer }) => {
    // Ignore test directories completely
    config.resolve = config.resolve || {}
    config.resolve.alias = {
      ...config.resolve.alias,
      // Prevent bundling of test files
      'why-is-node-running': false,
    }

    // Exclude test files from being processed
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
