import MeetingsSection from "./MeetingsSection"
import ObsidianSection from "./ObsidianSection"
import LlmSection from "./LlmSection"
import WebhookSection from "./WebhookSection"

export default function App() {
    return (
        <div className="mx-auto max-w-[1440px] px-8 py-6 sm:px-12">
            <h1 className="mb-6 text-3xl font-bold">TranscripTonic</h1>
            <MeetingsSection />
            <ObsidianSection />
            <LlmSection />
            <WebhookSection />
        </div>
    )
}
