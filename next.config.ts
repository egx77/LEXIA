import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // PGlite (embedded WASM Postgres + pgvector) must load from node_modules at runtime.
  serverExternalPackages: ['@electric-sql/pglite', '@electric-sql/pglite-pgvector'],
  poweredByHeader: false,
  // Lets a test build run beside a developer's running `next dev` without sharing build output.
  distDir: process.env.LEXIA_DIST_DIR || '.next',
  async headers() {
    return [
      {
        // FR-020 / DEV-106: confidential app and API responses must never be cached by browser or SW.
        source: '/(app|api)/:path*',
        headers: [
          { key: 'Cache-Control', value: 'no-store, private' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'same-origin' },
          { key: 'X-Frame-Options', value: 'DENY' },
        ],
      },
    ];
  },
};

export default nextConfig;
