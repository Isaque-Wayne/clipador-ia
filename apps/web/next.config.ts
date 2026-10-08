import type { NextConfig } from "next";
import { resolveUploadLimits } from "../../config/upload-limits.mjs";

const { maxFileBytes } = resolveUploadLimits(process.env);

const nextConfig: NextConfig = {
  experimental: { proxyClientMaxBodySize: maxFileBytes },
  env: { NEXT_PUBLIC_UPLOAD_MAX_FILE_BYTES: String(maxFileBytes) },
  async rewrites() {
    return [{
      source: "/api/uploads/:path*",
      destination: `${process.env["API_BASE_URL"] ?? "http://127.0.0.1:3001"}/uploads/:path*`,
    }, { source: "/api/ingestions/:path*", destination: `${process.env["API_BASE_URL"] ?? "http://127.0.0.1:3001"}/ingestions/:path*` }];
  },
};

export default nextConfig;
