import type { MetadataRoute } from 'next';

// Pilot: nothing here should appear in search results (join codes, test flats). Open this up for launch.
export default function robots(): MetadataRoute.Robots {
  return { rules: { userAgent: '*', disallow: '/' } };
}
