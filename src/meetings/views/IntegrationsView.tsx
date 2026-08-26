import ObsidianSection from "../ObsidianSection"
import WebhookSection from "../WebhookSection"

export default function IntegrationsView() {
    return (
        <div>
            <div className="mb-6">
                <h1 className="text-2xl font-bold">Integrations</h1>
                <p className="text-muted-foreground mt-1 text-sm">
                    Send your meetings to the tools you already use.
                </p>
            </div>

            <div className="mb-4">
                <ObsidianSection />
            </div>
            <WebhookSection />
        </div>
    )
}
