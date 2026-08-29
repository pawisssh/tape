// Best-effort fetch of the models available on an OpenAI-compatible server — local (LM
// Studio, Ollama) or cloud (OpenAI and most other OpenAI-compatible providers) — all
// expose GET {baseUrl}/models in this shape. Used to populate the Integrations page's
// model list. Returns `null` on any failure whatsoever (unreachable server, missing host
// permission, timeout, malformed response, empty list) — callers should treat that as
// "this provider currently has no models to show," never as a hard error.
const FETCH_MODELS_TIMEOUT_MS = 5000

export async function fetchAvailableModels(baseUrl: string, apiKey?: string): Promise<string[] | null> {
    const controller = new AbortController()
    const timeoutHandle = setTimeout(() => controller.abort(), FETCH_MODELS_TIMEOUT_MS)
    try {
        const response = await fetch(`${baseUrl}/models`, {
            headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : undefined,
            signal: controller.signal,
        })
        if (!response.ok) {
            return null
        }
        const body: unknown = await response.json()
        const data = body && typeof body === "object" && Array.isArray((body as { data?: unknown }).data)
            ? (body as { data: unknown[] }).data
            : []
        const ids = data
            .map((entry) => (entry && typeof entry === "object" ? (entry as { id?: unknown }).id : undefined))
            .filter((id): id is string => typeof id === "string" && id.length > 0)
        return ids.length > 0 ? ids : null
    } catch {
        return null
    } finally {
        clearTimeout(timeoutHandle)
    }
}
