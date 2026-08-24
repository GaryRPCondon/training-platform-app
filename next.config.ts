import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./i18n/request.ts");

const nextConfig: NextConfig = {
  // Overridable build dir so a throwaway dev server (e.g. the mobile-shots
  // harness in WSL) can run on its own `.next-*` without corrupting the primary
  // `.next` a concurrent server is using. Defaults to `.next` for normal runs.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  // Dev-only: allow LAN hosts (phone on the same wifi) to load /_next/* dev
  // resources. Extra hosts can be added via NEXT_DEV_ORIGINS (comma-separated).
  allowedDevOrigins: [
    "192.168.0.113",
    "192.168.0.*",
    "192.168.1.*",
    ...(process.env.NEXT_DEV_ORIGINS?.split(",")
      .map((o) => o.trim())
      .filter(Boolean) ?? []),
  ],
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          {
            key: "Strict-Transport-Security",
            value: "max-age=63072000; includeSubDomains",
          },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=()",
          },
        ],
      },
    ];
  },
};

export default withNextIntl(nextConfig);
