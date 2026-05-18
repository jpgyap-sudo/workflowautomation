import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  // Allow connections from any host (Docker)
  serverExternalPackages: [],
};

export default nextConfig;
