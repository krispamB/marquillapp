import type { NextConfig } from "next";

// Proxy backend API calls through the Next origin so Clerk's same-origin
// `__session` cookie rides along with `credentials: "include"` browser requests.
const backendApiUrl =
  process.env.BACKEND_API_URL ?? "http://localhost:3500/api/v1";

const nextConfig: NextConfig = {
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
