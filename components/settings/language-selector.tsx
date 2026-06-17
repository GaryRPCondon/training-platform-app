'use client'

import { useTranslations } from 'next-intl'

import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { locales, localeLabels, type Locale } from '@/i18n/config'

/**
 * Controlled language field. Purely presentational — the parent Preferences card
 * owns the value and persists it through the shared Save button (so language
 * behaves like the other DB-backed fields, not an instant-apply control).
 */
export function LanguageSelector({
    value,
    onChange,
    disabled,
}: {
    value: Locale
    onChange: (locale: Locale) => void
    disabled?: boolean
}) {
    const t = useTranslations('settings')

    return (
        <div className="space-y-2">
            <Label htmlFor="language">{t('language')}</Label>
            <Select value={value} onValueChange={(v) => onChange(v as Locale)} disabled={disabled}>
                <SelectTrigger id="language">
                    <SelectValue />
                </SelectTrigger>
                <SelectContent>
                    {locales.map((loc) => (
                        <SelectItem key={loc} value={loc}>{localeLabels[loc]}</SelectItem>
                    ))}
                </SelectContent>
            </Select>
        </div>
    )
}
