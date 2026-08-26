import { useEffect, useState } from "react"
import { Checkbox } from "@/components/ui/checkbox"
import { Label } from "@/components/ui/label"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { getSync, setSync } from "@/lib/chrome-storage"
import { sendMessage } from "@/lib/messaging"
import iconUrl from "../../extension/icon.png"
import googleDocsIcon from "../../extension/icons/google-docs.svg"
import notionIcon from "../../extension/icons/notion.svg"

type PlatformKey = "google_meet" | "teams" | "zoom"

const PLATFORM_STORAGE_KEY: Record<PlatformKey, "wantGoogleMeet" | "wantTeams" | "wantZoom"> = {
    google_meet: "wantGoogleMeet",
    teams: "wantTeams",
    zoom: "wantZoom",
}

function usePlatformToggle(platform: PlatformKey) {
    const [checked, setChecked] = useState(false)
    const [pending, setPending] = useState(true)

    useEffect(() => {
        let cancelled = false
        sendMessage({ type: "get_platform_enablement_status", platform }).then((response) => {
            if (cancelled) return
            setPending(false)
            if (response.success) {
                setChecked(response.message === "Enabled")
            }
        })
        return () => {
            cancelled = true
        }
    }, [platform])

    const toggle = (next: boolean) => {
        setChecked(next)
        setSync({ [PLATFORM_STORAGE_KEY[platform]]: next })
        sendMessage({ type: next ? "enable_platform" : "disable_platform", platform }).then((response) => {
            if (!response.success) {
                // Revert on failure — matches upstream's popup.js behavior.
                setChecked(!next)
                console.error(`Failed to toggle ${platform}:`, response.message)
            }
        })
    }

    return { checked, pending, toggle }
}

export default function App() {
    const googleMeet = usePlatformToggle("google_meet")
    const teams = usePlatformToggle("teams")
    const zoom = usePlatformToggle("zoom")

    const [operationMode, setOperationMode] = useState<"auto" | "manual">("auto")
    const [hideCaptions, setHideCaptions] = useState(false)
    const [version, setVersion] = useState("")

    useEffect(() => {
        setVersion(chrome.runtime.getManifest().version)
        getSync<ResultSync>(["operationMode", "hideCaptions"]).then((result) => {
            setOperationMode(result.operationMode === "manual" ? "manual" : "auto")
            setHideCaptions(result.hideCaptions === true)
        })
    }, [])

    function handleOperationModeChange(value: string) {
        const mode = value === "manual" ? "manual" : "auto"
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
        <div className="w-[560px] p-6 text-sm">
            <div className="mb-5 flex items-center justify-between">
                <div>
                    <h1 className="text-2xl font-bold">TranscripTonic</h1>
                    <p className="text-muted-foreground mt-1">
                        Simple Google Meet transcripts. Private and open source.
                    </p>
                </div>
                <img className="h-12 w-12 rounded-full" src={iconUrl} alt="Extension icon" />
            </div>

            <div className="bg-muted/40 mb-4 rounded-lg p-4">
                <div className="mb-4 flex gap-8">
                    <div className="flex items-center gap-2">
                        <Checkbox
                            id="enable-google-meet"
                            checked={googleMeet.checked}
                            disabled={googleMeet.pending}
                            onCheckedChange={(v) => googleMeet.toggle(v === true)}
                        />
                        <Label htmlFor="enable-google-meet" className="font-bold">
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
                        <Label htmlFor="enable-teams" className="font-bold">
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
                        <Label htmlFor="enable-zoom" className="font-bold">
                            Zoom (beta)
                        </Label>
                    </div>
                </div>

                <hr className="my-4" />

                <RadioGroup value={operationMode} onValueChange={handleOperationModeChange} className="mb-4 gap-3">
                    <div className="flex items-start gap-2">
                        <RadioGroupItem value="auto" id="auto-mode" className="mt-0.5" />
                        <Label htmlFor="auto-mode" className="flex-col items-start font-normal">
                            <span className="font-bold">Auto mode</span>
                            <span className="text-muted-foreground">Get transcripts of all meetings</span>
                        </Label>
                    </div>
                    <div className="flex items-start gap-2">
                        <RadioGroupItem value="manual" id="manual-mode" className="mt-0.5" />
                        <Label htmlFor="manual-mode" className="flex-col items-start font-normal">
                            <span className="font-bold">Manual mode</span>
                            <span className="text-muted-foreground">
                                Switch on transcript when needed during the meeting
                            </span>
                        </Label>
                    </div>
                </RadioGroup>

                <hr className="my-4" />

                <div className="flex items-center gap-2">
                    <Checkbox
                        id="hide-captions"
                        checked={hideCaptions}
                        onCheckedChange={(v) => handleHideCaptionsChange(v === true)}
                    />
                    <Label htmlFor="hide-captions" className="font-bold">
                        Hide captions on the meeting UI
                    </Label>
                </div>
            </div>

            <div className="bg-muted/40 mb-4 flex items-center gap-4 rounded-lg p-4">
                <div className="flex items-center gap-1">
                    <img className="h-6 w-auto" src={googleDocsIcon} alt="Google Docs logo" />
                    <img className="h-6 w-auto" src={notionIcon} alt="Notion logo" />
                </div>
                <p>
                    You can integrate TranscripTonic with your favourite tools like{" "}
                    <b>Google Docs, Notion, n8n and more</b> using{" "}
                    <button
                        type="button"
                        className="text-primary font-bold underline underline-offset-4"
                        onClick={() => openMeetingsPage("webhooks")}
                    >
                        webhooks &rarr;
                    </button>
                </p>
            </div>

            <div className="mb-4 flex items-center justify-between gap-6">
                <button
                    type="button"
                    className="text-primary font-bold underline underline-offset-4"
                    onClick={() => openMeetingsPage()}
                >
                    Last 10 meetings &rarr;
                </button>
                <div>
                    <a
                        className="text-primary font-bold underline underline-offset-4"
                        href="https://github.com/vivek-nexus/transcriptonic#readme"
                        target="_blank"
                        rel="noreferrer"
                    >
                        Get help
                    </a>
                    <span className="mx-2">&#9679;</span>
                    <a
                        className="text-primary font-bold underline underline-offset-4"
                        href="https://github.com/vivek-nexus/transcriptonic/issues"
                        target="_blank"
                        rel="noreferrer"
                    >
                        Report a bug
                    </a>
                </div>
            </div>

            <p className="text-muted-foreground flex justify-between">
                <span>
                    v{version} /{" "}
                    <a
                        className="text-primary font-bold underline underline-offset-4"
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
                        className="text-primary font-bold underline underline-offset-4"
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
