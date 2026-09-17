'use client'

import { useSyncExternalStore } from 'react'
import type { PaperFormat } from '@/lib/print'

/** Réglages d'impression propres à ce poste de caisse (navigateur), pas partagés entre postes. */
export type PrinterPrefs = {
  paper: Extract<PaperFormat, '80mm' | '58mm'>
  autoPrint: boolean
}

const KEY = 'hp:printer-prefs'
const DEFAULTS: PrinterPrefs = { paper: '80mm', autoPrint: false }
const listeners = new Set<() => void>()
let cached: PrinterPrefs | null = null

function read(): PrinterPrefs {
  if (cached) return cached
  try {
    cached = { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) ?? '{}') }
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
