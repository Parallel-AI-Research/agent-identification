import { createMDX } from "fumadocs-mdx/next";
import { PHASE_DEVELOPMENT_SERVER } from "next/constants.js";

const withMDX = createMDX();

/** @type {import("next").NextConfig} */
const config = {
  poweredByHeader: false,
  async redirects() {
    return [
      { source: "/products", destination: "/dashboard", permanent: true },
      { source: "/products/new", destination: "/dashboard/products/new", permanent: true },
      { source: "/products/:id", destination: "/dashboard/products/:id", permanent: true },
    ];
  },
  async rewrites() {
    // Every docs page also has a plain Markdown version for coding agents.
    return [{ source: "/docs/:path*.md", destination: "/llms.mdx/docs/:path*/content.md" }];
  },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "Referrer-Policy", value: "no-referrer" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
        ],
      },
    ];
  },
};

export default function nextConfig(phase) {
  return withMDX({
    ...config,
    // Lets a browser test fake the collector for its own requests only. It stays off outside
    // `next dev`, because a request header would then decide where the server's fetches go.
    experimental: { testProxy: phase === PHASE_DEVELOPMENT_SERVER },
  });
}
