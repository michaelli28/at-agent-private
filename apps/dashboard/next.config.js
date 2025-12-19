/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  output: 'standalone',
  // Experimental features for server-side functionality
  experimental: {
    serverComponentsExternalPackages: ['playwright', 'playwright-core'],
    instrumentationHook: true,
  },
}

module.exports = nextConfig
