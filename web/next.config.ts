import type { NextConfig } from "next";

const config: NextConfig = {
  // Test runs may build beside the daily output while targeting an isolated API port.
  distDir: process.env.CMS_TEST_DIST_DIR || ".next",
  output: "standalone",
  poweredByHeader: false,
  experimental: { proxyClientMaxBodySize: 55_000_000 },
  async rewrites() {
    const api = process.env.API_INTERNAL_URL || "http://127.0.0.1:5080";
    return [
      { source: "/api/:path*", destination: `${api}/api/:path*` },
      { source: "/media/:path*", destination: `${api}/media/:path*` },
    ];
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Frame-Options", value: "DENY" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=()",
          },
        ],
      },
    ];
  },
};
export default config;
