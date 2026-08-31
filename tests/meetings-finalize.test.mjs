import { test, describe } from "node:test"
import assert from "node:assert/strict"
import { finalizeMeetingOnce } from "../extension/background-script/meetings.js"

// finalizeMeetingOnce() doesn't touch chrome.* itself (see its own doc comment in
// meetings.js) — no chrome.storage fake needed here, unlike tests/store.test.mjs.

function deferred() {
    /** @type {(value?: any) => void} */
    let resolve
    const promise = new Promise((res) => {
        resolve = res
    })
    return { promise, resolve }
}

describe("finalizeMeetingOnce", () => {
    test("a second call while the first is still pending is a safe no-op, not a duplicate run", async () => {
        let callCount = 0
        const first = deferred()

        const runFirst = () => {
            callCount++
            return first.promise
        }
        const runSecond = () => {
            callCount++
            return Promise.resolve("should never run")
        }

        const firstResultPromise = finalizeMeetingOnce(runFirst)
        // Fired "in quick succession" — before the first call's promise has settled.
        const secondResult = await finalizeMeetingOnce(runSecond)

        assert.deepEqual(secondResult, { ranMeetingFinalization: false })
        assert.equal(callCount, 1, "the second (losing) caller's function must never run")

        first.resolve("meeting processed")
        const firstResult = await firstResultPromise
        assert.deepEqual(firstResult, { ranMeetingFinalization: true, result: "meeting processed" })
    })

    test("a call after the previous one has fully settled runs normally (the flag resets)", async () => {
        const result = await finalizeMeetingOnce(() => Promise.resolve("ok"))
        assert.deepEqual(result, { ranMeetingFinalization: true, result: "ok" })

        // A genuinely new meeting-end event, well after the first settled — must not be
        // treated as still in-flight.
        let ranSecond = false
        const secondResult = await finalizeMeetingOnce(() => {
            ranSecond = true
            return Promise.resolve("ok again")
        })
        assert.equal(ranSecond, true)
        assert.deepEqual(secondResult, { ranMeetingFinalization: true, result: "ok again" })
    })

    test("a rejected run resolves to {ranMeetingFinalization: true, error} rather than throwing, and still clears the flag for the next call", async () => {
        const result = await finalizeMeetingOnce(() => Promise.reject({ errorCode: "013", errorMessage: "No meetings found." }))
        assert.deepEqual(result, {
            ranMeetingFinalization: true,
            error: { errorCode: "013", errorMessage: "No meetings found." },
        })

        // Flag must be clear even after a rejection, or every meeting after a failure
        // would be silently dropped forever.
        let ranNext = false
        await finalizeMeetingOnce(() => {
            ranNext = true
            return Promise.resolve("ok")
        })
        assert.equal(ranNext, true)
    })
})
