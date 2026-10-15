import type { FocusEvent, MouseEvent } from 'react'

/**
 * Champ de montant prérempli : entrer dans le champ sélectionne tout le montant,
 * pour qu'un chiffre tapé le remplace au lieu de s'y ajouter (« 59 » puis « 8 »
 * donnait 598 ou 859). Le clic qui donne le focus resélectionne, car le navigateur
 * (Safari sur iPad notamment) place le curseur sous le doigt juste après le focus.
 * Les clics suivants placent le curseur normalement pour corriger un chiffre.
 */
const justFocused = new WeakSet<HTMLInputElement>()

function selectAll(input: HTMLInputElement) {
  if (document.activeElement === input) input.setSelectionRange(0, input.value.length)
}

export const selectWholeAmount = {
  onFocus(e: FocusEvent<HTMLInputElement>) {
    const input = e.currentTarget
    justFocused.add(input)
    setTimeout(() => selectAll(input), 0)
  },
  onClick(e: MouseEvent<HTMLInputElement>) {
    const input = e.currentTarget
    if (!justFocused.delete(input)) return
    selectAll(input)
    setTimeout(() => selectAll(input), 0)
  },
  onBlur(e: FocusEvent<HTMLInputElement>) {
    justFocused.delete(e.currentTarget)
  },
}
