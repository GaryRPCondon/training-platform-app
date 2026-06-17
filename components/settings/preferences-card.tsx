'use client'

import { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Button } from '@/components/ui/button'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { getAthleteProfile } from '@/lib/supabase/queries'
import { toast } from 'sonner'
import { Loader2, Sun, Moon, Monitor } from 'lucide-react'
import { useTheme } from 'next-themes'
import { useTranslations } from 'next-intl'
import { LanguageSelector } from './language-selector'
import { LOCALE_COOKIE, type Locale } from '@/i18n/config'

export function PreferencesCard() {
    const t = useTranslations('settings')
    const router = useRouter()
    const queryClient = useQueryClient()
    const { theme, setTheme } = useTheme()
    const { data: athlete } = useQuery({
        queryKey: ['athlete'],
        queryFn: getAthleteProfile,
    })

    const [firstName, setFirstName] = useState('')
    const [lastName, setLastName] = useState('')
    const [preferredUnits, setPreferredUnits] = useState<'metric' | 'imperial'>('metric')
    const [weekStartsOn, setWeekStartsOn] = useState<number>(0)
    const [locale, setLocale] = useState<Locale>('en')
    const [saving, setSaving] = useState(false)
    const savedValues = useRef({ firstName: '', lastName: '', preferredUnits: 'metric' as string, weekStartsOn: 0, locale: 'en' as Locale })

    // Theme is an instant *preview* (next-themes applies it live), but it's only
    // committed when the user clicks Save. savedTheme holds the committed baseline
    // so we can show it as a pending change and revert it if the user leaves
    // without saving. Captured once next-themes resolves the active theme.
    const savedTheme = useRef<string | undefined>(undefined)
    useEffect(() => {
        if (theme !== undefined && savedTheme.current === undefined) {
            savedTheme.current = theme
        }
    }, [theme])

    // Update local state when athlete data loads
    useEffect(() => {
        if (athlete) {
            const vals = {
                firstName: athlete.first_name || '',
                lastName: athlete.last_name || '',
                preferredUnits: athlete.preferred_units || 'metric',
                weekStartsOn: athlete.week_starts_on ?? 0,
                locale: (athlete.locale as Locale) || 'en',
            }
            setFirstName(vals.firstName)
            setLastName(vals.lastName)
            setPreferredUnits(vals.preferredUnits as 'metric' | 'imperial')
            setWeekStartsOn(vals.weekStartsOn)
            setLocale(vals.locale)
            savedValues.current = vals
        }
    }, [athlete])

    // Revert an unsaved theme preview only when the card actually unmounts (e.g.
    // navigating away). Empty deps are intentional: depending on next-themes'
    // setTheme — whose identity changes between renders — would re-run this and
    // snap the preview back on every click. Refs read the latest values at unmount.
    const themeRef = useRef(theme)
    themeRef.current = theme
    const setThemeRef = useRef(setTheme)
    setThemeRef.current = setTheme
    useEffect(() => {
        return () => {
            if (savedTheme.current !== undefined && themeRef.current !== savedTheme.current) {
                setThemeRef.current(savedTheme.current)
            }
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])

    const themeChanged = savedTheme.current !== undefined && theme !== savedTheme.current
    const hasChanges = firstName !== savedValues.current.firstName ||
        lastName !== savedValues.current.lastName ||
        preferredUnits !== savedValues.current.preferredUnits ||
        weekStartsOn !== savedValues.current.weekStartsOn ||
        locale !== savedValues.current.locale ||
        themeChanged

    const handleSave = async () => {
        setSaving(true)
        try {
            const localeChanged = locale !== savedValues.current.locale
            const response = await fetch('/api/settings/update', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    first_name: firstName,
                    last_name: lastName,
                    preferred_units: preferredUnits,
                    week_starts_on: weekStartsOn,
                    locale,
                }),
            })

            if (!response.ok) throw new Error('Failed to update settings')

            savedValues.current = { firstName, lastName, preferredUnits, weekStartsOn, locale }
            savedTheme.current = theme // commit the previewed theme
            queryClient.invalidateQueries({ queryKey: ['athlete'] })

            if (localeChanged) {
                // Carry the new locale to the server (cookie next-intl reads) and
                // re-render server components so the whole UI re-localises.
                document.cookie = `${LOCALE_COOKIE}=${locale}; path=/; max-age=${60 * 60 * 24 * 365}; samesite=lax`
                router.refresh()
            }

            toast.success(t('saved'))
        } catch (error) {
            console.error('Error updating preferences:', error)
            toast.error(t('saveError'))
        } finally {
            setSaving(false)
        }
    }

    return (
        <Card className="flex flex-col">
            <CardHeader>
                <CardTitle>{t('title')}</CardTitle>
                <CardDescription>{t('description')}</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col flex-1">
                <div className="space-y-6 flex-1">
                    {/* Name Fields */}
                    <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                            <Label htmlFor="first-name">{t('firstName')}</Label>
                            <Input
                                id="first-name"
                                value={firstName}
                                onChange={(e) => setFirstName(e.target.value)}
                                placeholder={t('firstNamePlaceholder')}
                            />
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="last-name">{t('lastName')}</Label>
                            <Input
                                id="last-name"
                                value={lastName}
                                onChange={(e) => setLastName(e.target.value)}
                                placeholder={t('lastNamePlaceholder')}
                            />
                        </div>
                    </div>

                    {/* Email (read-only) */}
                    <div className="space-y-2">
                        <Label htmlFor="email">{t('email')}</Label>
                        <div className="text-sm text-muted-foreground">{athlete?.email}</div>
                    </div>

                    {/* Units and Week Start - Single Line */}
                    <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                            <Label htmlFor="units">{t('preferredUnits')}</Label>
                            <Select value={preferredUnits} onValueChange={(value) => setPreferredUnits(value as 'metric' | 'imperial')}>
                                <SelectTrigger id="units">
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="metric">{t('unitsMetric')}</SelectItem>
                                    <SelectItem value="imperial">{t('unitsImperial')}</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>

                        <div className="space-y-2">
                            <Label htmlFor="week-start">{t('weekStartsOn')}</Label>
                            <Select value={weekStartsOn.toString()} onValueChange={(value) => setWeekStartsOn(parseInt(value))}>
                                <SelectTrigger id="week-start">
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="0">{t('sunday')}</SelectItem>
                                    <SelectItem value="1">{t('monday')}</SelectItem>
                                    <SelectItem value="6">{t('saturday')}</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                    </div>

                    {/* Appearance */}
                    <div className="space-y-2">
                        <Label>{t('appearance')}</Label>
                        <div className="flex gap-2">
                            <Button
                                type="button"
                                variant={theme === 'light' ? 'default' : 'outline'}
                                size="sm"
                                className="flex-1 gap-1.5"
                                onClick={() => setTheme('light')}
                                aria-pressed={theme === 'light'}
                            >
                                <Sun className="h-3.5 w-3.5" />
                                {t('themeLight')}
                            </Button>
                            <Button
                                type="button"
                                variant={theme === 'dark' ? 'default' : 'outline'}
                                size="sm"
                                className="flex-1 gap-1.5"
                                onClick={() => setTheme('dark')}
                                aria-pressed={theme === 'dark'}
                            >
                                <Moon className="h-3.5 w-3.5" />
                                {t('themeDark')}
                            </Button>
                            <Button
                                type="button"
                                variant={theme === 'system' ? 'default' : 'outline'}
                                size="sm"
                                className="flex-1 gap-1.5"
                                onClick={() => setTheme('system')}
                                aria-pressed={theme === 'system'}
                            >
                                <Monitor className="h-3.5 w-3.5" />
                                {t('themeSystem')}
                            </Button>
                        </div>
                    </div>

                    {/* Language */}
                    <LanguageSelector value={locale} onChange={setLocale} disabled={saving} />
                </div>

                <Button onClick={handleSave} disabled={saving || !hasChanges} className="w-full mt-6">
                    {saving && <Loader2 className="me-2 h-4 w-4 animate-spin" />}
                    {saving ? t('saving') : t('save')}
                </Button>
            </CardContent>
        </Card>
    )
}
