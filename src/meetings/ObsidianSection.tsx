import { useEffect, useState } from "react"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Separator } from "@/components/ui/separator"
import { getSync, setSync } from "@/lib/chrome-storage"
import { useDebouncedEffect } from "@/hooks/use-debounced-effect"

// Kept in sync with extension/obsidian/markdown.js's DEFAULT_FILENAME_TEMPLATE — this
// component can't import that value directly without also pulling in the rest of
// markdown.js's dependency graph into the settings-form bundle for a single string
// constant, so the default is mirrored here the same way pre-Phase-5 meetings.js did.
const DEFAULT_OBSIDIAN_FILENAME_TEMPLATE = '{{date}}-{{"a concise, engaging title for this meeting"|kebab}}-meeting-note'

// Rendered directly in the Integrations page's detail panel (see IntegrationsView.tsx) —
// no Dialog/modal chrome of its own. There is no separate auto-save toggle: having a
// vault name set here is itself what turns auto-save on (see getObsidianSettings() in
// extension/obsidian/store.js). Every field autosaves (debounced) as it's edited — no
// Save button.
export default function ObsidianSection() {
    const [vaultName, setVaultName] = useState("")
    const [folder, setFolder] = useState("")
    const [fileNameTemplate, setFileNameTemplate] = useState(DEFAULT_OBSIDIAN_FILENAME_TEMPLATE)

    useEffect(() => {
        getSync<ResultSync>(["obsidianVaultName", "obsidianFolder", "obsidianFileNameTemplate"]).then((result) => {
            setVaultName(result.obsidianVaultName || "")
            setFolder(result.obsidianFolder || "")
            setFileNameTemplate(result.obsidianFileNameTemplate || DEFAULT_OBSIDIAN_FILENAME_TEMPLATE)
        })
    }, [])

    useDebouncedEffect(
        () => {
            setSync({
                obsidianVaultName: vaultName.trim(),
                obsidianFolder: folder.trim(),
                obsidianFileNameTemplate: fileNameTemplate.trim() || DEFAULT_OBSIDIAN_FILENAME_TEMPLATE,
            })
        },
        [vaultName, folder, fileNameTemplate],
        700,
    )

    return (
        <div className="flex flex-col gap-4">
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
                    Vault-relative path. Leave blank to save to the vault root. This folder must already exist in
                    your vault.
                </p>
            </div>

            <div>
                <Label htmlFor="obsidian-filename-template">Filename template</Label>
                <Input
                    type="text"
                    id="obsidian-filename-template"
                    className="mt-2"
                    placeholder={DEFAULT_OBSIDIAN_FILENAME_TEMPLATE}
                    value={fileNameTemplate}
                    onChange={(e) => setFileNameTemplate(e.target.value)}
                />
                <p className="text-muted-foreground mt-1 text-xs">
                    Available tokens: <code className="bg-foreground/10 rounded px-1">{"{{date}}"}</code>,{" "}
                    <code className="bg-foreground/10 rounded px-1">{"{{time}}"}</code>,{" "}
                    <code className="bg-foreground/10 rounded px-1">{"{{title}}"}</code>,{" "}
                    <code className="bg-foreground/10 rounded px-1">{"{{platform}}"}</code>. Example:{" "}
                    <code className="bg-foreground/10 rounded px-1">{"{{date}} {{time}} {{title}} {{platform}}"}</code>.
                </p>
                <p className="text-muted-foreground mt-1 text-xs">
                    You can also use a quoted token, e.g.{" "}
                    <code className="bg-foreground/10 rounded px-1">{'{{"a concise title"}}'}</code>, to use the
                    meeting's AI-generated title (from its summary) instead of the raw meeting title — falls back to
                    the meeting's own title when LLM summarization is off. A token (bare or quoted) can be piped
                    through filters too, e.g.{" "}
                    <code className="bg-foreground/10 rounded px-1">{'{{"a concise title"|kebab}}'}</code> to
                    lowercase-and-hyphenate it. Default:{" "}
                    <code className="bg-foreground/10 rounded px-1">{DEFAULT_OBSIDIAN_FILENAME_TEMPLATE}</code>.
                </p>
            </div>

            <Separator />

            <p className="text-muted-foreground text-sm">
                Transcripts save to Obsidian automatically after each meeting once a vault name is set above — no
                separate toggle needed.
            </p>
        </div>
    )
}
