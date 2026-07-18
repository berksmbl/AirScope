import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // node-routeros is a plain Node library (optional require of
  // source-map-support trips the bundler) — load it at runtime instead
  serverExternalPackages: ["node-routeros"],
};

export default nextConfig;
