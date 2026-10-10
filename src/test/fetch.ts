export function jsonResponse (body: unknown): Response {
    return new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'content-type': 'application/json' },
    })
}

export function requestBody (fetchMock: jest.MockedFunction<typeof fetch>, callIndex = 0): Record<string, unknown> {
    return JSON.parse(fetchMock.mock.calls[callIndex]?.[1]?.body as string) as Record<string, unknown>
}
