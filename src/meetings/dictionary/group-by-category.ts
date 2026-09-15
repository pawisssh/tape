export interface DictionaryCategoryGroup {
    key: string
    label: string
    isUncategorized: boolean
    entries: DictionaryEntry[]
}

const UNCATEGORIZED_ID = "uncategorized"

/**
 * Buckets words by category, one group per category (including empty ones, so an emptied
 * category's header/rename/delete affordance stays visible in the list), sorted
 * alphabetically by word within each group. Uncategorized is always last, regardless of
 * where it sorts alphabetically among the user's own category names.
 */
export function groupWordsByCategory(words: DictionaryEntry[], categories: DictionaryCategory[]): DictionaryCategoryGroup[] {
    const byCategory = new Map<string, DictionaryEntry[]>()
    for (const category of categories) {
        byCategory.set(category.id, [])
    }

    for (const word of words) {
        const bucket = byCategory.get(word.categoryId) ?? byCategory.get(UNCATEGORIZED_ID)
        bucket?.push(word)
    }

    const groups = categories.map((category) => ({
        key: category.id,
        label: category.name,
        isUncategorized: category.id === UNCATEGORIZED_ID,
        entries: (byCategory.get(category.id) ?? []).sort((a, b) => a.word.localeCompare(b.word, undefined, { sensitivity: "base" })),
    }))

    return groups.sort((a, b) => {
        if (a.isUncategorized !== b.isUncategorized) return a.isUncategorized ? 1 : -1
        return 0
    })
}
