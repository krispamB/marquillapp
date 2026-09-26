import type { NextConfig } from "next";

// Proxy backend API calls through the Next origin so Clerk's same-origin
// `__session` cookie rides along with `credentials: "include"` browser requests.
const backendApiUrl =
  process.env.BACKEND_API_URL ?? "http://localhost:3500/api/v1";

const nextConfig: NextConfig = {
  images: {
    // Whitelist the remote hosts whose raster images we serve through
    // next/image (on-the-fly WebP/AVIF + resize). Stock photo CDNs and the
    // YouTube thumbnail CDN have stable, known hostnames; avatar/org-logo
    // hosts are backend/Clerk-provided and stay on plain <img> for now.
    remotePatterns: [
      { protocol: "https", hostname: "images.unsplash.com" },
      { protocol: "https", hostname: "images.pexels.com" },
      { protocol: "https", hostname: "i.ytimg.com" },
    ],
  },
  // Baseline hardening. A full script/style CSP is deliberately not set here:
  // Clerk, Paddle, Vercel Analytics, and the inline theme script each need
  // allowances, and a guessed policy would break sign-in or billing.
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
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
  async rewrites() {
    return [
      {
        source: "/api/v1/:path*",
        destination: `${backendApiUrl}/:path*`,
      },
    ];
  },
};

export default nextConfig;
