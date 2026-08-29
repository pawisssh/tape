import { useEffect, useRef, useState } from "react"
import { useDebouncedEffect } from "@/hooks/use-debounced-effect"
import {
    ChevronRight,
    Plus,
    Trash2,
    AlignLeft,
    List,
    Calendar,
    Hash,
    CheckSquare,
    Check,
    Download,
    Upload,
    MoreHorizontal,
    Copy,
    Clipboard,
} from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog"
import { toast } from "@/components/ui/toast"
import { cn } from "@/lib/utils"
import { getSync } from "@/lib/chrome-storage"
// Framework-free logic module, imported directly rather than duplicated into src/ — see
// PLAN.md §6 Phase 5 "Structural rule to preserve". DEFAULT_TEMPLATE is the starting
// point handed to a newly-created template; getTemplates/saveTemplate/deleteTemplate are
// the single source of truth, also used by extension/obsidian/llm.js's resolution logic.
import {
    getTemplates,
    saveTemplate,
    deleteTemplate,
    DEFAULT_TEMPLATE,
    TEMPLATE_PROPERTY_TYPES,
    templateToWebClipperJson,
    templateFromWebClipperJson,
} from "../../../extension/obsidian/templates.js"
import MasterDetailLayout from "../components/MasterDetailLayout"
import MobileBackButton from "../components/MobileBackButton"

const PROPERTY_TYPES = TEMPLATE_PROPERTY_TYPES

const TYPE_ICONS: Record<TemplatePropertyType, typeof AlignLeft> = {
    text: AlignLeft,
    multitext: List,
    date: Calendar,
    number: Hash,
    checkbox: CheckSquare,
}

const TYPE_LABELS: Record<TemplatePropertyType, string> = {
    text: "Text",
    multitext: "List",
    date: "Date",
    number: "Number",
    checkbox: "Checkbox",
}

function cloneProperties(properties: TemplateProperty[]): TemplateProperty[] {
    return properties.map((p) => ({ ...p }))
}

function kebabFilename(name: string): string {
    return (
        name
            .trim()
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, "-")
            .replace(/^-+|-+$/g, "") || "template"
    )
}

function downloadJson(json: unknown, filename: string) {
    const blob = new Blob([JSON.stringify(json, null, 2)], { type: "application/json" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = filename
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
}

export default function TemplatesView() {
    const [templates, setTemplates] = useState<SummaryTemplate[]>([])
    const [selectedId, setSelectedId] = useState<string | null>(null)
    const [name, setName] = useState("")
    const [keywords, setKeywords] = useState("")
    const [properties, setProperties] = useState<TemplateProperty[]>([])
    const [noteContent, setNoteContent] = useState("")
    const [mobileDetailOpen, setMobileDetailOpen] = useState(false)
    const [importDialogOpen, setImportDialogOpen] = useState(false)
    const [importText, setImportText] = useState("")
    const [isDragOver, setIsDragOver] = useState(false)
    const importFileInputRef = useRef<HTMLInputElement>(null)

    useEffect(() => {
        getTemplates().then((loaded) => {
            // "Default" is always shown as the first row, whether or not the user has ever
            // customized it — editing it here persists an id-"default" entry the same way
            // any other template saves (see resolveDefaultTemplate() in templates.js, which
            // is what enrichWithLlm() actually reads at summarization time); until then this
            // is just the hardcoded DEFAULT_TEMPLATE shown as a starting point.
            const defaultEntry = loaded.find((t) => t.id === "default") ?? { ...DEFAULT_TEMPLATE }
            const rest = loaded.filter((t) => t.id !== "default")
            const withDefault = [defaultEntry, ...rest]
            setTemplates(withDefault)
            selectTemplate(withDefault[0])
        })
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])

    function selectTemplate(template: SummaryTemplate) {
        setSelectedId(template.id)
        setName(template.name)
        setKeywords(template.keywords)
        setProperties(cloneProperties(template.properties))
        setNoteContent(template.noteContent)
    }

    function handleAddTemplate() {
        const draft = {
            name: "New template",
            keywords: "",
            properties: cloneProperties(DEFAULT_TEMPLATE.properties),
            noteContent: DEFAULT_TEMPLATE.noteContent,
        }
        saveTemplate(draft).then((saved) => {
            setTemplates((prev) => [...prev, saved])
            selectTemplate(saved)
            setMobileDetailOpen(true)
        })
    }

    // Autosave: fires 700ms after name/keywords/properties/noteContent settle, skipped
    // entirely while the name is blank (matches the old handleSave's validation — rather
    // than warning on every keystroke, an empty name just means "not saveable yet").
    // resetKey: selectedId — switching templates swaps every field at once via
    // selectTemplate(); that's a navigation, not an edit, so it must not itself trigger a
    // (redundant, if harmless) resave of the template being switched to.
    useDebouncedEffect(
        () => {
            if (!selectedId || !name.trim()) return
            saveTemplate({
                id: selectedId,
                name: name.trim(),
                keywords: keywords.trim(),
                properties,
                noteContent,
            }).then((saved) => {
                setTemplates((prev) => prev.map((t) => (t.id === saved.id ? saved : t)))
            })
        },
        [selectedId, name, keywords, properties, noteContent],
        700,
        selectedId,
    )

    function handleDelete() {
        // Belt-and-suspenders — the Delete menu item is hidden for it, but this stops any
        // stray call from removing the pinned "Default" row (see resolveDefaultTemplate() in
        // templates.js, which just falls back to the hardcoded DEFAULT_TEMPLATE if it's gone
        // anyway, so this isn't preventing data loss so much as UI confusion).
        if (!selectedId || selectedId === "default") return
        const id = selectedId
        deleteTemplate(id).then(() => {
            const remaining = templates.filter((t) => t.id !== id)
            setTemplates(remaining)
            if (remaining.length > 0) {
                selectTemplate(remaining[0])
            } else {
                setSelectedId(null)
                setName("")
                setKeywords("")
                setProperties([])
                setNoteContent("")
                setMobileDetailOpen(false)
            }
            toast.add({ title: "Template deleted", type: "success" })
        })
    }

    function addProperty() {
        setProperties((prev) => [...prev, { name: "", value: "", type: "text" }])
    }

    function updateProperty(index: number, patch: Partial<TemplateProperty>) {
        setProperties((prev) => prev.map((p, i) => (i === index ? { ...p, ...patch } : p)))
    }

    function removeProperty(index: number) {
        setProperties((prev) => prev.filter((_, i) => i !== index))
    }

    // Exports use the current in-editor state (name/keywords/properties/noteContent),
    // including unsaved edits — not just what's already persisted — matching the
    // principle-of-least-surprise ("export what I'm looking at right now").
    function currentTemplateForExport(): SummaryTemplate {
        return { id: selectedId || "", name, keywords, properties, noteContent }
    }

    // obsidianFileNameTemplate/obsidianFolder are informational-only fields on the
    // exported JSON (see templateToWebClipperJson's doc comment) — this app has no
    // per-template filename/folder, only these global settings.
    function readGlobalObsidianSettingsForExport() {
        return getSync<ResultSync>(["obsidianFileNameTemplate", "obsidianFolder"])
    }

    function handleExport() {
        readGlobalObsidianSettingsForExport().then((settings) => {
            const json = templateToWebClipperJson(currentTemplateForExport(), {
                fileNameTemplate: settings.obsidianFileNameTemplate,
                folder: settings.obsidianFolder,
            })
            downloadJson(json, `${kebabFilename(name)}.json`)
        })
    }

    function handleCopyAsJson() {
        readGlobalObsidianSettingsForExport().then((settings) => {
            const json = templateToWebClipperJson(currentTemplateForExport(), {
                fileNameTemplate: settings.obsidianFileNameTemplate,
                folder: settings.obsidianFolder,
            })
            navigator.clipboard
                .writeText(JSON.stringify(json, null, 2))
                .then(() => toast.add({ title: "Copied as JSON", type: "success" }))
                .catch(() => toast.add({ title: "Could not copy to clipboard", type: "error" }))
        })
    }

    function handleDuplicate() {
        saveTemplate({
            name: `${name} (copy)`,
            keywords,
            properties: cloneProperties(properties),
            noteContent,
        }).then((saved) => {
            setTemplates((prev) => [...prev, saved])
            selectTemplate(saved)
            setMobileDetailOpen(true)
            toast.add({ title: "Template duplicated", type: "success" })
        })
    }

    function openImportDialog() {
        setImportText("")
        setImportDialogOpen(true)
    }

    function readImportFile(file: File) {
        const reader = new FileReader()
        reader.onload = () => {
            if (typeof reader.result === "string") {
                setImportText(reader.result)
            }
        }
        reader.onerror = () => toast.add({ title: "Could not read file", type: "error" })
        reader.readAsText(file)
    }

    function handleImportDrop(e: React.DragEvent<HTMLButtonElement>) {
        e.preventDefault()
        setIsDragOver(false)
        const file = e.dataTransfer.files?.[0]
        if (file) readImportFile(file)
    }

    function handleImportFileChange(e: React.ChangeEvent<HTMLInputElement>) {
        const file = e.target.files?.[0]
        e.target.value = ""
        if (file) readImportFile(file)
    }

    function handleImportSubmit() {
        let parsed: unknown
        try {
            parsed = JSON.parse(importText)
        } catch {
            toast.add({ title: "Invalid JSON", description: "Couldn't parse that as JSON.", type: "error" })
            return
        }
        const draft = templateFromWebClipperJson(parsed)
        saveTemplate(draft).then((saved) => {
            setTemplates((prev) => [...prev, saved])
            selectTemplate(saved)
            setImportDialogOpen(false)
            setMobileDetailOpen(true)
            toast.add({ title: "Template imported", type: "success" })
        })
    }

    return (
        <>
        <MasterDetailLayout
            contentTitle={
                <>
                    <h1 className="flex-1 text-xl font-bold">Templates</h1>
                    <Button type="button" variant="outline" onClick={openImportDialog}>
                        <Upload /> Import
                    </Button>
                    <Button type="button" onClick={handleAddTemplate}>
                        <Plus /> Add template
                    </Button>
                </>
            }
            content={
                        <div className="flex flex-col">
                            <p className="text-muted-foreground px-4 pt-4 pb-2 text-sm">
                                Create a summary template per meeting type, auto-selected by matching keywords against
                                the meeting title. Meetings that don't match any template use the built-in default
                                template.
                            </p>
                            {templates.length > 0 ? (
                                templates.map((template) => (
                                    <button
                                        key={template.id}
                                        type="button"
                                        className={cn(
                                            "flex items-center justify-between gap-2 border-r-[3px] border-r-transparent py-3 pr-[13px] pl-4 text-left text-sm hover:bg-muted/50",
                                            selectedId === template.id && "border-r-primary bg-muted",
                                        )}
                                        onClick={() => {
                                            selectTemplate(template)
                                            setMobileDetailOpen(true)
                                        }}
                                    >
                                        {template.name}
                                        <ChevronRight className="text-muted-foreground size-4 shrink-0" />
                                    </button>
                                ))
                            ) : (
                                <div className="px-4">
                                    <Card>
                                        <CardContent>
                                            <p className="text-muted-foreground text-sm">
                                                No templates yet — every meeting uses the built-in default template.
                                                Add a template to customize the notes for a specific kind of meeting
                                                (e.g. standups, sales calls, 1:1s).
                                            </p>
                                        </CardContent>
                                    </Card>
                                </div>
                            )}
                        </div>
                    }
            detailTitle={
                selectedId ? (
                    <>
                        <MobileBackButton onClick={() => setMobileDetailOpen(false)} />
                        <h2 className="truncate text-xl font-bold">{name || "Untitled template"}</h2>
                    </>
                ) : null
            }
            detail={
                selectedId ? (
                    <div className="flex flex-col gap-4 px-4">
                        <div>
                            <Label htmlFor="template-name">Name</Label>
                            <Input
                                id="template-name"
                                className="mt-2"
                                value={name}
                                disabled={selectedId === "default"}
                                onChange={(e) => setName(e.target.value)}
                            />
                        </div>

                        <div>
                            <Label htmlFor="template-keywords">Match when title contains</Label>
                            <Input
                                id="template-keywords"
                                className="mt-2"
                                placeholder="e.g. standup, daily sync"
                                value={keywords}
                                disabled={selectedId === "default"}
                                onChange={(e) => setKeywords(e.target.value)}
                            />
                            <p className="text-muted-foreground mt-1 text-xs">
                                {selectedId === "default"
                                    ? "\"Default\" always stays the fallback for meetings that don't match any other template, so its name and keywords are fixed — only its properties and note content are editable."
                                    : "Comma-separated, case-insensitive. Leave blank to use this template as the fallback for meetings that don't match any other template."}
                            </p>
                        </div>

                        <div>
                            <Label>Properties</Label>
                            <p className="text-muted-foreground mt-1 text-xs">
                                Frontmatter fields added to the top of the note. Values can be plain text, a{" "}
                                <code className="bg-foreground/10 rounded px-1">{"{{variable}}"}</code>, or a quoted
                                AI instruction — see the reference below.
                            </p>
                            <div className="mt-1.5 flex flex-col gap-1">
                                {properties.map((property, index) => {
                                    const TypeIcon = TYPE_ICONS[property.type]
                                    return (
                                        <div key={index} className="flex items-center gap-1">
                                            <DropdownMenu>
                                                <DropdownMenuTrigger
                                                    render={
                                                        <Button
                                                            type="button"
                                                            variant="ghost"
                                                            size="icon-sm"
                                                            aria-label={`Property type: ${TYPE_LABELS[property.type]}`}
                                                        >
                                                            <TypeIcon />
                                                        </Button>
                                                    }
                                                />
                                                <DropdownMenuContent align="start">
                                                    {PROPERTY_TYPES.map((t) => {
                                                        const ItemIcon = TYPE_ICONS[t]
                                                        return (
                                                            <DropdownMenuItem
                                                                key={t}
                                                                onClick={() => updateProperty(index, { type: t })}
                                                            >
                                                                <ItemIcon /> {TYPE_LABELS[t]}
                                                                {property.type === t ? (
                                                                    <Check className="ml-auto" />
                                                                ) : null}
                                                            </DropdownMenuItem>
                                                        )
                                                    })}
                                                </DropdownMenuContent>
                                            </DropdownMenu>
                                            <Input
                                                className="h-9 w-28 shrink-0"
                                                placeholder="name"
                                                value={property.name}
                                                onChange={(e) => updateProperty(index, { name: e.target.value })}
                                            />
                                            <Input
                                                className="h-9 flex-1 font-mono text-xs"
                                                placeholder="value"
                                                value={property.value}
                                                onChange={(e) => updateProperty(index, { value: e.target.value })}
                                            />
                                            <Button
                                                type="button"
                                                variant="ghost"
                                                size="icon-sm"
                                                aria-label="Remove property"
                                                onClick={() => removeProperty(index)}
                                            >
                                                <Trash2 />
                                            </Button>
                                        </div>
                                    )
                                })}
                            </div>
                            <Button type="button" variant="outline" size="sm" className="mt-1.5" onClick={addProperty}>
                                <Plus /> Add property
                            </Button>
                        </div>

                        <div>
                            <Label htmlFor="template-note-content">Note content</Label>
                            <Textarea
                                id="template-note-content"
                                className="mt-2 min-h-64 font-mono text-xs"
                                value={noteContent}
                                onChange={(e) => setNoteContent(e.target.value)}
                            />
                        </div>

                        <Card>
                            <CardContent className="flex flex-col gap-2 text-xs">
                                <p className="font-bold">Syntax reference</p>
                                <p>
                                    <code className="bg-foreground/10 rounded px-1">{"{{variable}}"}</code> substitutes
                                    a meeting value directly.{" "}
                                    <code className="bg-foreground/10 rounded px-1">{'{{"instruction"|filter}}'}</code>{" "}
                                    sends the quoted instruction to the LLM (all instructions in a template are
                                    batched into one request) and applies the filter to its answer.
                                </p>
                                <p>
                                    <span className="font-bold">Variables:</span>{" "}
                                    {[
                                        "title",
                                        "date",
                                        "meetingStart",
                                        "meetingEnd",
                                        "duration",
                                        "platform",
                                        "participants",
                                        "participantCount",
                                        "transcript",
                                        "chatMessages",
                                    ]
                                        .map((v) => `{{${v}}}`)
                                        .join(", ")}
                                </p>
                                <p>
                                    <code className="bg-foreground/10 rounded px-1">{"{{transcript}}"}</code>/
                                    <code className="bg-foreground/10 rounded px-1">{"{{chatMessages}}"}</code> are the
                                    body text only — give them their own heading, e.g.{" "}
                                    <code className="bg-foreground/10 rounded px-1">{"## Transcript"}</code>. Using
                                    either one replaces this app's automatic Transcript/Chat messages section at the
                                    end of the note, so it's never duplicated.
                                </p>
                                <p>
                                    <span className="font-bold">Filters:</span> list (
                                    <code className="bg-foreground/10 rounded px-1">{'list:"checkbox"'}</code> for a
                                    checklist), timestamped (validates and appends a{" "}
                                    <code className="bg-foreground/10 rounded px-1">{"[M:SS]"}</code> citation copied
                                    from the transcript — combine as{" "}
                                    <code className="bg-foreground/10 rounded px-1">{"|list|timestamped"}</code>),
                                    wikilink, kebab, lower, upper, trim,{" "}
                                    <code className="bg-foreground/10 rounded px-1">{'date:"YYYY-MM-DD"'}</code>,{" "}
                                    <code className="bg-foreground/10 rounded px-1">{'replace:("pattern":"replacement")'}</code>
                                    , <code className="bg-foreground/10 rounded px-1">{"slice:0,3"}</code>,{" "}
                                    <code className="bg-foreground/10 rounded px-1">{'join:", "'}</code>,{" "}
                                    <code className="bg-foreground/10 rounded px-1">{'split:","'}</code>.
                                </p>
                                <p>
                                    A property typed <span className="font-bold">List</span> splits its resolved
                                    value on commas into separate frontmatter list items.
                                </p>
                            </CardContent>
                        </Card>

                        <div className="flex items-center gap-2">
                            <Button type="button" variant="outline" onClick={handleExport}>
                                <Download /> Export
                            </Button>
                            <DropdownMenu>
                                <DropdownMenuTrigger
                                    render={
                                        <Button type="button" variant="outline" size="icon" aria-label="More actions">
                                            <MoreHorizontal />
                                        </Button>
                                    }
                                />
                                <DropdownMenuContent align="start">
                                    <DropdownMenuItem onClick={handleDuplicate}>
                                        <Copy /> Duplicate
                                    </DropdownMenuItem>
                                    <DropdownMenuItem onClick={handleCopyAsJson}>
                                        <Clipboard /> Copy as JSON
                                    </DropdownMenuItem>
                                    {selectedId !== "default" ? (
                                        <DropdownMenuItem variant="destructive" onClick={handleDelete}>
                                            <Trash2 /> Delete
                                        </DropdownMenuItem>
                                    ) : null}
                                </DropdownMenuContent>
                            </DropdownMenu>
                        </div>
                    </div>
                ) : (
                    <p className="text-muted-foreground px-4 text-sm">Select a template to see its details.</p>
                )
            }
            mobileDetailOpen={mobileDetailOpen}
        />

        <Dialog open={importDialogOpen} onOpenChange={setImportDialogOpen}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>Import template</DialogTitle>
                    <DialogDescription>
                        Drop a template JSON file, or paste its contents below. Always creates a new template — never
                        overwrites an existing one.
                    </DialogDescription>
                </DialogHeader>

                <input
                    ref={importFileInputRef}
                    type="file"
                    accept="application/json"
                    className="hidden"
                    onChange={handleImportFileChange}
                />
                <button
                    type="button"
                    onClick={() => importFileInputRef.current?.click()}
                    onDragOver={(e) => {
                        e.preventDefault()
                        setIsDragOver(true)
                    }}
                    onDragLeave={() => setIsDragOver(false)}
                    onDrop={handleImportDrop}
                    className={cn(
                        "rounded-lg border-2 border-dashed p-6 text-center text-sm transition-colors",
                        isDragOver ? "border-primary bg-primary/5" : "border-border text-muted-foreground",
                    )}
                >
                    Drag and drop a file here, or click to browse
                </button>

                <div>
                    <Label htmlFor="import-json-text">Or paste content below</Label>
                    <Textarea
                        id="import-json-text"
                        className="mt-2 min-h-40 font-mono text-xs"
                        placeholder="Paste JSON here"
                        value={importText}
                        onChange={(e) => setImportText(e.target.value)}
                    />
                </div>

                <DialogFooter>
                    <Button type="button" variant="outline" onClick={() => setImportDialogOpen(false)}>
                        Cancel
                    </Button>
                    <Button type="button" disabled={!importText.trim()} onClick={handleImportSubmit}>
                        Import
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
        </>
    )
}
