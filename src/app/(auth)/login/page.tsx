'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card'
import { Eye, EyeOff, ArrowRight, Loader2, LockKeyhole } from 'lucide-react'

export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const router = useRouter()
  const supabase = createClient()

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError(null)

    try {
      const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password })
      if (error) {
        setError(/invalid login credentials/i.test(error.message) ? 'Email ou mot de passe incorrect.' : 'Connexion impossible. Vérifiez vos identifiants et réessayez.')
      } else {
        router.replace('/dashboard')
        router.refresh()
      }
    } catch {
      setError('La connexion a été interrompue. Vérifiez votre réseau et réessayez.')
    } finally {
      setLoading(false)
    }
  }

  const heroImage = "url('https://images.unsplash.com/photo-1523170335258-f5ed11844a49?q=80&w=2080&auto=format&fit=crop')"

  return (
    <div className="flex min-h-dvh flex-col bg-black lg:flex-row lg:bg-background">
      {/* Visuel : bandeau sur téléphone, colonne sur grand écran */}
      <div className="relative h-[38dvh] min-h-56 shrink-0 bg-[#183b32] lg:h-auto lg:w-1/2">
        <div className="absolute inset-0 bg-cover bg-center opacity-80" style={{ backgroundImage: heroImage }} />
        <div className="absolute inset-0 bg-gradient-to-t from-black via-black/40 to-black/10 lg:from-black/80 lg:via-transparent lg:to-transparent" />
        <div className="absolute inset-x-6 bottom-10 text-white lg:inset-x-12 lg:bottom-12">
          <p className="mb-2 text-xs tracking-[0.35em] text-[#c8a96a] uppercase lg:hidden">Heure et Passion</p>
          <h2 className="font-playfair text-3xl font-bold tracking-tight lg:mb-4 lg:text-4xl">L&apos;art de la précision.</h2>
          <p className="hidden text-lg font-light text-gray-300 lg:block">
            Gérez votre boutique avec un outil à la hauteur de vos garde-temps.
          </p>
        </div>
      </div>

      {/* Formulaire : feuille arrondie sur téléphone, carte centrée sur grand écran */}
      <div className="relative -mt-6 flex flex-1 items-start justify-center rounded-t-3xl bg-background px-5 pt-8 pb-[calc(2rem+env(safe-area-inset-bottom))] lg:mt-0 lg:w-1/2 lg:items-center lg:rounded-none lg:bg-transparent lg:p-8">
        <Card className="w-full max-w-md border-0 shadow-none ring-0 lg:bg-transparent lg:shadow-none lg:ring-0">
          <CardHeader className="space-y-1 max-lg:px-0">
            <CardTitle className="text-center font-playfair text-2xl font-bold lg:text-3xl">
              <span className="lg:hidden">Connexion</span>
              <span className="hidden lg:inline">Heure et Passion</span>
            </CardTitle>
            <CardDescription className="text-md pt-2 text-center">
              Votre espace, vos pièces, vos clients.
            </CardDescription>
          </CardHeader>
          <form onSubmit={handleLogin}>
            <CardContent className="space-y-4 max-lg:px-0">
              {error && (
                <div role="alert" className="rounded-md border border-red-100 bg-red-50 p-3 text-sm font-medium text-red-600">
                  {error}
                </div>
              )}
              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  inputMode="email"
                  autoComplete="email"
                  autoCapitalize="none"
                  placeholder="vendeur@boutique.com"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="h-12 lg:h-11"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="password">Mot de passe</Label>
                <div className="relative">
                  <Input
                    id="password"
                    type={showPassword ? 'text' : 'password'}
                    autoComplete="current-password"
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="h-12 pr-12 lg:h-11"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
                    aria-label={showPassword ? 'Masquer le mot de passe' : 'Afficher le mot de passe'}
                    aria-pressed={showPassword}
                    title={showPassword ? 'Masquer le mot de passe' : 'Afficher le mot de passe'}
                    className="absolute inset-y-0 right-0 flex w-12 items-center justify-center rounded-r-lg text-muted-foreground hover:text-foreground focus-visible:text-foreground focus-visible:outline-none"
                  >
                    {showPassword ? <EyeOff className="size-5" /> : <Eye className="size-5" />}
                  </button>
                </div>
              </div>
            </CardContent>
            <CardFooter className="flex flex-col gap-3 border-0 bg-transparent pt-6 max-lg:px-0">
              <Button type="submit" className="h-12 w-full text-base font-medium lg:h-12" disabled={loading}>
                {loading ? <Loader2 className="animate-spin" /> : <LockKeyhole className="size-4" />} {loading ? 'Connexion…' : 'Accéder à ma boutique'} {!loading && <ArrowRight className="ml-auto size-4" />}
              </Button>
              <p className="text-center text-sm text-muted-foreground">
                Pas encore de compte ? Demandez à l&apos;administrateur de la boutique de vous en créer un.
              </p>
            </CardFooter>
          </form>
        </Card>
      </div>
    </div>
  )
}
