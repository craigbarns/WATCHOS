'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

/** Keeps previous data on refresh failure; ignores stale and unmounted requests. */
export function useRemoteData<T>(load: () => Promise<T>, initial: T) {
  const [data, setData] = useState(initial)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const lifecycle = useRef({ request: 0, mounted: false })
  const resolve = useCallback(async () => {
    const state = lifecycle.current
    const id = ++state.request
    return load().then((result) => {
      if (state.mounted && id === state.request) { setData(result); setError(false) }
    }).catch(() => {
      if (state.mounted && id === state.request) setError(true)
    }).finally(() => {
      if (state.mounted && id === state.request) setLoading(false)
    })
  }, [load])
  const refresh = useCallback(async () => {
    setLoading(true)
    setError(false)
    await resolve()
  }, [resolve])
  useEffect(() => {
    const state = lifecycle.current
    state.mounted = true
    void resolve()
    return () => { state.mounted = false; state.request++ }
  }, [resolve])
  return { data, loading, error, refresh }
}
