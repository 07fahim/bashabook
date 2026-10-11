import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'BashaBook · Shared flat accounts',
    short_name: 'BashaBook',
    description: 'Meals, bazar, bills and month-end dues for shared flats.',
    id: '/',
    scope: '/',
    start_url: '/en/home',
    display: 'standalone',
    background_color: '#FBF7F0',
    theme_color: '#FBF7F0',
    icons: [
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
