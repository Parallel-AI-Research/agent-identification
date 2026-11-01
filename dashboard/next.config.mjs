import { createMDX } from "fumadocs-mdx/next";

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

export default withMDX(config);
