/**
 * One-time setup for the shared public demo account.
 *
 * Creates (or re-uses) a confirmed auth user from DEMO_EMAIL / DEMO_PASSWORD and
 * ensures a matching athlete row flagged is_demo=true, approved, and profile-
 * complete so it bypasses the onboarding redirects in proxy.ts. Idempotent:
 * re-running resets the password and re-applies the athlete fields.
 *
 * Run: npx tsx scripts/setup-demo-account.ts
 * (tsx, not ts-node — this repo's TS scripts use tsx; ts-node's ESM loader
 * fails with ERR_UNKNOWN_FILE_EXTENSION here.)
 *
 * Requires in .env.local:
 *   NEXT_PUBLIC_SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *   DEMO_EMAIL
 *   DEMO_PASSWORD
 *
 * After it prints the demo user id, add it to .env.local as DEMO_USER_ID so the
 * server-side guards (lib/demo/demo.ts) recognise the account.
 *
 * PREREQUISITE: apply migration 20260702000000_add_demo_account.sql first, or the
 * is_demo write below fails on an unknown column.
 */

import * as fsSync from 'fs'
import * as path from 'path'
import { createClient, type SupabaseClient, type User } from '@supabase/supabase-js'

// Load environment variables from .env.local manually (no dotenv dependency),
// matching scripts/seed-templates.ts.
const envPath = path.resolve(process.cwd(), '.env.local')
if (fsSync.existsSync(envPath)) {
  const envContent = fsSync.readFileSync(envPath, 'utf8')
  envContent.split('\n').forEach(line => {
    const firstEquals = line.indexOf('=')
    if (firstEquals !== -1) {
      const key = line.substring(0, firstEquals).trim()
      let value = line.substring(firstEquals + 1).trim()
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1)
      }
      if (key) process.env[key] = value
    }
  })
}

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
const DEMO_EMAIL = process.env.DEMO_EMAIL
const DEMO_PASSWORD = process.env.DEMO_PASSWORD

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error('Missing required env vars: NEXT_PUBLIC_SUPABASE_URL and/or SUPABASE_SERVICE_ROLE_KEY')
  process.exit(1)
}
if (!DEMO_EMAIL || !DEMO_PASSWORD) {
  console.error('Missing required env vars: DEMO_EMAIL and/or DEMO_PASSWORD')
  process.exit(1)
}

const supabase: SupabaseClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
})

/**
 * Find an existing auth user by email. The admin API has no getUserByEmail, so
 * page through listUsers(). Returns null if not found.
 */
async function findUserByEmail(email: string): Promise<User | null> {
  const target = email.toLowerCase()
  const perPage = 200
  for (let page = 1; ; page++) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage })
    if (error) throw error
    const match = data.users.find(u => u.email?.toLowerCase() === target)
    if (match) return match
    if (data.users.length < perPage) return null
  }
}

async function main() {
  const email = DEMO_EMAIL!
  const password = DEMO_PASSWORD!

  // 1. Create or re-use the confirmed auth user.
  let user: User
  const { data: created, error: createError } = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  })

  if (createError) {
    // Most likely already registered — look it up and reset its password so the
    // script is safely re-runnable.
    const existing = await findUserByEmail(email)
    if (!existing) {
      console.error('Failed to create demo auth user and none exists to re-use:', createError.message)
      process.exit(1)
    }
    const { data: updated, error: updateError } = await supabase.auth.admin.updateUserById(existing.id, {
      password,
      email_confirm: true,
    })
    if (updateError) {
      console.error('Found existing demo user but failed to reset password:', updateError.message)
      process.exit(1)
    }
    user = updated.user
    console.log(`Re-using existing demo auth user ${user.id} (password reset).`)
  } else {
    user = created.user
    console.log(`Created demo auth user ${user.id}.`)
  }

  // 2. Upsert the athlete row keyed by the auth user id (every creation path
  //    inserts id = userId; see lib/supabase/ensure-athlete.ts). Set the fields
  //    that make the account a ready-to-use, restriction-eligible demo.
  const { error: athleteError } = await supabase
    .from('athletes')
    .upsert(
      {
        id: user.id,
        email,
        name: 'Demo Runner',
        first_name: 'Demo',
        last_name: 'Runner',
        is_demo: true,
        is_admin: false,
        account_status: 'approved',
        profile_completed: true,
      },
      { onConflict: 'id' }
    )

  if (athleteError) {
    console.error('Failed to upsert demo athlete row:', athleteError.message)
    process.exit(1)
  }

  console.log('Demo athlete row ready (is_demo=true, approved, profile complete).')
  console.log('')
  console.log('NEXT STEP — add this to .env.local so the server-side guards recognise the demo account:')
  console.log(`  DEMO_USER_ID=${user.id}`)
}

main().catch(err => {
  console.error('setup-demo-account failed:', err)
  process.exit(1)
})
