import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Allow external images in article content
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "**",
      },
    ],
  },
};

export default nextConfig;