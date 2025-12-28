'use client'

import { useState, useEffect } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Label } from '@/components/ui/label'
import { Checkbox } from '@/components/ui/checkbox'
import { toast } from 'sonner'
import { Loader2 } from 'lucide-react'

export function AISettingsCard() {
    const [loading, setLoading] = useState(true)
    const [saving, setSaving] = useState(false)
    const [provider, setProvider] = useState('deepseek')
    const [model, setModel] = useState('')
    const [useFastModel, setUseFastModel] = useState(true)

    useEffect(() => {
        fetchSettings()
    }, [])

    const fetchSettings = async () => {
        try {
            const response = await fetch('/api/settings/get')
            if (response.ok) {
                const data = await response.json()
                if (data.provider) {
                    setProvider(data.provider)
                }
                if (data.model) {
                    setModel(data.model)
                }
                // Default to true if not set
                setUseFastModel(data.useFastModelForOperations ?? true)
            }
        } catch (error) {
            console.error('Failed to fetch settings:', error)
            toast.error('Failed to load settings')
        } finally {
            setLoading(false)
        }
    }

    const handleSave = async () => {
        setSaving(true)
        try {
            const response = await fetch('/api/settings/update', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    provider,
                    model,
                    useFastModelForOperations: useFastModel
                })
            })

            if (!response.ok) throw new Error('Failed to update settings')

            toast.success('Settings saved successfully')
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
                            <SelectItem value="deepseek">DeepSeek (Recommended)</SelectItem>
                            <SelectItem value="gemini">Google Gemini</SelectItem>
                            <SelectItem value="anthropic">Anthropic Claude</SelectItem>
                            <SelectItem value="openai">OpenAI GPT-4</SelectItem>
                            <SelectItem value="grok">xAI Grok</SelectItem>
                        </SelectContent>
                    </Select>
                </div>

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

                <div className="flex items-center space-x-2">
                    <Checkbox
                        id="useFastModel"
                        checked={useFastModel}
                        onCheckedChange={(checked) => setUseFastModel(checked === true)}
                    />
                    <div className="grid gap-1.5 leading-none">
                        <Label
                            htmlFor="useFastModel"
                            className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
                        >
                            Use non-reasoning model for operations
                        </Label>
                        <p className="text-xs text-muted-foreground">
                            Uses faster models (e.g., deepseek-chat) for quick plan modifications instead of reasoning models. Recommended for faster response times.
                        </p>
                    </div>
                </div>

                <div className="flex justify-end">
                    <Button onClick={handleSave} disabled={saving}>
                        {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                        Save Changes
                    </Button>
                </div>
            </CardContent>
        </Card>
    )
}
