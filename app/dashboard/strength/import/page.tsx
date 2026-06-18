'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { ImportWizard } from '@/components/strength/import/import-wizard'
import { useTranslations } from 'next-intl'

export default function StrengthImportPage() {
  const router = useRouter()
  const t = useTranslations('strength')
  const [resetKey, setResetKey] = useState(0)

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold tracking-tight">{t('importPageTitle')}</h1>
      </div>
      <ImportWizard
        key={resetKey}
        onCancel={() => router.push('/dashboard/strength')}
        onImported={() => router.push('/dashboard/strength')}
        onStartOver={() => setResetKey(k => k + 1)}
      />
    </div>
  )
}
