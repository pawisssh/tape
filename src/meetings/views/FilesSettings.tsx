import { useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Separator } from "@/components/ui/separator"
import { toast } from "@/components/ui/toast"
import { getSync, setSync } from "@/lib/chrome-storage"
// Framework-free logic modules, imported directly — never duplicated into src/.
import { getSaveFolder, setSaveFolder, clearSaveFolder } from "../../../extension/background-script/save-folder.js"
import { DEFAULT_FILENAME_TEMPLATE, buildFilename, resolveFilenameTemplate } from "../../../extension/obsidian/markdown.js"

const EXAMPLE_MEETING: Meeting = {
    meetingTitle: "Weekly meeting",
    meetingStartTimestamp: new Date(2026, 10, 25, 14, 30).toISOString(),
    meetingEndTimestamp: new Date(2026, 10, 25, 15, 0).toISOString(),
    meetingSoftware: "Google Meet",
    transcript: [],
    chatMessages: [],
    webhookPostStatus: "new",
}

export default function FilesSettings() {
    const [folder, setFolder] = useState<any>()
    const [folderGranted, setFolderGranted] = useState(true)
    // null until loaded, so a save can't overwrite the stored template with the default.
    const [template, setTemplate] = useState<string | null>(null)

    useEffect(() => {
        getSync<ResultSync>(["obsidianFileNameTemplate"]).then((result) => {
            setTemplate(resolveFilenameTemplate(result.obsidianFileNameTemplate))
        })
        getSaveFolder()
            .then(async (handle) => {
                if (!handle) return
                setFolder(handle)
                setFolderGranted((await handle.queryPermission({ mode: "readwrite" })) === "granted")
            })
            .catch((error) => console.error("Could not read the save folder:", error))
    }, [])

    async function chooseFolder() {
        try {
            const handle = await (window as any).showDirectoryPicker({ id: "tape-save-folder", mode: "readwrite" })
            await setSaveFolder(handle)
            setFolder(handle)
            setFolderGranted(true)
        } catch (error) {
            if ((error as DOMException).name === "AbortError") return
            console.error(error)
            toast.add({ title: "Could not use that folder", type: "error" })
        }
    }

    async function regrantFolder() {
        try {
            setFolderGranted((await folder.requestPermission({ mode: "readwrite" })) === "granted")
        } catch (error) {
            console.error(error)
            toast.add({ title: "Could not access that folder", description: "Choose it again.", type: "error" })
        }
    }

    async function resetFolder() {
        try {
            await clearSaveFolder()
            setFolder(undefined)
        } catch (error) {
            console.error(error)
            toast.add({ title: "Could not reset the folder", type: "error" })
        }
    }

    function saveTemplate() {
        if (template === null) return
        const next = template.trim() || DEFAULT_FILENAME_TEMPLATE
        setTemplate(next)
        setSync({ obsidianFileNameTemplate: next })
    }

    return (
        <div>
            <p className="font-bold text-meetings-ink">Save location</p>
            <p className="mt-1 text-sm break-all text-meetings-ink-muted">{folder ? folder.name : "Downloads/Tape"}</p>
            {folder && !folderGranted ? (
                <p className="mt-1 text-sm text-destructive">
                    Chrome needs your permission for this folder again. Files go to Downloads/Tape until then.
                </p>
            ) : null}
            <div className="mt-3 flex flex-wrap gap-2">
                <Button type="button" variant="outline" size="sm" className="rounded-none" onClick={chooseFolder}>
                    Choose…
                </Button>
                {folder && !folderGranted ? (
                    <Button type="button" variant="outline" size="sm" className="rounded-none" onClick={regrantFolder}>
                        Allow access
                    </Button>
                ) : null}
                {folder ? (
                    <Button type="button" variant="ghost" size="sm" className="rounded-none" onClick={resetFolder}>
                        Use Downloads/Tape
                    </Button>
                ) : null}
            </div>
            <p className="mt-2 text-xs text-meetings-ink-muted">
                Applies to .txt transcripts. Choose "Allow on every visit" if Chrome asks, so saving keeps working after a
                restart. Obsidian notes go to the vault folder set in Integrations.
            </p>

            <Separator className="my-4" />

            <Label htmlFor="filename-template">Filename template</Label>
            <Input
                id="filename-template"
                className="mt-2 rounded-none"
                placeholder={DEFAULT_FILENAME_TEMPLATE}
                value={template ?? ""}
                disabled={template === null}
                onChange={(e) => setTemplate(e.target.value)}
                onBlur={saveTemplate}
            />
            <p className="mt-1 text-xs break-all text-meetings-ink-muted">
                Example: {buildFilename(template?.trim() || DEFAULT_FILENAME_TEMPLATE, EXAMPLE_MEETING, { extension: ".txt" })}
            </p>
            <p className="mt-1 text-xs text-meetings-ink-muted">
                Used for .txt transcripts and Obsidian notes. Tokens: {"{{date}} {{time}} {{title}} {{platform}}"}. A quoted
                token such as {'{{"a concise title"}}'} uses the AI title, or the meeting's own title when there is none.
                Filters work too, e.g. {'{{"a concise title"|kebab}}'}.
            </p>
        </div>
    )
}
