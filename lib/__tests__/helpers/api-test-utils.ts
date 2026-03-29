/**
 * Helpers for testing Next.js App Router API route handlers.
 * Constructs plain Request objects so handlers can be imported and called directly.
 */

export function createMockRequest(
  url: string,
  options?: {
    method?: string
    body?: unknown
    headers?: Record<string, string>
  }
): Request {
  const { method = 'GET', body, headers = {} } = options || {}

  return new Request(new URL(url, 'http://localhost:3000'), {
    method,
    headers: new Headers({
      'Content-Type': 'application/json',
      ...headers,
    }),
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
}

/**
 * Create a mock Supabase server client with controllable auth + from().
 */
export function makeMockSupabase(
  user: { id: string; email?: string } | null,
  fromFactory?: (table: string) => any
) {
  const defaultFrom = () => {
    const mock: any = {
      select: () => mock,
      eq: () => mock,
      neq: () => mock,
      lte: () => mock,
      gte: () => mock,
      lt: () => mock,
      gt: () => mock,
      is: () => mock,
      in: () => mock,
      order: () => mock,
      limit: () => mock,
      update: () => mock,
      insert: () => mock,
      delete: () => mock,
      single: () => Promise.resolve({ data: null, error: null }),
    }
    mock.then = (onfulfilled: any) => Promise.resolve({ data: null, error: null }).then(onfulfilled)
    return mock
  }

  return {
    auth: {
      getUser: () => Promise.resolve({
        data: { user },
        error: null,
      }),
    },
    from: fromFactory ?? (() => defaultFrom()),
  }
}
