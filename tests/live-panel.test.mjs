import { test } from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import { readFileSync } from 'node:fs'

const source = readFileSync(new URL('../extension/content-scripts/live-panel.js', import.meta.url), 'utf8')
const context = vm.createContext({})
vm.runInContext(source, context)

test('dropdown remains within the viewport near every edge and in a narrow window', () => {
    for (const [width, height] of [[1440, 900], [320, 480]]) {
        for (const anchor of [
            { left: 0, right: 200, top: 0, bottom: 40 },
            { left: width - 200, right: width, top: height - 40, bottom: height },
        ]) {
            const result = context.getLivePanelPlacement(anchor, width, height)
            assert.ok(result.left >= 12)
            assert.ok(result.top >= 12)
            assert.ok(result.left + result.width <= width - 12)
            assert.ok(result.top + result.height <= height - 12)
        }
    }
})

test('dropdown flips above a widget near the bottom', () => {
    const result = context.getLivePanelPlacement({ left: 500, right: 900, top: 800, bottom: 840 }, 1440, 900)
    assert.ok(result.top + result.height < 800)
})

test('the floating widget is clamped back into a resized web-app window', () => {
    const placed = context.getFabViewportPosition({ left: 1200, top: 600, width: 300, height: 40 }, 320, 480)
    assert.equal(placed.left, 20)
    assert.equal(placed.top, 440)
})

test('a note snapshots the selected speech so later caption edits cannot change the saved link', () => {
    const speech = { blockIndex: 3, personName: 'Sam', timestamp: '2026-01-01T10:00:00.000Z', transcriptText: 'Send the draft.' }
    const note = context.createCommentNoteEntry('  Follow up tomorrow  ', speech, Date.parse('2026-01-01T10:00:10.000Z'))
    speech.transcriptText = 'Changed caption'
    assert.equal(note.text, 'Follow up tomorrow')
    assert.equal(note.timestamp, '2026-01-01T10:00:10.000Z')
    assert.equal(note.linkedTranscript.transcriptText, 'Send the draft.')
    assert.equal(note.linkedTranscript.blockIndex, 3)
    assert.equal(context.createCommentNoteEntry('Plain note', null, 0).linkedTranscript, undefined)
})
