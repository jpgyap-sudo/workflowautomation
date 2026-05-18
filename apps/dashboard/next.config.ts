import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  // Allow connections from any host (Docker)
  serverExternalPackages: [],

  // ── Performance Optimizations ──────────────────────────────────────
  
  // Enable React strict mode for better development experience
  reactStrictMode: true,

  // Enable compression for text responses
  compress: true,

  // Configure logging
  logging: {
    fetches: {
      fullUrl: false,
    },
  },

  // Experimental features for better performance
  experimental: {
    // Optimize server components
    optimizeServerReact: true,
    // Optimize CSS
    optimizeCss: false, // Set to true if you install `critters`
    // Enable scroll restoration
    scrollRestoration: true,
  },

  // Image optimization
  images: {
    // Disable image optimization since we don't use next/image
    unoptimized: true,
  },

  // Headers for caching
  async headers() {
    return [
      {
        // Static assets - cache aggressively
        source: '/_next/static/:path*',
        headers: [
          {
            key: 'Cache-Control',
            value: 'public, max-age=31536000, immutable',
          },
        ],
      },
      {
        // API responses - no caching (handled by SWR client-side)
        source: '/api/:path*',
        headers: [
          {
            key: 'Cache-Control',
            value: 'no-store, no-cache, must-revalidate, proxy-revalidate',
          },
        ],
      },
    ];
  },
};

export default nextConfig;
