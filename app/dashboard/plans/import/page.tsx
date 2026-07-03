'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { ImportWizard } from '@/components/plans/import/import-wizard'
import { useTranslations } from 'next-intl'
import { DemoNotice } from '@/components/demo/demo-notice'

export default function PlanImportPage() {
  const router = useRouter()
  const t = useTranslations('planImport')
  const td = useTranslations('demo')
  const [resetKey, setResetKey] = useState(0)

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold tracking-tight">{t('pageTitle')}</h1>
      </div>
      <DemoNotice message={td('noticeImport')} />
      <ImportWizard
        key={resetKey}
        onCancel={() => router.push('/dashboard/plans')}
        onImported={() => router.push('/dashboard/plans/imported')}
        onStartOver={() => setResetKey(k => k + 1)}
      />
    </div>
  )
}
