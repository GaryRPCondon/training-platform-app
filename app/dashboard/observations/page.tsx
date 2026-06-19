import { ObservationsPanel } from '@/components/observations/observations-panel'
import { getTranslations } from 'next-intl/server'

export default async function ObservationsPage() {
    const t = await getTranslations('observations')
    return (
        <div className="space-y-6">
            <h1 className="text-3xl font-bold tracking-tight">{t('pageTitle')}</h1>
            <div className="grid gap-6 md:grid-cols-2">
                <div className="space-y-6">
                    <ObservationsPanel />
                </div>
                <div className="space-y-6">
                    {/* Placeholder for future charts or detailed analysis */}
                    <div className="rounded-lg border bg-card text-card-foreground shadow-sm p-6">
                        <h3 className="text-lg font-semibold mb-4">{t('trends')}</h3>
                        <p className="text-muted-foreground">
                            {t('trendsBody')}
                        </p>
                    </div>
                </div>
            </div>
        </div>
    )
}
