/** @type {import('next').NextConfig} */

const csp = [
  "default-src 'self'",
  "connect-src 'self' https://*.supabase.co",
  "img-src 'self' data:",
  "style-src 'self' 'unsafe-inline'",
  // Next App Router streams content via inline bootstrap scripts, so 'unsafe-inline'
  // is required without nonce middleware. This page renders no user-generated HTML
  // (React escapes the read-only Supabase data), so the script-injection surface is
  // effectively zero. The high-value protections (frame-ancestors, HSTS, nosniff) stay.
  "script-src 'self' 'unsafe-inline'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: csp },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
];

const nextConfig = {
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
