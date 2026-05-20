'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { ImportWizard } from '@/components/strength/import/import-wizard'

export default function StrengthImportPage() {
  const router = useRouter()
  const [resetKey, setResetKey] = useState(0)

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold tracking-tight">Import strength program</h1>
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
