/** Largeur imprimable d'un rouleau thermique 80 mm (la tête n'imprime pas jusqu'aux bords). */
const PRINTABLE_WIDTH = '72mm'

/**
 * Imprime un élément seul, dans une iframe isolée au format ticket 80 mm.
 * Plus fiable que window.print() sur la page entière : hauteur de rouleau
 * libre, pas de marges, noir pur.
 */
export function printElement(element: HTMLElement): Promise<void> {
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

    doc.open()
    doc.write(`<!doctype html>
<html class="${document.documentElement.className}">
<head>
<meta charset="utf-8">
${styles}
<style>
  @page { size: 80mm auto; margin: 0; }
  html, body { margin: 0 !important; padding: 0 !important; background: #fff !important; }
  body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .print-root { width: ${PRINTABLE_WIDTH}; margin: 0 auto; }
  .print-root, .print-root * { color: #000 !important; border-color: #000 !important; }
  .print-root .print-area { max-width: none !important; width: 100% !important; padding: 2mm 0 6mm !important; }
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
