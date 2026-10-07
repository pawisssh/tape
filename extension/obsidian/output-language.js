// @ts-check
/// <reference path="../../types/index.js" />

// Language every AI analysis (live Rewind/Recap and the end-of-meeting summary) answers
// in. Stored in chrome.storage.sync as `outputLanguage`; "auto" keeps the model writing
// in the transcript's own language.

/** @type {{id: OutputLanguage, label: string, name?: string}[]} */
export const OUTPUT_LANGUAGES = [
    { id: "auto", label: "Auto (match meeting)" },
    { id: "en", label: "English", name: "English" },
    { id: "th", label: "ไทย (Thai)", name: "Thai" },
]

/** @param {unknown} value @returns {OutputLanguage} */
export function normalizeOutputLanguage(value) {
    return value === "en" || value === "th" ? value : "auto"
}

/** @param {unknown} value @returns {string} empty for "auto" */
export function outputLanguageInstruction(value) {
    const language = OUTPUT_LANGUAGES.find((item) => item.id === normalizeOutputLanguage(value))
    if (!language?.name) return ""
    return `Write every natural-language value in your answer in ${language.name}, even if the transcript is in another language. ` +
        "Keep JSON keys, people's names, numbers, and any verbatim or quoted evidence exactly as they appear in the transcript."
}
