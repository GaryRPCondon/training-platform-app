'use client'

import { useEffect, useState } from 'react'
import { supabase, getCurrentAthleteId } from '@/lib/supabase/client'

export default function TestDB() {
  if (process.env.NODE_ENV === 'production') return null
  const [athlete, setAthlete] = useState<any>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    async function fetchAthlete() {
      try {
        const athleteId = getCurrentAthleteId()
        
        const { data, error } = await supabase
          .from('athletes')
          .select('*')
          .eq('id', athleteId)
          .single()
        
        if (error) {
          setError(error.message)
        } else {
          setAthlete(data)
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unknown error')
      }
    }
    fetchAthlete()
  }, [])

  return (
    <div className="p-8">
      <h1 className="text-2xl font-bold mb-4">Database Test</h1>
      {error && <p className="text-red-500">Error: {error}</p>}
      {athlete ? (
        <pre className="bg-gray-100 p-4 rounded">
          {JSON.stringify(athlete, null, 2)}
        </pre>
      ) : (
        <p>Loading...</p>
      )}
    </div>
  )
}