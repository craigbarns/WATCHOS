import type { MetadataRoute } from 'next'

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Heure et Passion — Caisse & SAV',
    short_name: 'H&P Caisse',
    description: 'Caisse, stock et SAV de la boutique',
    start_url: '/dashboard',
    display: 'standalone',
    orientation: 'any',
    background_color: '#0a0a0a',
    theme_color: '#0a0a0a',
    lang: 'fr',
    icons: [
      { src: '/app-icon?size=192', sizes: '192x192', type: 'image/png' },
      { src: '/app-icon?size=512', sizes: '512x512', type: 'image/png' },
      { src: '/app-icon?size=512', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  }
}
