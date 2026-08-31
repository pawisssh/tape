import { useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Label } from "@/components/ui/label"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { getSync, setSync, onStorageChanged } from "@/lib/chrome-storage"
import { usePlatformToggle } from "@/lib/use-platform-toggle"
import iconUrl from "../../extension/icon.png"
import googleDocsIcon from "../../extension/icons/google-docs.svg"
import notionIcon from "../../extension/icons/notion.svg"

export default function App() {
    const googleMeet = usePlatformToggle("google_meet")
    const teams = usePlatformToggle("teams")
    const zoom = usePlatformToggle("zoom")

    const [operationMode, setOperationMode] = useState<OperationMode>("auto")
    const [hideCaptions, setHideCaptions] = useState(false)
    const [version, setVersion] = useState("")

    useEffect(() => {
        setVersion(chrome.runtime.getManifest().version)
        getSync<ResultSync>(["operationMode", "hideCaptions"]).then((result) => {
            setOperationMode(result.operationMode === "manual" ? "manual" : result.operationMode === "off" ? "off" : "auto")
            setHideCaptions(result.hideCaptions === true)
        })
    }, [])

    // Keeps this popup's "Capture mode" radio group in sync when operationMode is changed
    // elsewhere while the popup happens to be open — e.g. the Meetings page sidebar's
    // compact 3-way toggle (src/meetings/App.tsx), which writes operationMode directly.
    useEffect(() => {
        return onStorageChanged((changes, area) => {
            if (area !== "sync" || !changes.operationMode) return
            const next = changes.operationMode.newValue
            setOperationMode(next === "manual" ? "manual" : next === "off" ? "off" : "auto")
        })
    }, [])

    function handleOperationModeChange(value: string) {
        const mode: OperationMode = value === "manual" ? "manual" : value === "off" ? "off" : "auto"
        setOperationMode(mode)
        setSync({ operationMode: mode })
    }

    function handleHideCaptionsChange(checked: boolean) {
        setHideCaptions(checked)
        setSync({ hideCaptions: checked })
    }

    function openMeetingsPage(hash?: string) {
        const url = chrome.runtime.getURL("meetings.html") + (hash ? `#${hash}` : "")
        chrome.tabs.create({ url })
    }

    return (
        <div className="meetings-redesign meetings-page-body w-[560px] p-6 text-sm">
            <div className="mb-5 flex items-center gap-3">
                <img className="size-10 rounded-xl" src={iconUrl} alt="" />
                <div>
                    <h1 className="font-meetings-heading text-lg text-meetings-ink">TranscripTonic</h1>
                    <p className="text-meetings-ink-muted">Simple Google Meet transcripts. Private and open source.</p>
                </div>
            </div>

            <div className="mb-4 rounded-2xl bg-meetings-card ring-1 ring-foreground/10">
              <div className="flex gap-8 p-4">
                    <div className="flex items-center gap-2">
                        <Checkbox
                            id="enable-google-meet"
                            checked={googleMeet.checked}
                            disabled={googleMeet.pending}
                            onCheckedChange={(v) => googleMeet.toggle(v === true)}
                        />
                        <Label htmlFor="enable-google-meet" className="font-bold text-meetings-ink">
                            Google Meet
                        </Label>
                    </div>
                    <div className="flex items-center gap-2">
                        <Checkbox
                            id="enable-teams"
                            checked={teams.checked}
                            disabled={teams.pending}
                            onCheckedChange={(v) => teams.toggle(v === true)}
                        />
                        <Label htmlFor="enable-teams" className="font-bold text-meetings-ink">
                            Teams (beta)
                        </Label>
                    </div>
                    <div className="flex items-center gap-2">
                        <Checkbox
                            id="enable-zoom"
                            checked={zoom.checked}
                            disabled={zoom.pending}
                            onCheckedChange={(v) => zoom.toggle(v === true)}
                        />
                        <Label htmlFor="enable-zoom" className="font-bold text-meetings-ink">
                            Zoom (beta)
                        </Label>
                    </div>
              </div>

              <hr className="border-meetings-border" />

              <div className="p-4">
                <RadioGroup value={operationMode} onValueChange={handleOperationModeChange} className="mb-4 gap-3">
                    <div className="flex items-start gap-2">
                        <RadioGroupItem value="auto" id="auto-mode" className="mt-0.5" />
                        <Label htmlFor="auto-mode" className="flex-col items-start font-normal">
                            <span className="font-bold text-meetings-ink">Auto mode</span>
                            <span className="text-meetings-ink-muted">Get transcripts of all meetings</span>
                        </Label>
                    </div>
                    <div className="flex items-start gap-2">
                        <RadioGroupItem value="manual" id="manual-mode" className="mt-0.5" />
                        <Label htmlFor="manual-mode" className="flex-col items-start font-normal">
                            <span className="font-bold text-meetings-ink">Manual mode</span>
                            <span className="text-meetings-ink-muted">
                                Switch on transcript when needed during the meeting
                            </span>
                        </Label>
                    </div>
                    <div className="flex items-start gap-2">
                        <RadioGroupItem value="off" id="off-mode" className="mt-0.5" />
                        <Label htmlFor="off-mode" className="flex-col items-start font-normal">
                            <span className="font-bold text-meetings-ink">Off</span>
                            <span className="text-meetings-ink-muted">Don't capture any meetings</span>
                        </Label>
                    </div>
                </RadioGroup>

                <hr className="my-4 border-meetings-border" />

                <div className="flex items-center gap-2">
                    <Checkbox
                        id="hide-captions"
                        checked={hideCaptions}
                        onCheckedChange={(v) => handleHideCaptionsChange(v === true)}
                    />
                    <Label htmlFor="hide-captions" className="font-bold text-meetings-ink">
                        Hide captions on the meeting UI
                    </Label>
                </div>
              </div>
            </div>

            <div className="mb-4 flex items-center gap-4 rounded-2xl bg-meetings-card p-4 ring-1 ring-foreground/10">
                <div className="flex items-center gap-1">
                    <img className="h-6 w-auto" src={googleDocsIcon} alt="Google Docs logo" />
                    <img className="h-6 w-auto" src={notionIcon} alt="Notion logo" />
                </div>
                <p className="text-meetings-ink">
                    You can integrate TranscripTonic with your favourite tools like{" "}
                    <b>Google Docs, Notion, n8n and more</b> using{" "}
                    <button
                        type="button"
                        className="font-bold text-meetings-ink underline underline-offset-4"
                        onClick={() => openMeetingsPage("integrations")}
                    >
                        integrations &rarr;
                    </button>
                </p>
            </div>

            <div className="mb-4 flex items-center justify-between gap-6">
                <Button type="button" variant="outline" size="sm" onClick={() => openMeetingsPage()}>
                    Open meetings &rarr;
                </Button>
                <div>
                    <a
                        className="text-meetings-ink-muted underline decoration-meetings-border underline-offset-4 hover:text-meetings-ink"
                        href="https://github.com/vivek-nexus/transcriptonic#readme"
                        target="_blank"
                        rel="noreferrer"
                    >
                        Get help
                    </a>
                    <span className="mx-2">&#9679;</span>
                    <a
                        className="text-meetings-ink-muted underline decoration-meetings-border underline-offset-4 hover:text-meetings-ink"
                        href="https://github.com/vivek-nexus/transcriptonic/issues"
                        target="_blank"
                        rel="noreferrer"
                    >
                        Report a bug
                    </a>
                </div>
            </div>

            <p className="flex justify-between text-meetings-ink-muted">
                <span>
                    v{version} /{" "}
                    <a
                        className="text-meetings-ink-muted underline decoration-meetings-border underline-offset-4 hover:text-meetings-ink"
                        href="https://github.com/vivek-nexus/transcriptonic?tab=readme-ov-file#notice"
                        target="_blank"
                        rel="noreferrer"
                    >
                        Notice
                    </a>
                </span>
                <span>
                    Another project by{" "}
                    <a
                        className="text-meetings-ink-muted underline decoration-meetings-border underline-offset-4 hover:text-meetings-ink"
                        href="https://vivek-nexus.github.io"
                        target="_blank"
                        rel="noreferrer"
                    >
                        Vivek
                    </a>
                </span>
            </p>
        </div>
    )
}
