declare module 'xliff' {
  /** Resource map: resources[fileId][unitId] = { source, target? }. */
  interface XliffJs {
    sourceLanguage: string
    targetLanguage: string
    resources: Record<string, Record<string, { source: string; target?: string }>>
  }

  export function js2xliff(input: XliffJs): Promise<string>
  export function xliff2js(xml: string): Promise<XliffJs>
}
