import LlmSection from "../LlmSection"

export default function ConnectorsView() {
    return (
        <div>
            <div className="mb-6">
                <h1 className="text-2xl font-bold">Connectors</h1>
                <p className="text-muted-foreground mt-1 text-sm">
                    AI providers that can enrich your meeting notes.
                </p>
            </div>

            <LlmSection />
        </div>
    )
}
