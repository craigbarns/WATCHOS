/** Monogramme « H&P » utilisé pour les icônes générées (favicon, écran d'accueil). */
export function BrandIcon({ size }: { size: number }) {
  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: '#0a0a0a',
        color: '#f5f0e6',
        fontFamily: 'Georgia, serif',
        fontSize: size * 0.36,
        fontWeight: 700,
        letterSpacing: -size * 0.01,
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: size * 0.78,
          height: size * 0.78,
          borderRadius: '50%',
          border: `${Math.max(1, size * 0.02)}px solid #c8a96a`,
        }}
      >
        H&amp;P
      </div>
    </div>
  )
}
