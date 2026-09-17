'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card'

export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const router = useRouter()
  const supabase = createClient()

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError(null)
    setSuccess(null)

    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    })

    if (error) {
      setError(error.message)
      setLoading(false)
    } else {
      router.push('/dashboard')
      router.refresh()
    }
  }

  const handleSignUp = async () => {
    setLoading(true)
    setError(null)
    setSuccess(null)

    const { data, error } = await supabase.auth.signUp({
      email,
      password,
    })

    if (error) {
      setError(error.message)
    } else if (data.user) {
      // Le profil est créé par un trigger en base, inactif tant qu'un administrateur ne l'a pas validé
      setSuccess("Compte créé. Confirmez votre email si nécessaire, puis demandez à un administrateur d'activer votre accès.")
    }
    setLoading(false)
  }

  const heroImage = "url('https://images.unsplash.com/photo-1523170335258-f5ed11844a49?q=80&w=2080&auto=format&fit=crop')"

  return (
    <div className="flex min-h-dvh flex-col bg-black lg:flex-row lg:bg-gray-50 dark:lg:bg-gray-900">
      {/* Visuel : bandeau sur téléphone, colonne sur grand écran */}
      <div className="relative h-[38dvh] min-h-56 shrink-0 bg-black lg:h-auto lg:w-1/2">
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
        <Card className="w-full max-w-md border-0 shadow-none ring-0 lg:shadow-lg lg:ring-1">
          <CardHeader className="space-y-1 max-lg:px-0">
            <CardTitle className="text-center font-playfair text-2xl font-bold lg:text-3xl">
              <span className="lg:hidden">Connexion</span>
              <span className="hidden lg:inline">Heure et Passion</span>
            </CardTitle>
            <CardDescription className="text-md pt-2 text-center">
              Connectez-vous pour accéder à la caisse.
            </CardDescription>
          </CardHeader>
          <form onSubmit={handleLogin}>
            <CardContent className="space-y-4 max-lg:px-0">
              {error && (
                <div className="rounded-md border border-red-100 bg-red-50 p-3 text-sm font-medium text-red-600">
                  {error}
                </div>
              )}
              {success && (
                <div className="rounded-md border border-green-100 bg-green-50 p-3 text-sm font-medium text-green-700">
                  {success}
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
                <Input
                  id="password"
                  type="password"
                  autoComplete="current-password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="h-12 lg:h-11"
                />
              </div>
            </CardContent>
            <CardFooter className="flex flex-col gap-3 border-0 bg-transparent pt-6 max-lg:px-0">
              <Button type="submit" className="h-12 w-full bg-black text-base font-medium text-white hover:bg-gray-800 lg:h-11" disabled={loading}>
                {loading ? 'Chargement...' : 'Se connecter'}
              </Button>
              <Button type="button" variant="outline" className="h-12 w-full text-base font-medium lg:h-11" onClick={handleSignUp} disabled={loading}>
                Créer un compte
              </Button>
            </CardFooter>
          </form>
        </Card>
      </div>
    </div>
  )
}
