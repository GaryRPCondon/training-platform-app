import { ObservationsPanel } from '@/components/observations/observations-panel'

export default function ObservationsPage() {
    return (
        <div className="space-y-6">
            <h1 className="text-3xl font-bold tracking-tight">Intelligence & Analysis</h1>
            <div className="grid gap-6 md:grid-cols-2">
                <div className="space-y-6">
                    <ObservationsPanel />
                </div>
                <div className="space-y-6">
                    {/* Placeholder for future charts or detailed analysis */}
                    <div className="rounded-lg border bg-card text-card-foreground shadow-sm p-6">
                        <h3 className="text-lg font-semibold mb-4">Trends</h3>
                        <p className="text-muted-foreground">
                            Detailed trend analysis coming in future updates.
                        </p>
                    </div>
                </div>
            </div>
        </div>
    )
}
