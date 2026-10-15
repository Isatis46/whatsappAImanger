/** @type {import('next').NextConfig} */
const config = {
  output: "standalone",
  poweredByHeader: false,
  devIndicators: false,
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: `${process.env.API_INTERNAL_URL ?? "http://127.0.0.1:4000"}/api/:path*`,
      },
    ];
  },
  experimental: { cpus: 2 },
};
export default config;
