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
 * Feature secrets recommended for production deployments but optional in local
 * dev. Missing values degrade the dependent feature safely (admin-approval / cron
 * routes fail closed; rate limiting fails open) rather than crashing startup, so
 * we warn instead of throwing.
 *
 * UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN back inbound API rate
 * limiting (lib/rate-limit/limiter.ts). Without them the limiter is a no-op.
 */
const PRODUCTION_SECRETS = [
  'CRON_SECRET',
  'ADMIN_APPROVAL_SECRET',
  'UPSTASH_REDIS_REST_URL',
  'UPSTASH_REDIS_REST_TOKEN',
] as const

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
        `Dependent features degrade until configured (admin-approval / cron routes reject ` +
        `requests; API rate limiting is disabled).`
      )
    }
  }

  return result.data
}
