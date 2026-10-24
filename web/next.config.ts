import type { NextConfig } from 'next';

const config: NextConfig = {
  // Self-contained server output: the Docker image only needs .next/standalone.
  output: 'standalone',
  poweredByHeader: false,
};

export default config;
