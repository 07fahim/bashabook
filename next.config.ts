import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: true,
  partialPrefetching: true,
  async redirects() {
    return [{ source: '/', destination: '/bn', permanent: false }];
  },
  // every response: no search indexing during the pilot (robots.ts too), never inside another site's frame, no content-type
  // guessing, no full URL (a join link carries the flat's code) sent to other sites, HTTPS only once seen over HTTPS.
  // The content policy only forbids framing: a script policy would block the inline theme script in the layout
  async headers() {
    return [{
      source: '/:path*',
      headers: [
        { key: 'X-Robots-Tag', value: 'noindex, nofollow' },
        { key: 'X-Frame-Options', value: 'DENY' },
        { key: 'Content-Security-Policy', value: "frame-ancestors 'none'" },
        { key: 'X-Content-Type-Options', value: 'nosniff' },
        { key: 'Referrer-Policy', value: 'same-origin' },
        { key: 'Strict-Transport-Security', value: 'max-age=63072000' },
      ],
    }];
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
