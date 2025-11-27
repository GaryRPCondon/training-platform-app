export function prepareContext(context: any, provider: string): string {
    // Simple JSON stringify for now, but could be optimized for token limits
    // based on the provider

    const contextString = JSON.stringify(context, null, 2)

    // Basic truncation if too long (very rough estimate)
    const maxLength = 20000 // characters

    if (contextString.length > maxLength) {
        return contextString.substring(0, maxLength) + '... (truncated)'
    }

    return contextString
}
