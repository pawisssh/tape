import { test } from 'node:test'
import assert from 'node:assert/strict'
import { registerContentScript } from '../extension/background-script/platforms.js'
import { PLATFORM_CONFIGS } from '../extension/background-script/config.js'

test('an existing registration receives the new live-panel script after extension update', async () => {
    const config = PLATFORM_CONFIGS.google_meet
    let updated
    globalThis.chrome = {
        permissions: { contains: async () => true },
        scripting: {
            getRegisteredContentScripts: async () => [{ id: config.id, js: ['content-scripts/common-utils.js'] }],
            updateContentScripts: async scripts => { updated = scripts[0] },
            registerContentScripts: async () => { throw Error('should update the existing registration') },
        },
    }
    try {
        assert.equal(await registerContentScript('google_meet', false), 'Content script updated')
        assert.deepEqual(updated.js, config.js)
        assert.ok(updated.js.includes('content-scripts/live-panel.js'))
    } finally {
        delete globalThis.chrome
    }
})
