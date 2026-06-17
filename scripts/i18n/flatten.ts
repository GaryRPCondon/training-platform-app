/**
 * Nested message catalog <-> flat dotted-key map.
 *
 * next-intl authors catalogs as nested namespaces ({ settings: { title: '…' } }),
 * but the XLIFF converter and the pseudo generator both work in terms of flat
 * keys ("settings.title"). These helpers bridge the two shapes. Plain object
 * recursion — no regex, build-time only (never imported by runtime code).
 */

export type NestedMessages = { [key: string]: string | NestedMessages }

/** { settings: { title: 'Hi' } } -> { 'settings.title': 'Hi' } */
export function flatten(messages: NestedMessages, prefix = ''): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(messages)) {
    const path = prefix ? `${prefix}.${key}` : key
    if (typeof value === 'string') {
      out[path] = value
    } else {
      Object.assign(out, flatten(value, path))
    }
  }
  return out
}

/** { 'settings.title': 'Hi' } -> { settings: { title: 'Hi' } } */
export function unflatten(flat: Record<string, string>): NestedMessages {
  const root: NestedMessages = {}
  for (const [path, value] of Object.entries(flat)) {
    const parts = path.split('.')
    let node = root
    for (let i = 0; i < parts.length - 1; i++) {
      const part = parts[i]
      if (typeof node[part] !== 'object' || node[part] === null) {
        node[part] = {}
      }
      node = node[part] as NestedMessages
    }
    node[parts[parts.length - 1]] = value
  }
  return root
}
