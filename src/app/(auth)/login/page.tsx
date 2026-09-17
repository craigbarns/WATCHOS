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

  return (
    <div className="flex min-h-screen bg-gray-50 dark:bg-gray-900">
      {/* Colonne Image */}
      <div className="hidden lg:block lg:w-1/2 relative bg-black">
        <div
          className="absolute inset-0 bg-cover bg-center opacity-80"
          style={{ backgroundImage: "url('https://images.unsplash.com/photo-1523170335258-f5ed11844a49?q=80&w=2080&auto=format&fit=crop')" }}
        />
        <div className="absolute inset-0 bg-gradient-to-t from-black/80 to-transparent" />
        <div className="absolute bottom-12 left-12 right-12 text-white">
          <h2 className="text-4xl font-playfair font-bold mb-4 tracking-tight">L&apos;art de la précision.</h2>
          <p className="text-lg text-gray-300 font-light">
            Gérez votre boutique avec un outil à la hauteur de vos garde-temps.
          </p>
        </div>
      </div>

      {/* Colonne Login */}
      <div className="flex w-full lg:w-1/2 items-center justify-center p-8">
        <Card className="w-full max-w-md border-0 shadow-lg">
          <CardHeader className="space-y-1">
            <CardTitle className="text-3xl font-playfair font-bold text-center">Heure et Passion</CardTitle>
            <CardDescription className="text-center text-md pt-2">
              Connectez-vous pour accéder à la caisse.
            </CardDescription>
          </CardHeader>
          <form onSubmit={handleLogin}>
            <CardContent className="space-y-4">
              {error && (
                <div className="text-sm font-medium text-red-500 bg-red-50 p-3 rounded-md border border-red-100">
                  {error}
                </div>
              )}
              {success && (
                <div className="text-sm font-medium text-green-700 bg-green-50 p-3 rounded-md border border-green-100">
                  {success}
                </div>
              )}
              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  placeholder="vendeur@boutique.com"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="h-11"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="password">Mot de passe</Label>
                <Input
                  id="password"
                  type="password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="h-11"
                />
              </div>
            </CardContent>
            <CardFooter className="flex flex-col gap-3 pt-4">
              <Button type="submit" className="w-full h-11 text-base font-medium bg-black hover:bg-gray-800 text-white" disabled={loading}>
                {loading ? 'Chargement...' : 'Se connecter'}
              </Button>
              <Button type="button" variant="outline" className="w-full h-11 text-base font-medium" onClick={handleSignUp} disabled={loading}>
                Créer un compte
              </Button>
            </CardFooter>
          </form>
        </Card>
      </div>
    </div>
  )
}
