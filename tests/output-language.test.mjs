import { test } from 'node:test'
import assert from 'node:assert/strict'
import { OUTPUT_LANGUAGES, normalizeOutputLanguage, outputLanguageInstruction } from '../extension/obsidian/output-language.js'

test('offers auto, English and Thai', () => {
    assert.deepEqual(OUTPUT_LANGUAGES.map(language => language.id), ['auto', 'en', 'th'])
})

test('unknown or missing values normalize to auto', () => {
    assert.equal(normalizeOutputLanguage('th'), 'th')
    assert.equal(normalizeOutputLanguage('en'), 'en')
    assert.equal(normalizeOutputLanguage(undefined), 'auto')
    assert.equal(normalizeOutputLanguage('fr'), 'auto')
})

test('auto adds no instruction; a chosen language names it and keeps evidence verbatim', () => {
    assert.equal(outputLanguageInstruction('auto'), '')
    assert.equal(outputLanguageInstruction(undefined), '')
    assert.match(outputLanguageInstruction('th'), /in Thai/)
    assert.match(outputLanguageInstruction('en'), /in English/)
    assert.match(outputLanguageInstruction('th'), /verbatim/)
})
