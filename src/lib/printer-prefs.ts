'use client'

import { useSyncExternalStore } from 'react'

/** Réglage d'impression propre à ce poste de caisse (navigateur), pas partagé entre postes. */
export type PrinterPrefs = {
  autoPrint: boolean
}

const KEY = 'hp:printer-prefs'
const DEFAULTS: PrinterPrefs = { autoPrint: false }
const listeners = new Set<() => void>()
let cached: PrinterPrefs | null = null

function read(): PrinterPrefs {
  if (cached) return cached
  try {
    const stored = JSON.parse(localStorage.getItem(KEY) ?? '{}')
    cached = { autoPrint: Boolean(stored.autoPrint) }
  } catch {
    cached = DEFAULTS
  }
  return cached!
}

export function setPrinterPrefs(patch: Partial<PrinterPrefs>) {
  cached = { ...read(), ...patch }
  try {
    localStorage.setItem(KEY, JSON.stringify(cached))
  } catch {
    // stockage indisponible (navigation privée) : le réglage vaut pour la session
  }
  listeners.forEach((l) => l())
}

export function usePrinterPrefs(): PrinterPrefs {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    read,
    () => DEFAULTS
  )
}
