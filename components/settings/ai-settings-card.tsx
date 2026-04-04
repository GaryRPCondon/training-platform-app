'use client'

import { useState, useEffect, useRef } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { toast } from 'sonner'
import { Loader2 } from 'lucide-react'

interface ProviderAvailability {
    name: string
    available: boolean
}

export function AISettingsCard() {
    const [loading, setLoading] = useState(true)
    const [saving, setSaving] = useState(false)
    const [provider, setProvider] = useState('deepseek')
    const [model, setModel] = useState('')
    const [useFastModel, setUseFastModel] = useState(true)
    const [aiSummariesEnabled, setAiSummariesEnabled] = useState(false)
    const [showCostWarning, setShowCostWarning] = useState(false)
    const [availableProviders, setAvailableProviders] = useState<ProviderAvailability[]>([])
    const savedValues = useRef({ provider: 'deepseek', model: '', useFastModel: true, aiSummariesEnabled: false })

    useEffect(() => {
        fetchSettings()
        fetchAvailableProviders()
    }, [])

    const fetchAvailableProviders = async () => {
        try {
            const response = await fetch('/api/settings/available-providers')
            if (response.ok) {
                const data = await response.json()
                setAvailableProviders(data.providers || [])
            }
        } catch {
            // Silently fail — all providers will appear available
        }
    }

    const isProviderAvailable = (name: string) => {
        if (availableProviders.length === 0) return true // Not loaded yet, don't block
        return availableProviders.find(p => p.name === name)?.available ?? false
    }

    const fetchSettings = async () => {
        try {
            const response = await fetch('/api/settings/get')
            if (response.ok) {
                const data = await response.json()
                const vals = {
                    provider: data.provider || 'deepseek',
                    model: data.model || '',
                    useFastModel: data.useFastModelForOperations ?? true,
                    aiSummariesEnabled: data.aiSummariesEnabled ?? false,
                }
                setProvider(vals.provider)
                setModel(vals.model)
                setUseFastModel(vals.useFastModel)
                setAiSummariesEnabled(vals.aiSummariesEnabled)
                savedValues.current = vals
            }
        } catch (error) {
            console.error('Failed to fetch settings:', error)
            toast.error('Failed to load settings')
        } finally {
            setLoading(false)
        }
    }

    const hasChanges = provider !== savedValues.current.provider ||
        model !== savedValues.current.model ||
        useFastModel !== savedValues.current.useFastModel ||
        aiSummariesEnabled !== savedValues.current.aiSummariesEnabled

    const handleSave = async () => {
        setSaving(true)
        try {
            const response = await fetch('/api/settings/update', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    provider,
                    model,
                    useFastModelForOperations: useFastModel,
                    ai_summaries_enabled: aiSummariesEnabled,
                })
            })

            if (!response.ok) throw new Error('Failed to update settings')

            savedValues.current = { provider, model, useFastModel, aiSummariesEnabled }
            toast.success('AI settings saved successfully')
        } catch (error) {
            console.error('Failed to save settings:', error)
            toast.error('Failed to save settings')
        } finally {
            setSaving(false)
        }
    }

    if (loading) {
        return (
            <Card>
                <CardHeader>
                    <CardTitle>AI Configuration</CardTitle>
                </CardHeader>
                <CardContent>
                    <div className="flex items-center justify-center h-40">
                        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                    </div>
                </CardContent>
            </Card>
        )
    }

    return (
        <Card>
            <CardHeader>
                <CardTitle>AI Configuration</CardTitle>
                <CardDescription>
                    Select which AI model you want to use for the training assistant.
                </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
                <div className="space-y-2">
                    <Label htmlFor="provider">LLM Provider</Label>
                    <Select value={provider} onValueChange={setProvider}>
                        <SelectTrigger id="provider">
                            <SelectValue placeholder="Select a provider" />
                        </SelectTrigger>
                        <SelectContent>
                            {[
                                { value: 'deepseek', label: 'DeepSeek (Recommended)' },
                                { value: 'gemini', label: 'Google Gemini' },
                                { value: 'anthropic', label: 'Anthropic Claude' },
                                { value: 'openai', label: 'OpenAI GPT-4' },
                                { value: 'grok', label: 'xAI Grok' },
                            ].map(p => (
                                <SelectItem
                                    key={p.value}
                                    value={p.value}
                                    disabled={!isProviderAvailable(p.value)}
                                >
                                    {p.label}{!isProviderAvailable(p.value) ? ' (Not available)' : ''}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                </div>

                {availableProviders.length > 0 && !isProviderAvailable(provider) && (
                    <div className="p-3 bg-amber-50 dark:bg-amber-950 border border-amber-200 dark:border-amber-800 rounded-md text-sm text-amber-800 dark:text-amber-200">
                        The selected provider is no longer available. Please choose a different one.
                    </div>
                )}

                <div className="space-y-2">
                    <Label htmlFor="model">Model Name (Optional)</Label>
                    <div className="flex gap-2">
                        <input
                            id="model"
                            type="text"
                            value={model}
                            onChange={(e) => setModel(e.target.value)}
                            placeholder="e.g., claude-3-5-sonnet-20240620"
                            className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                        />
                    </div>
                    <p className="text-sm text-muted-foreground">
                        Override the default model. Leave empty to use default.
                    </p>
                </div>

                <div className="flex items-center justify-between p-3 sm:p-4 border rounded-lg">
                    <div>
                        <Label htmlFor="useFastModel" className="cursor-pointer">
                            Use non-reasoning model for operations
                        </Label>
                        <p className="text-xs text-muted-foreground mt-0.5">
                            Faster models for quick plan modifications. Recommended.
                        </p>
                    </div>
                    <Switch
                        id="useFastModel"
                        checked={useFastModel}
                        onCheckedChange={(checked) => setUseFastModel(checked)}
                    />
                </div>

                <div className="flex items-center justify-between p-3 sm:p-4 border rounded-lg">
                    <div>
                        <Label htmlFor="aiSummaries" className="cursor-pointer">
                            AI Summaries on activity sync
                        </Label>
                        <p className="text-xs text-muted-foreground mt-0.5">
                            Auto-generate coaching summaries when activities match planned workouts.
                        </p>
                    </div>
                    <Switch
                        id="aiSummaries"
                        checked={aiSummariesEnabled}
                        onCheckedChange={(checked) => {
                            if (checked && !aiSummariesEnabled) {
                                setShowCostWarning(true)
                            } else {
                                setAiSummariesEnabled(checked)
                            }
                        }}
                    />
                </div>

                <AlertDialog open={showCostWarning} onOpenChange={setShowCostWarning}>
                    <AlertDialogContent>
                        <AlertDialogHeader>
                            <AlertDialogTitle>Enable AI Summaries</AlertDialogTitle>
                            <AlertDialogDescription>
                                AI summaries use your configured LLM provider to analyse each matched activity. This will consume API tokens and may incur additional costs depending on your provider and usage volume.
                            </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                            <AlertDialogCancel>Cancel</AlertDialogCancel>
                            <AlertDialogAction onClick={() => setAiSummariesEnabled(true)}>
                                Enable
                            </AlertDialogAction>
                        </AlertDialogFooter>
                    </AlertDialogContent>
                </AlertDialog>

                <Button onClick={handleSave} disabled={saving || !hasChanges} className="w-full">
                    {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    {saving ? 'Saving...' : 'Save AI Settings'}
                </Button>
            </CardContent>
        </Card>
    )
}
