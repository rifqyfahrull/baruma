import type { NextConfig } from "next";

// Security headers — defense-in-depth (audit CSO 2026-08-09). Sengaja TANPA
// Content-Security-Policy penuh: Next + React Three Fiber butuh inline
// script/style, jadi CSP script-src ketat gampang mematahkan app dan harus
// dites terpisah (report-only) sebelum di-enforce. Yang di sini semuanya
// aman-tanpa-tes: anti-clickjacking, anti-MIME-sniff, HSTS, referrer, dan
// pembatasan fitur browser. `frame-ancestors 'none'` + `object-src 'none'`
// dikirim sebagai CSP minimal yang tidak menyentuh eksekusi skrip.
const securityHeaders = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains; preload",
  },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), browsing-topics=()",
  },
  {
    key: "Content-Security-Policy",
    value: "frame-ancestors 'none'; object-src 'none'; base-uri 'self'",
  },
];

const nextConfig: NextConfig = {
  output: "standalone",
  allowedDevOrigins: [
    "baruma-nextjs.preview.emergentagent.com",
    "baruma-nextjs.cluster-5.preview.emergentcf.cloud",
    "*.preview.emergentagent.com",
    "*.cluster-5.preview.emergentcf.cloud",
  ],
  experimental: {
    optimizePackageImports: [
      "radix-ui",
      "@react-three/drei",
      "lucide-react",
      "date-fns",
      "three",
    ],
  },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
