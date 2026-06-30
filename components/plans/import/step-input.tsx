'use client'

import { useState, ChangeEvent } from 'react'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { HelpCircle } from 'lucide-react'
import { useTranslations } from 'next-intl'

export interface ImportImage {
  mimeType: string
  dataBase64: string
  fileName: string
}

export interface ImportInputValues {
  text: string
  format: 'free_text' | 'json' | 'image'
  images: ImportImage[]
  name: string | null
}

const RECOMMENDED_FORMAT = `Week 1 / Monday: Rest
Week 1 / Tuesday: Easy 8 km
Week 1 / Wednesday: Intervals — 6 x 800 m @ 5K pace, 400 m jog recovery
Week 1 / Saturday: Long run 18 km easy

Week 2 / Tuesday: Tempo 6 km @ threshold
Week 2 / Saturday: Long run 20 km easy`

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
  const [tab, setTab] = useState<'free_text' | 'file' | 'json' | 'image'>('free_text')
  const [text, setText] = useState('')
  const [images, setImages] = useState<ImportImage[]>([])
  const [name, setName] = useState('')

  function handleFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = ev => setText(String(ev.target?.result ?? ''))
    reader.readAsText(file)
  }

  function handleImages(e: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? [])
    if (files.length === 0) return
    Promise.all(
      files.map(
        file =>
          new Promise<ImportImage>((resolve, reject) => {
            const reader = new FileReader()
            reader.onload = ev => {
              const url = String(ev.target?.result ?? '')
              // data URL: "data:<mime>;base64,<data>" — split off the prefix.
              const comma = url.indexOf(',')
              resolve({ mimeType: file.type || 'image/png', dataBase64: comma >= 0 ? url.slice(comma + 1) : url, fileName: file.name })
            }
            reader.onerror = () => reject(reader.error)
            reader.readAsDataURL(file)
          }),
      ),
    ).then(loaded => setImages(prev => [...prev, ...loaded]))
  }

  function removeImage(index: number) {
    setImages(prev => prev.filter((_, i) => i !== index))
  }

  function submit() {
    const trimmedName = name.trim()
    const format = tab === 'image' ? 'image' : tab === 'json' ? 'json' : 'free_text'
    onParse({
      text: text.trim(),
      format,
      images,
      name: trimmedName.length > 0 ? trimmedName : null,
    })
  }

  const canSubmit = tab === 'image' ? images.length > 0 : text.trim().length > 0

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

        <Tabs value={tab} onValueChange={v => setTab(v as typeof tab)}>
          <TabsList>
            <TabsTrigger value="free_text">{t('tabPasteText')}</TabsTrigger>
            <TabsTrigger value="file">{t('tabUploadFile')}</TabsTrigger>
            <TabsTrigger value="json">{t('tabPasteJson')}</TabsTrigger>
            <TabsTrigger value="image">{t('tabUploadImages')}</TabsTrigger>
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
          <TabsContent value="image" className="mt-4">
            <p className="mb-2 text-sm text-muted-foreground">{t('imageHelp')}</p>
            <input type="file" accept="image/*" multiple onChange={handleImages} className="block w-full text-sm" />
            {images.length > 0 && (
              <ul className="mt-4 space-y-1.5">
                {images.map((img, i) => (
                  <li key={i} className="flex items-center justify-between rounded border px-3 py-2 text-sm">
                    <span className="truncate">{t('imagePage', { n: i + 1 })} — {img.fileName}</span>
                    <Button variant="ghost" size="sm" onClick={() => removeImage(i)}>{t('remove')}</Button>
                  </li>
                ))}
              </ul>
            )}
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
