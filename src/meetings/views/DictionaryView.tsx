import { useEffect, useState } from "react"
import { useDebouncedEffect } from "@/hooks/use-debounced-effect"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { cn } from "@/lib/utils"
import CircleIconButton from "../ui/CircleIconButton"
import { KeyboardArrowRightIcon, PlusIcon, DeleteIcon, MoreHorizIcon, LibraryAddIcon } from "../ui/icons"
// Framework-free logic module, imported directly rather than duplicated into src/ — see
// PLAN.md §6 Phase 5 "Structural rule to preserve". getCategories/saveCategory/
// deleteCategory/getWords/saveWord/deleteWord are the single source of truth, also used
// by pickupLastMeetingFromStorage() (meetings.js) to correct transcripts.
import {
    getCategories,
    saveCategory,
    deleteCategory,
    getWords,
    saveWord,
    deleteWord,
    UNCATEGORIZED_ID,
} from "../../../extension/obsidian/dictionary.js"
import { groupWordsByCategory } from "../dictionary/group-by-category"
import MasterDetailLayout from "../components/MasterDetailLayout"
import MobileBackButton from "../components/MobileBackButton"

export default function DictionaryView() {
    const [categories, setCategories] = useState<DictionaryCategory[]>([])
    const [words, setWords] = useState<DictionaryEntry[]>([])
    const [selectedId, setSelectedId] = useState<string | null>(null)
    const [word, setWord] = useState("")
    const [hasReplacement, setHasReplacement] = useState(false)
    const [replacement, setReplacement] = useState("")
    const [categoryId, setCategoryId] = useState(UNCATEGORIZED_ID)
    const [mobileDetailOpen, setMobileDetailOpen] = useState(false)

    useEffect(() => {
        Promise.all([getCategories(), getWords()]).then(([loadedCategories, loadedWords]) => {
            setCategories(loadedCategories)
            setWords(loadedWords)
        })
    }, [])

    function selectWord(entry: DictionaryEntry) {
        setSelectedId(entry.id)
        setWord(entry.word)
        setHasReplacement(!!entry.replacement)
        setReplacement(entry.replacement ?? "")
        setCategoryId(entry.categoryId)
    }

    function clearSelection() {
        setSelectedId(null)
        setWord("")
        setHasReplacement(false)
        setReplacement("")
        setCategoryId(UNCATEGORIZED_ID)
        setMobileDetailOpen(false)
    }

    function handleAddWord() {
        saveWord({ word: "", categoryId: UNCATEGORIZED_ID }).then((saved) => {
            setWords((prev) => [...prev, saved])
            selectWord(saved)
            setMobileDetailOpen(true)
        })
    }

    // Autosave: fires 700ms after word/hasReplacement/replacement/categoryId settle,
    // skipped entirely while the word is blank — matches TemplatesView's autosave pattern.
    // resetKey: selectedId — switching words swaps every field at once via selectWord();
    // that's a navigation, not an edit, so it must not itself trigger a resave.
    useDebouncedEffect(
        () => {
            if (!selectedId || !word.trim()) return
            saveWord({
                id: selectedId,
                word: word.trim(),
                replacement: hasReplacement ? replacement.trim() : undefined,
                categoryId,
            }).then((saved) => {
                setWords((prev) => prev.map((w) => (w.id === saved.id ? saved : w)))
            })
        },
        [selectedId, word, hasReplacement, replacement, categoryId],
        700,
        selectedId,
    )

    function handleDeleteWord() {
        if (!selectedId) return
        const id = selectedId
        deleteWord(id).then(() => {
            const remaining = words.filter((w) => w.id !== id)
            setWords(remaining)
            if (remaining.length > 0) {
                selectWord(remaining[0])
            } else {
                clearSelection()
            }
        })
    }

    function handleAddCategory() {
        saveCategory({ name: "New category" }).then((saved) => {
            setCategories((prev) => [...prev, saved])
        })
    }

    function handleRenameCategory(id: string, name: string) {
        const trimmed = name.trim()
        if (!trimmed) return
        saveCategory({ id, name: trimmed }).then((saved) => {
            setCategories((prev) => prev.map((c) => (c.id === saved.id ? saved : c)))
        })
    }

    function handleDeleteCategory(id: string) {
        deleteCategory(id).then(() => {
            setCategories((prev) => prev.filter((c) => c.id !== id))
            setWords((prev) => prev.map((w) => (w.categoryId === id ? { ...w, categoryId: UNCATEGORIZED_ID } : w)))
            if (categoryId === id) setCategoryId(UNCATEGORIZED_ID)
        })
    }

    const groups = groupWordsByCategory(words, categories)

    return (
        <MasterDetailLayout
            className="meetings-redesign"
            contentTitle={
                <>
                    <h1 className="font-meetings-heading flex-1 text-xl text-meetings-ink">dictionary</h1>
                    <CircleIconButton label="New category" icon={<LibraryAddIcon />} onClick={handleAddCategory} />
                    <button
                        type="button"
                        onClick={handleAddWord}
                        className="flex h-9 shrink-0 items-center gap-2 rounded-full bg-meetings-ink pr-4 pl-2 text-sm font-medium text-meetings-surface shadow-[0px_16px_16px_rgba(12,12,13,0.1),0px_4px_2px_rgba(12,12,13,0.05)] transition-opacity hover:opacity-90"
                    >
                        <PlusIcon className="size-6" /> Add word
                    </button>
                </>
            }
            content={
                <div className="flex flex-col">
                    <p className="px-4 pt-4 pb-2 text-sm text-meetings-ink-muted">
                        Add words your meetings commonly mis-transcribe, grouped into categories. A word with a
                        replacement is automatically corrected in the transcript when a meeting ends.
                    </p>
                    {words.length === 0 && categories.length <= 1 ? (
                        <div className="mx-4 border border-meetings-border p-4">
                            <p className="text-sm text-meetings-ink-muted">
                                No dictionary entries yet — add a word to start correcting common transcription
                                mistakes.
                            </p>
                        </div>
                    ) : (
                        groups.map((group) => (
                            <div key={group.key}>
                                <div className="flex h-10 items-center gap-2 px-4">
                                    {group.isUncategorized ? (
                                        <span className="flex-1 truncate text-sm font-bold text-meetings-ink">{group.label}</span>
                                    ) : (
                                        <span
                                            contentEditable
                                            suppressContentEditableWarning
                                            title="Rename category"
                                            className="flex-1 truncate rounded p-0.5 text-sm font-bold text-meetings-ink outline-none hover:outline hover:outline-meetings-border focus-visible:ring-3 focus-visible:ring-ring/50"
                                            onBlur={(e) => handleRenameCategory(group.key, e.currentTarget.innerText)}
                                        >
                                            {group.label}
                                        </span>
                                    )}
                                    <span className="text-xs text-meetings-ink-faint">{group.entries.length}</span>
                                    {!group.isUncategorized ? (
                                        <DropdownMenu>
                                            <DropdownMenuTrigger render={<CircleIconButton label="Category actions" icon={<MoreHorizIcon />} />} />
                                            <DropdownMenuContent align="start">
                                                <DropdownMenuItem variant="destructive" onClick={() => handleDeleteCategory(group.key)}>
                                                    <DeleteIcon className="size-4" /> Delete category
                                                </DropdownMenuItem>
                                            </DropdownMenuContent>
                                        </DropdownMenu>
                                    ) : null}
                                </div>
                                {group.entries.map((entry) => (
                                    <button
                                        key={entry.id}
                                        type="button"
                                        className={cn(
                                            "flex h-14 w-full items-center justify-between gap-2 px-4 text-left text-sm font-medium text-meetings-ink",
                                            selectedId === entry.id && "bg-meetings-chip",
                                        )}
                                        onClick={() => {
                                            selectWord(entry)
                                            setMobileDetailOpen(true)
                                        }}
                                    >
                                        <span className="min-w-0 flex-1 truncate">
                                            {entry.word || "Untitled word"}
                                            <span className="ml-2 truncate text-xs font-normal text-meetings-ink-muted">
                                                {entry.replacement || "(no replacement)"}
                                            </span>
                                        </span>
                                        <KeyboardArrowRightIcon className="size-4 shrink-0 text-meetings-ink-faint" />
                                    </button>
                                ))}
                            </div>
                        ))
                    )}
                </div>
            }
            detailTitle={
                selectedId ? (
                    <>
                        <MobileBackButton onClick={() => setMobileDetailOpen(false)} />
                        <h2 className="font-meetings-heading flex-1 truncate text-xl text-meetings-ink">
                            {word || "Untitled word"}
                        </h2>
                        <CircleIconButton
                            label="Delete word"
                            icon={<DeleteIcon />}
                            className="text-destructive"
                            onClick={handleDeleteWord}
                        />
                    </>
                ) : null
            }
            detail={
                selectedId ? (
                    <div className="flex flex-col gap-4 px-4">
                        <div>
                            <Label htmlFor="dictionary-word">Word</Label>
                            <Input
                                id="dictionary-word"
                                className="mt-2 rounded-none"
                                value={word}
                                onChange={(e) => setWord(e.target.value)}
                            />
                        </div>

                        <div className="flex items-center justify-between gap-4">
                            <Label htmlFor="dictionary-has-replacement">Add a replacement</Label>
                            <Switch id="dictionary-has-replacement" checked={hasReplacement} onCheckedChange={setHasReplacement} />
                        </div>

                        {hasReplacement ? (
                            <div>
                                <Label htmlFor="dictionary-replacement">Replacement</Label>
                                <Input
                                    id="dictionary-replacement"
                                    className="mt-2 rounded-none"
                                    value={replacement}
                                    onChange={(e) => setReplacement(e.target.value)}
                                />
                            </div>
                        ) : null}

                        <div>
                            <Label>Category</Label>
                            <Select value={categoryId} onValueChange={setCategoryId}>
                                <SelectTrigger className="mt-2 w-full rounded-none">
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    {categories.map((category) => (
                                        <SelectItem key={category.id} value={category.id}>
                                            {category.name}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                    </div>
                ) : (
                    <p className="px-4 text-sm text-meetings-ink-muted">Select a word to see its details.</p>
                )
            }
            mobileDetailOpen={mobileDetailOpen}
        />
    )
}
