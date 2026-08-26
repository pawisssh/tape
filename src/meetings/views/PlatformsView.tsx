import { useEffect, useState } from "react"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import { Label } from "@/components/ui/label"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { getSync, setSync } from "@/lib/chrome-storage"
import { usePlatformToggle } from "@/lib/use-platform-toggle"

function PlatformCard({
    title,
    beta,
    checked,
    pending,
    onToggle,
}: {
    title: string
    beta?: boolean
    checked: boolean
    pending: boolean
    onToggle: (next: boolean) => void
}) {
    const id = `platform-${title.toLowerCase().replace(/\s+/g, "-")}`
    return (
        <Card>
            <CardContent className="flex items-center justify-between gap-3">
                <Label htmlFor={id} className="font-bold">
                    {title}
                    {beta ? <span className="text-muted-foreground ml-1.5 font-normal">(beta)</span> : null}
                </Label>
                <Checkbox id={id} checked={checked} disabled={pending} onCheckedChange={(v) => onToggle(v === true)} />
            </CardContent>
        </Card>
    )
}

export default function PlatformsView() {
    const googleMeet = usePlatformToggle("google_meet")
    const teams = usePlatformToggle("teams")
    const zoom = usePlatformToggle("zoom")

    const [operationMode, setOperationMode] = useState<"auto" | "manual">("auto")
    const [hideCaptions, setHideCaptions] = useState(false)

    useEffect(() => {
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

    return (
        <div>
            <div className="mb-6">
                <h1 className="text-2xl font-bold">Platforms</h1>
                <p className="text-muted-foreground mt-1 text-sm">
                    Choose which video call platforms to capture transcripts on, and how.
                </p>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <PlatformCard title="Google Meet" checked={googleMeet.checked} pending={googleMeet.pending} onToggle={googleMeet.toggle} />
                <PlatformCard title="Teams" beta checked={teams.checked} pending={teams.pending} onToggle={teams.toggle} />
                <PlatformCard title="Zoom" beta checked={zoom.checked} pending={zoom.pending} onToggle={zoom.toggle} />
            </div>

            <Card className="mt-6">
                <CardHeader>
                    <CardTitle>Capture mode</CardTitle>
                    <CardDescription>How TranscripTonic decides when to start capturing a transcript.</CardDescription>
                </CardHeader>
                <CardContent>
                    <RadioGroup value={operationMode} onValueChange={handleOperationModeChange} className="gap-3">
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
                </CardContent>
            </Card>
        </div>
    )
}
