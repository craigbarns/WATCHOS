export type PaperFormat = '80mm' | '58mm' | 'A5'

/** Largeur réellement imprimable des rouleaux thermiques (les têtes n'impriment pas jusqu'au bord). */
const PRINTABLE_WIDTH: Record<PaperFormat, string> = {
  '80mm': '72mm',
  '58mm': '48mm',
  A5: '100%',
}

/**
 * Imprime un élément seul, dans une iframe isolée dimensionnée pour le papier visé.
 * Plus fiable que window.print() sur la page entière pour les imprimantes ticket :
 * hauteur de rouleau libre, pas de marges, noir pur.
 */
export function printElement(element: HTMLElement, format: PaperFormat): Promise<void> {
  return new Promise((resolve) => {
    const iframe = document.createElement('iframe')
    iframe.setAttribute('aria-hidden', 'true')
    Object.assign(iframe.style, { position: 'fixed', right: '0', bottom: '0', width: '0', height: '0', border: '0' })
    document.body.appendChild(iframe)

    const doc = iframe.contentDocument
    const win = iframe.contentWindow
    if (!doc || !win) {
      iframe.remove()
      resolve()
      return
    }

    // Reprend les feuilles de style de l'application (Tailwind, polices)
    const styles = [...document.querySelectorAll('style, link[rel="stylesheet"]')].map((n) => n.outerHTML).join('\n')
    const isRoll = format !== 'A5'
    const page = isRoll ? `@page { size: ${format} auto; margin: 0; }` : '@page { size: A5; margin: 8mm; }'

    doc.open()
    doc.write(`<!doctype html>
<html class="${document.documentElement.className}">
<head>
<meta charset="utf-8">
${styles}
<style>
  ${page}
  html, body { margin: 0 !important; padding: 0 !important; background: #fff !important; }
  body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .print-root { width: ${PRINTABLE_WIDTH[format]}; margin: 0 auto; }
  .print-root, .print-root * { color: #000 !important; border-color: #000 !important; }
  ${isRoll ? '.print-root .print-area { max-width: none !important; width: 100% !important; padding: 2mm 0 6mm !important; }' : ''}
  ${format === '58mm' ? '.print-root .print-area { font-size: 9.5px !important; }' : ''}
</style>
</head>
<body><div class="print-root">${element.outerHTML}</div></body>
</html>`)
    doc.close()

    const links = [...doc.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"]')]
    const stylesLoaded = Promise.all(
      links.map((link) => (link.sheet ? Promise.resolve() : new Promise<void>((r) => { link.onload = () => r(); link.onerror = () => r() })))
    )

    stylesLoaded
      .then(() => doc.fonts?.ready)
      .then(() => {
        win.focus()
        win.print()
      })
      .finally(() => {
        // Laisse le temps au spooler de récupérer le document
        setTimeout(() => iframe.remove(), 2000)
        resolve()
      })
  })
}
