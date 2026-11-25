import { useEffect, useState } from "react"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Separator } from "@/components/ui/separator"
import { getSync, setSync } from "@/lib/chrome-storage"
import { useDebouncedEffect } from "@/hooks/use-debounced-effect"

// Rendered directly in the Integrations page's detail panel (see IntegrationsView.tsx) —
// no Dialog/modal chrome of its own. There is no separate auto-save toggle: having a
// vault name set here is itself what turns auto-save on (see getObsidianSettings() in
// extension/obsidian/store.js). Every field autosaves (debounced) as it's edited — no
// Save button.
export default function ObsidianSection() {
    const [vaultName, setVaultName] = useState("")
    const [folder, setFolder] = useState("")

    useEffect(() => {
        getSync<ResultSync>(["obsidianVaultName", "obsidianFolder"]).then((result) => {
            setVaultName(result.obsidianVaultName || "")
            setFolder(result.obsidianFolder || "")
        })
    }, [])

    useDebouncedEffect(
        () => {
            setSync({
                obsidianVaultName: vaultName.trim(),
                obsidianFolder: folder.trim(),
            })
        },
        [vaultName, folder],
        700,
    )

    return (
        <div className="flex flex-col gap-4">
            <div>
                <Label htmlFor="obsidian-vault-name">Vault name</Label>
                <Input
                    type="text"
                    id="obsidian-vault-name"
                    className="mt-2 rounded-none"
                    placeholder="My vault"
                    value={vaultName}
                    onChange={(e) => setVaultName(e.target.value)}
                />
                <p className="text-meetings-ink-muted mt-1 text-xs">
                    Must exactly match the vault name in Obsidian's vault switcher (case-sensitive).
                </p>
            </div>

            <div>
                <Label htmlFor="obsidian-folder">Folder (optional)</Label>
                <Input
                    type="text"
                    id="obsidian-folder"
                    className="mt-2 rounded-none"
                    placeholder="Meetings/Tape"
                    value={folder}
                    onChange={(e) => setFolder(e.target.value)}
                />
                <p className="text-meetings-ink-muted mt-1 text-xs">
                    Vault-relative path. Leave blank to save to the vault root. This folder must already exist in
                    your vault.
                </p>
            </div>

            <Separator />

            <p className="text-meetings-ink-muted text-sm">
                Transcripts save to Obsidian automatically after each meeting once a vault name is set above — no
                separate toggle needed. The filename template is in Settings → Files.
            </p>
        </div>
    )
}
