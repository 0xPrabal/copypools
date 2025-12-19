/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  webpack: (config) => {
    config.resolve.fallback = { fs: false, net: false, tls: false };
    config.externals.push('pino-pretty', 'lokijs', 'encoding');
    return config;
  },
  // Transpile packages to avoid barrel optimization issues
  transpilePackages: ['lucide-react'],
  // Use experimental config for server external packages (Next.js 14+)
  experimental: {
    serverComponentsExternalPackages: ['lucide-react'],
  },
  // Enable compression
  compress: true,
  // Optimize images
  images: {
    formats: ['image/avif', 'image/webp'],
  },
  // Production optimizations
  poweredByHeader: false,
};

module.exports = nextConfig;
