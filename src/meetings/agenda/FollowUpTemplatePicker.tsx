import { useEffect, useState } from "react"
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuRadioGroup,
    DropdownMenuRadioItem,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { KeyboardArrowDownIcon } from "../ui/icons"
import { getTemplates, DEFAULT_TEMPLATE } from "../../../extension/obsidian/templates.js"

interface FollowUpTemplatePickerProps {
    value: string | undefined
    disabled?: boolean
    onChange: (templateOverrideId: string | undefined) => void
}

// Per-meeting Summary-template override — picks from the user's saved templates (plus
// the built-in Default), overriding the automatic keyword match (resolveTemplateForTitle)
// for just this one meeting. See extension/obsidian/llm.js's enrichWithLlm(), which
// checks meeting.templateOverrideId before falling back to automatic resolution. Lives in
// the header toolbar (MeetingDetailToolbar.tsx) rather than the Summary tab body — Figma
// groups it with the Copy/Download/More actions, not with the summary content itself.
//
// A DropdownMenu (matching MeetingDetailToolbar's own "More actions" menu) rather than a
// Select — this is a short, static-shaped list of named choices with no need for a
// combobox/native-select feel, so it reads as one more menu in the same toolbar rather
// than a form control. DropdownMenuRadioGroup/Item is the single-select variant of the
// same primitives TemplatesView.tsx already uses for its property-type picker.
//
// Purely presentational: picking a value only calls `onChange` — the caller
// (MeetingDetailToolbar) is the one that persists the override then triggers a
// regeneration, since it already owns the "Summarize now" sendMessage/toast plumbing.
export default function FollowUpTemplatePicker({ value, disabled, onChange }: FollowUpTemplatePickerProps) {
    const [templates, setTemplates] = useState<SummaryTemplate[]>([])

    useEffect(() => {
        getTemplates().then(setTemplates)
    }, [])

    const selectedName = templates.find((t) => t.id === value)?.name ?? DEFAULT_TEMPLATE.name

    return (
        <DropdownMenu>
            <DropdownMenuTrigger
                render={
                    <button
                        type="button"
                        disabled={disabled}
                        className="flex h-7 min-w-0 items-center gap-1 border border-meetings-border px-2 text-xs text-meetings-ink disabled:pointer-events-none disabled:opacity-50"
                    >
                        <span className="truncate">{selectedName}</span>
                        <KeyboardArrowDownIcon className="size-3.5 shrink-0 text-meetings-ink-faint" />
                    </button>
                }
            />
            <DropdownMenuContent align="start">
                <DropdownMenuRadioGroup
                    value={value || "default"}
                    onValueChange={(v) => onChange(v === "default" ? undefined : (v as string))}
                >
                    <DropdownMenuRadioItem value="default">{DEFAULT_TEMPLATE.name}</DropdownMenuRadioItem>
                    {templates.map((t) => (
                        <DropdownMenuRadioItem key={t.id} value={t.id}>
                            {t.name}
                        </DropdownMenuRadioItem>
                    ))}
                </DropdownMenuRadioGroup>
            </DropdownMenuContent>
        </DropdownMenu>
    )
}
