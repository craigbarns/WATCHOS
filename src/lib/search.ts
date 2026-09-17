/** Remove PostgREST filter delimiters, preserving watch references and names. */
export function sanitizeSearchTerm(term: string): string {
  return term.replace(/[,()*%\\"]/g, ' ').trim().slice(0, 200)
}
