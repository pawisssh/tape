import { useEffect, useState } from "react"
import { BookOpen } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardAction } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { getSync, setSync } from "@/lib/chrome-storage"

// Kept in sync with extension/obsidian/markdown.js's DEFAULT_FILENAME_TEMPLATE — this
// component can't import that value directly without also pulling in the rest of
// markdown.js's dependency graph into the settings-form bundle for a single string
// constant, so the default is mirrored here the same way pre-Phase-5 meetings.js did.
const DEFAULT_OBSIDIAN_FILENAME_TEMPLATE = "{{date}} - {{title}}"

export default function ObsidianSection() {
    const [vaultName, setVaultName] = useState("")
    const [folder, setFolder] = useState("")
    const [fileNameTemplate, setFileNameTemplate] = useState(DEFAULT_OBSIDIAN_FILENAME_TEMPLATE)
    const [autoSave, setAutoSave] = useState(false)

    useEffect(() => {
        getSync<ResultSync>([
            "obsidianVaultName",
            "obsidianFolder",
            "obsidianFileNameTemplate",
            "autoSaveToObsidianAfterMeeting",
        ]).then((result) => {
            setVaultName(result.obsidianVaultName || "")
            setFolder(result.obsidianFolder || "")
            setFileNameTemplate(result.obsidianFileNameTemplate || DEFAULT_OBSIDIAN_FILENAME_TEMPLATE)
            setAutoSave(result.autoSaveToObsidianAfterMeeting === true)
        })
    }, [])

    function handleSubmit(e: React.FormEvent) {
        e.preventDefault()
        setSync({
            obsidianVaultName: vaultName.trim(),
            obsidianFolder: folder.trim(),
            obsidianFileNameTemplate: fileNameTemplate.trim() || DEFAULT_OBSIDIAN_FILENAME_TEMPLATE,
        }).then(() => alert("Obsidian settings saved!"))
    }

    function handleAutoSaveChange(checked: boolean) {
        if (checked && !vaultName.trim()) {
            alert("Please enter and save a vault name before enabling auto-save.")
            return
        }
        setAutoSave(checked)
        setSync({ autoSaveToObsidianAfterMeeting: checked })
    }

    return (
        <Card>
            <CardHeader>
                <div className="flex items-center gap-2">
                    <BookOpen className="text-muted-foreground size-5" />
                    <CardTitle>Obsidian</CardTitle>
                </div>
                <CardDescription>
                    Hand transcripts off to Obsidian as a new note. The vault name must exactly match the name shown
                    in Obsidian's vault switcher, and the destination folder must already exist in that vault.
                </CardDescription>
                <CardAction>
                    <Badge variant={vaultName ? "default" : "outline"}>
                        {vaultName ? "Configured" : "Not configured"}
                    </Badge>
                </CardAction>
            </CardHeader>
            <CardContent>
                <form onSubmit={handleSubmit} className="flex flex-col gap-6">
                        <div>
                            <Label htmlFor="obsidian-vault-name">Vault name</Label>
                            <Input
                                type="text"
                                id="obsidian-vault-name"
                                className="mt-2"
                                placeholder="My vault"
                                value={vaultName}
                                onChange={(e) => setVaultName(e.target.value)}
                            />
                            <p className="text-muted-foreground mt-1 text-xs">
                                Must exactly match the vault name in Obsidian's vault switcher (case-sensitive).
                            </p>
                        </div>

                        <div>
                            <Label htmlFor="obsidian-folder">Folder (optional)</Label>
                            <Input
                                type="text"
                                id="obsidian-folder"
                                className="mt-2"
                                placeholder="Meetings/TranscripTonic"
                                value={folder}
                                onChange={(e) => setFolder(e.target.value)}
                            />
                            <p className="text-muted-foreground mt-1 text-xs">
                                Vault-relative path. Leave blank to save to the vault root. This folder must already
                                exist in your vault.
                            </p>
                        </div>

                        <div>
                            <Label htmlFor="obsidian-filename-template">Filename template</Label>
                            <Input
                                type="text"
                                id="obsidian-filename-template"
                                className="mt-2"
                                placeholder="{{date}} - {{title}}"
                                value={fileNameTemplate}
                                onChange={(e) => setFileNameTemplate(e.target.value)}
                            />
                            <p className="text-muted-foreground mt-1 text-xs">
                                Available tokens: <code className="bg-foreground/10 rounded px-1">{"{{date}}"}</code>,{" "}
                                <code className="bg-foreground/10 rounded px-1">{"{{time}}"}</code>,{" "}
                                <code className="bg-foreground/10 rounded px-1">{"{{title}}"}</code>,{" "}
                                <code className="bg-foreground/10 rounded px-1">{"{{software}}"}</code>. Example:{" "}
                                <code className="bg-foreground/10 rounded px-1">{"{{date}} {{time}} {{title}} {{software}}"}</code>.
                            </p>
                        </div>

                        <div>
                            <Button type="submit">Save</Button>
                        </div>

                        <hr />

                        <div className="flex items-center gap-2">
                            <Checkbox id="auto-save-obsidian" checked={autoSave} onCheckedChange={(v) => handleAutoSaveChange(v === true)} />
                            <Label htmlFor="auto-save-obsidian">Automatically save transcript to Obsidian, after each meeting</Label>
                        </div>
                    </form>
                </CardContent>
        </Card>
    )
}
