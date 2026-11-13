import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Standalone output for the Docker image.
  output: 'standalone',
  reactStrictMode: true,
};

export default nextConfig;
