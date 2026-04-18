import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // These settings help with Cloudflare Pages compatibility
  output: undefined, // Use default for dev, switch to 'standalone' for Docker if needed

  // Allow external images in article content
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "**",
      },
    ],
  },

  // Ignore SQLite WAL/SHM files that change constantly
  // Turbopack respects .watchmanconfig; webpack uses watchOptions
  turbopack: {},
};

export default nextConfig;