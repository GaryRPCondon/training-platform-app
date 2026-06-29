'use client'

import { useState, ChangeEvent } from 'react'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { HelpCircle } from 'lucide-react'
import { useTranslations } from 'next-intl'

export interface ImportInputValues {
  text: string
  format: 'free_text' | 'json'
  name: string | null
  raceDistance: string
  raceDate: string
  startDate: string
}

const RECOMMENDED_FORMAT = `Week 1 / Monday: Rest
Week 1 / Tuesday: Easy 8 km
Week 1 / Wednesday: Intervals — 6 x 800 m @ 5K pace, 400 m jog recovery
Week 1 / Saturday: Long run 18 km easy

Week 2 / Tuesday: Tempo 6 km @ threshold
Week 2 / Saturday: Long run 20 km easy`

const RACE_DISTANCES = ['5k', '10k', 'half_marathon', 'marathon'] as const

export function StepInput({
  submitting,
  onParse,
  onCancel,
}: {
  submitting: boolean
  onParse: (values: ImportInputValues) => void
  onCancel: () => void
}) {
  const t = useTranslations('planImport')
  const [tab, setTab] = useState<'free_text' | 'file' | 'json'>('free_text')
  const [text, setText] = useState('')
  const [name, setName] = useState('')
  const [raceDistance, setRaceDistance] = useState<string>('marathon')
  const [raceDate, setRaceDate] = useState('')
  const [startDate, setStartDate] = useState(() => new Date().toISOString().slice(0, 10))

  function handleFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = ev => setText(String(ev.target?.result ?? ''))
    reader.readAsText(file)
  }

  function submit() {
    const trimmedName = name.trim()
    onParse({
      text: text.trim(),
      format: tab === 'json' ? 'json' : 'free_text',
      name: trimmedName.length > 0 ? trimmedName : null,
      raceDistance,
      raceDate,
      startDate,
    })
  }

  const canSubmit = text.trim().length > 0 && raceDate.length > 0 && startDate.length > 0 && raceDate > startDate

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-4">
          <div>
            <CardTitle>{t('inputTitle')}</CardTitle>
            <CardDescription>{t('inputDescription')}</CardDescription>
          </div>
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="ghost" size="icon" aria-label={t('showRecommendedFormat')}>
                <HelpCircle className="h-4 w-4" />
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-96">
              <div className="space-y-2">
                <p className="text-sm font-medium">{t('recommendedFormat')}</p>
                <pre className="rounded bg-muted p-3 text-xs whitespace-pre-wrap">{RECOMMENDED_FORMAT}</pre>
                <p className="text-xs text-muted-foreground">{t('formatNote')}</p>
              </div>
            </PopoverContent>
          </Popover>
        </div>
      </CardHeader>
      <CardContent>
        <div className="mb-6 max-w-md">
          <Label htmlFor="plan-name" className="text-sm font-medium">
            {t.rich('planNameLabel', { optional: (chunks) => <span className="text-xs font-normal text-muted-foreground">{chunks}</span> })}
          </Label>
          <Input
            id="plan-name"
            className="mt-2"
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder={t('planNamePlaceholder')}
            maxLength={120}
          />
        </div>

        <div className="mb-6">
          <Label className="text-sm font-medium">{t('raceLabel')}</Label>
          <p className="mt-1 mb-3 text-xs text-muted-foreground">{t('raceHelp')}</p>
          <div className="flex flex-wrap items-end gap-4">
            <div className="w-44">
              <Label htmlFor="race-distance" className="text-xs text-muted-foreground">{t('raceDistanceLabel')}</Label>
              <Select value={raceDistance} onValueChange={setRaceDistance}>
                <SelectTrigger id="race-distance" className="mt-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {RACE_DISTANCES.map(d => (
                    <SelectItem key={d} value={d}>{t(`distance_${d}`)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="w-40">
              <Label htmlFor="start-date" className="text-xs text-muted-foreground">{t('startDateLabel')}</Label>
              <Input id="start-date" type="date" value={startDate} onChange={e => setStartDate(e.target.value)} className="mt-1" />
            </div>
            <div className="w-40">
              <Label htmlFor="race-date" className="text-xs text-muted-foreground">{t('raceDateLabel')}</Label>
              <Input id="race-date" type="date" value={raceDate} onChange={e => setRaceDate(e.target.value)} className="mt-1" />
            </div>
          </div>
          {raceDate.length > 0 && startDate.length > 0 && raceDate <= startDate && (
            <p className="mt-2 text-xs text-destructive">{t('raceAfterStart')}</p>
          )}
        </div>

        <Tabs value={tab} onValueChange={v => setTab(v as typeof tab)}>
          <TabsList>
            <TabsTrigger value="free_text">{t('tabPasteText')}</TabsTrigger>
            <TabsTrigger value="file">{t('tabUploadFile')}</TabsTrigger>
            <TabsTrigger value="json">{t('tabPasteJson')}</TabsTrigger>
          </TabsList>
          <TabsContent value="free_text" className="mt-4">
            <Textarea
              placeholder={t('pastePlaceholder')}
              value={text}
              onChange={e => setText(e.target.value)}
              rows={16}
              className="font-mono text-sm"
            />
          </TabsContent>
          <TabsContent value="file" className="mt-4">
            <input type="file" accept=".txt,.md,.json,.csv" onChange={handleFile} className="block w-full text-sm" />
            {text && (
              <Textarea value={text} onChange={e => setText(e.target.value)} rows={12} className="mt-4 font-mono text-sm" />
            )}
          </TabsContent>
          <TabsContent value="json" className="mt-4">
            <Textarea
              // eslint-disable-next-line no-restricted-syntax -- JSON schema example, not translatable prose
              placeholder='{"weeks": [...]}'
              value={text}
              onChange={e => setText(e.target.value)}
              rows={16}
              className="font-mono text-sm"
            />
          </TabsContent>
        </Tabs>
      </CardContent>
      <CardFooter className="flex justify-end gap-2">
        <Button variant="outline" onClick={onCancel}>{t('cancel')}</Button>
        <Button onClick={submit} disabled={submitting || !canSubmit}>
          {submitting ? t('parsing') : t('parse')}
        </Button>
      </CardFooter>
    </Card>
  )
}
