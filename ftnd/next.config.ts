import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // This demo is designed to build reliably on hackathon laptops as well as CI.
  // Limiting static page-data workers avoids Windows worker-process failures
  // without changing the browser runtime.
  experimental: {
    cpus: 1,
  },
};

export default nextConfig;
