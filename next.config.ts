import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Single self-contained server bundle for the Docker image.
  output: "standalone",
  experimental: {
    // proxy.ts guards every route, and Next cuts request bodies to this size when a proxy runs.
    // WhatsApp exports can be up to 50 MB (lib/whatsapp/export-file.ts), plus the form's own bytes.
    proxyClientMaxBodySize: "51mb",
  },
};

export default nextConfig;
