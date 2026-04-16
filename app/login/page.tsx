'use client'

import { useState, Suspense } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { useRouter, useSearchParams } from 'next/navigation'
import { toast } from 'sonner'
import { Clock } from 'lucide-react'

function LoginForm() {
    const [email, setEmail] = useState('')
    const [password, setPassword] = useState('')
    const [loading, setLoading] = useState(false)
    const [signupComplete, setSignupComplete] = useState(false)
    const router = useRouter()
    const searchParams = useSearchParams()
    const supabase = createClient()

    // Only honour relative redirects to prevent open-redirect attacks
    const rawRedirect = searchParams.get('redirectTo') || ''
    const redirectTo = rawRedirect.startsWith('/') ? rawRedirect : '/dashboard'

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
            router.push(redirectTo)
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

            setSignupComplete(true)
            toast.success('Account created! Awaiting admin approval.')
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
                    {signupComplete && (
                        <Alert className="mb-4">
                            <Clock className="h-4 w-4" />
                            <AlertDescription>
                                Your account has been created and is awaiting admin approval.
                                You&apos;ll receive access once an administrator approves your account.
                            </AlertDescription>
                        </Alert>
                    )}
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
                </CardContent>
            </Card>
        </div>
    )
}

export default function LoginPage() {
    return (
        <Suspense>
            <LoginForm />
        </Suspense>
    )
}
