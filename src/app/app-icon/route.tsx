import { ImageResponse } from 'next/og'
import { BrandIcon } from '@/lib/brand-icon'

/** Icônes PWA : /app-icon?size=192 | 512 */
export function GET(request: Request) {
  const requested = Number(new URL(request.url).searchParams.get('size'))
  const size = [192, 512].includes(requested) ? requested : 192
  return new ImageResponse(<BrandIcon size={size} />, {
    width: size,
    height: size,
    headers: { 'Cache-Control': 'public, max-age=86400, immutable' },
  })
}
