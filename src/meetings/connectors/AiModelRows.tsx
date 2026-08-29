import { useEffect, useState } from "react"
import { Switch } from "@/components/ui/switch"
import { fetchAvailableModels } from "@/lib/fetch-models"

interface AiModelRowsProps {
    provider: LlmProviderConfig
    activeModel: ObsidianLlmActiveModel | null
    onActiveModelChanged: (activeModel: ObsidianLlmActiveModel | null) => void
}

// Rendered directly in Integrations' content column (see IntegrationsView.tsx), nested
// under the "Local/Custom endpoints" row — no Card/heading of its own, styled like the
// Platforms section's plain toggle rows rather than a boxed list. Replaces the old
// ModelsCard.tsx, which lived in the detail column; a single provider only now, since
// this slot never holds more than one.
export default function AiModelRows({ provider, activeModel, onActiveModelChanged }: AiModelRowsProps) {
    const [models, setModels] = useState<string[]>([])
    const [isFetching, setIsFetching] = useState(false)

    useEffect(() => {
        setIsFetching(true)
        fetchAvailableModels(provider.baseUrl, provider.apiKey).then((ids) => {
            setIsFetching(false)
            setModels(ids || [])
        })
    }, [provider.baseUrl, provider.apiKey])

    if (isFetching && models.length === 0) {
        return <p className="py-2 pr-[13px] pl-11 text-xs text-black/60">Checking models…</p>
    }

    if (models.length === 0) {
        return (
            <p className="py-2 pr-[13px] pl-11 text-xs text-black/60">
                Couldn't reach the provider — check the base URL/API key.
            </p>
        )
    }

    return (
        <>
            {models.map((modelId) => {
                const isActive = activeModel?.providerId === provider.id && activeModel?.modelId === modelId
                return (
                    <div key={modelId} className="flex h-16 items-center gap-3 pr-4 pl-11">
                        <span className="min-w-0 flex-1 truncate text-sm font-medium text-black/87">{modelId}</span>
                        <Switch
                            checked={isActive}
                            onCheckedChange={(checked) =>
                                onActiveModelChanged(checked ? { providerId: provider.id, modelId } : null)
                            }
                        />
                    </div>
                )
            })}
        </>
    )
}
