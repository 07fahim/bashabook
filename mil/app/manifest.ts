import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Mil · মেসের হিসাব',
    short_name: 'Mil',
    description: 'Meals, bazar, bills and month-end dues for shared flats.',
    start_url: '/bn',
    display: 'standalone',
    background_color: '#FBF7F0',
    theme_color: '#D9901A',
    icons: [
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
