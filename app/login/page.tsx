'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'

export default function LoginPage() {
    const [email, setEmail] = useState('')
    const [password, setPassword] = useState('')
    const [loading, setLoading] = useState(false)
    const router = useRouter()
    const supabase = createClient()

    const handleLogin = async (e: React.FormEvent) => {
        e.preventDefault()
        setLoading(true)

        try {
            const { data, error } = await supabase.auth.signInWithPassword({
                email,
                password
            })

            if (error) throw error

            toast.success('Logged in successfully')
            router.push('/dashboard')
            router.refresh()
        } catch (error: any) {
            toast.error(error.message || 'Login failed')
        } finally {
            setLoading(false)
        }
    }

    const handleSignUp = async () => {
        setLoading(true)

        try {
            const { data, error } = await supabase.auth.signUp({
                email,
                password
            })

            if (error) throw error

            // Create athlete profile automatically after successful signup
            if (data.user) {
                try {
                    console.log('Attempting to create athlete profile for user:', data.user.id)

                    const response = await fetch('/api/auth/create-athlete', {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json'
                        },
                        body: JSON.stringify({
                            userId: data.user.id,
                            email: data.user.email
                        })
                    })

                    const result = await response.json()

                    if (!response.ok) {
                        console.error('Failed to create athlete profile:', result)
                    } else {
                        console.log('Athlete profile created successfully:', result.athlete)
                    }
                } catch (athleteErr) {
                    // Log error but don't fail the signup
                    console.error('Error creating athlete profile:', athleteErr)
                }
            }

            toast.success('Account created! Please check your email to verify.')
        } catch (error: any) {
            toast.error(error.message || 'Sign up failed')
        } finally {
            setLoading(false)
        }
    }

    return (
        <div className="min-h-screen flex items-center justify-center bg-background p-4">
            <Card className="w-full max-w-md">
                <CardHeader>
                    <CardTitle className="text-2xl">TrAIner Login</CardTitle>
                    <CardDescription>Sign in to access your training platform</CardDescription>
                </CardHeader>
                <CardContent>
                    <form onSubmit={handleLogin} className="space-y-4">
                        <div className="space-y-2">
                            <Label htmlFor="email">Email</Label>
                            <Input
                                id="email"
                                type="email"
                                placeholder="you@example.com"
                                value={email}
                                onChange={(e) => setEmail(e.target.value)}
                                required
                            />
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="password">Password</Label>
                            <Input
                                id="password"
                                type="password"
                                placeholder="••••••••"
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                required
                            />
                        </div>
                        <div className="flex gap-2">
                            <Button type="submit" disabled={loading} className="flex-1">
                                {loading ? 'Loading...' : 'Sign In'}
                            </Button>
                            <Button
                                type="button"
                                variant="outline"
                                onClick={handleSignUp}
                                disabled={loading}
                                className="flex-1"
                            >
                                Sign Up
                            </Button>
                        </div>
                    </form>
                    <div className="mt-4 p-3 bg-muted rounded-md text-sm">
                        <p className="font-medium mb-1">Development Mode</p>
                        <p className="text-muted-foreground text-xs">
                            Use NEXT_PUBLIC_ATHLETE_ID from .env.local or create a new account
                        </p>
                    </div>
                </CardContent>
            </Card>
        </div>
    )
}
