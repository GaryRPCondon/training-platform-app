/**
 * Restore platform-specific native binaries for BOTH Linux-x64 and Windows-x64
 * into node_modules in a single pass.
 *
 * Why: this repo is used from two environments at once — the dev server runs from
 * Windows PowerShell (needs win32 binaries) and the husky pre-commit hook + CI-style
 * checks run under WSL/Linux (needs linux binaries). A normal `npm install` only
 * materialises the *current* platform's optional binaries and prunes the other side
 * (npm/cli#4828), which breaks whichever environment didn't run the install.
 *
 * package-lock.json already records every platform's optional packages, so this
 * reads the lock and re-extracts the linux-x64 + win32-x64 ones that are missing.
 * `npm pack` only downloads a tarball (no platform check), so both sets can be
 * fetched from either OS. Idempotent: skips anything already present.
 *
 * Run after any `npm install`:  node scripts/restore-native-bindings.mjs
 */
import { readFileSync, existsSync, mkdirSync } from 'node:fs'
import { execSync } from 'node:child_process'
import { join } from 'node:path'

const TARGET_SUFFIXES = ['linux-x64-gnu', 'linux-x64-glibc', 'win32-x64-msvc', 'win32-x64']
const TMP = '/tmp/native-restore'

const lock = JSON.parse(readFileSync('package-lock.json', 'utf8'))
mkdirSync(TMP, { recursive: true })

let restored = 0
let present = 0
for (const [path, info] of Object.entries(lock.packages || {})) {
  if (!path.startsWith('node_modules/') || !info.version) continue
  const name = path.slice(path.lastIndexOf('node_modules/') + 'node_modules/'.length)
  const leaf = name.slice(name.lastIndexOf('/') + 1)
  if (!TARGET_SUFFIXES.some((s) => leaf.endsWith(s))) continue

  if (existsSync(join(path, 'package.json'))) {
    present++
    continue
  }

  mkdirSync(path, { recursive: true })
  const tgz = execSync(`npm pack ${name}@${info.version} --pack-destination ${TMP} --silent`, {
    encoding: 'utf8',
  }).trim()
  execSync(`tar -xzf ${join(TMP, tgz)} -C ${path} --strip-components=1`)
  console.log(`restored  ${name}@${info.version}`)
  restored++
}

console.log(`\nDone — restored ${restored}, already present ${present}.`)
