import { z } from 'zod'

/**
 * Validates required environment variables at startup.
 * LLM provider keys are validated at point-of-use in lib/agent/factory.ts
 * since only one provider is required, not all.
 */
const envSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1),
})

/**
 * Feature secrets required for production deployments (admin approval flow +
 * cron job) but optional in local dev. Missing values fail those routes closed
 * rather than crashing startup, so we warn instead of throwing.
 */
const PRODUCTION_SECRETS = ['CRON_SECRET', 'ADMIN_APPROVAL_SECRET'] as const

export function validateEnv() {
  const result = envSchema.safeParse(process.env)
  if (!result.success) {
    const missing = result.error.issues.map(i => i.path.join('.')).join(', ')
    throw new Error(`Missing or invalid environment variables: ${missing}`)
  }

  if (process.env.NODE_ENV === 'production') {
    const missingSecrets = PRODUCTION_SECRETS.filter(name => !process.env[name])
    if (missingSecrets.length > 0) {
      console.warn(
        `[env] Production secrets not set: ${missingSecrets.join(', ')}. ` +
        `The dependent routes (admin approval / cron) will reject all requests until configured.`
      )
    }
  }

  return result.data
}
