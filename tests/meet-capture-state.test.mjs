import { test } from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import vm from "node:vm"

const source = fs.readFileSync(new URL("../extension/content-scripts/google-meet/utils.js", import.meta.url), "utf8")

function loadMeetUtils() {
    const sandbox = { console }
    vm.createContext(sandbox)
    new vm.Script(source, { filename: "google-meet/utils.js" }).runInContext(sandbox)
    return sandbox
}

const { isCapturingGoogleMeet } = loadMeetUtils()

test("captions turned on after joining count as capturing once the observer attaches", () => {
    assert.equal(isCapturingGoogleMeet({ captionsToggle: "off", isObserverAttached: true, hasCaptionArrived: false }), false)
    assert.equal(isCapturingGoogleMeet({ captionsToggle: "on", isObserverAttached: false, hasCaptionArrived: false }), false)
    assert.equal(isCapturingGoogleMeet({ captionsToggle: "on", isObserverAttached: true, hasCaptionArrived: false }), true)
})

// The captions region can exist while CC is off, so an attached observer alone must not
// show the FAB as recording.
test("captions turned off mid-meeting stop capture even with captions captured earlier", () => {
    assert.equal(isCapturingGoogleMeet({ captionsToggle: "off", isObserverAttached: true, hasCaptionArrived: true }), false)
})

test("with the CC toggle out of sight, an arrived caption stands in for captions on", () => {
    assert.equal(isCapturingGoogleMeet({ captionsToggle: "unknown", isObserverAttached: true, hasCaptionArrived: false }), false)
    assert.equal(isCapturingGoogleMeet({ captionsToggle: "unknown", isObserverAttached: true, hasCaptionArrived: true }), true)
})

const { classifyCaptionsToggleGoogleMeet } = (() => {
    const sandbox = { console }
    vm.createContext(sandbox)
    const config = fs.readFileSync(new URL("../extension/content-scripts/google-meet/config.js", import.meta.url), "utf8")
    new vm.Script(`${config}\n${source}`, { filename: "google-meet/config+utils.js" }).runInContext(sandbox)
    return sandbox
})()

test("the newer translate_cc toggle is read from aria-pressed only", () => {
    assert.equal(classifyCaptionsToggleGoogleMeet("translate_cc", "true"), "on")
    assert.equal(classifyCaptionsToggleGoogleMeet("translate_cc", "false"), "off")
    // Same icon on and off: without aria-pressed, never guess (the "c" shortcut toggles).
    assert.equal(classifyCaptionsToggleGoogleMeet("translate_cc", null), "unknown")
})

test("the older CC toggle falls back to its icon when aria-pressed is missing", () => {
    assert.equal(classifyCaptionsToggleGoogleMeet("closed_caption_off", null), "off")
    assert.equal(classifyCaptionsToggleGoogleMeet("closed_caption", null), "on")
    assert.equal(classifyCaptionsToggleGoogleMeet("closed_caption_off", "true"), "on")
})

test("icons that aren't a captions toggle read as unknown", () => {
    assert.equal(classifyCaptionsToggleGoogleMeet("call_end", "true"), "unknown")
    assert.equal(classifyCaptionsToggleGoogleMeet(null, null), "unknown")
})

function loadTurnOn(toggleReadings) {
    const presses = []
    const sandbox = {
        console: { log() {}, error() {} },
        setTimeout: (resolve) => resolve(),
        dispatchKeyboardShortcut: (key) => presses.push(key),
    }
    vm.createContext(sandbox)
    new vm.Script(source, { filename: "google-meet/utils.js" }).runInContext(sandbox)
    let reads = 0
    sandbox.readCaptionsToggleGoogleMeet = () => toggleReadings[Math.min(reads++, toggleReadings.length - 1)]
    return { turnOn: sandbox.turnOnCaptionsGoogleMeet, presses }
}

test("turning captions on never presses C unless the toggle reads off", async () => {
    for (const reading of ["on", "unknown"]) {
        const { turnOn, presses } = loadTurnOn([reading])
        await turnOn()
        assert.equal(presses.length, 0, reading)
    }
})

test("turning captions on retries C until the toggle reads on", async () => {
    const { turnOn, presses } = loadTurnOn(["off", "off", "on"])
    await turnOn()
    assert.deepEqual(presses, ["c", "c"])
})

test("turning captions on gives up after 10 presses, or at once when told to stop", async () => {
    const stuck = loadTurnOn(["off"])
    await stuck.turnOn()
    assert.equal(stuck.presses.length, 10)

    const stopped = loadTurnOn(["off"])
    await stopped.turnOn(() => true)
    assert.equal(stopped.presses.length, 0)
})

test("a second turn-on while one is running doesn't press C again", async () => {
    const { turnOn, presses } = loadTurnOn(["off"])
    await Promise.all([turnOn(), turnOn()])
    assert.equal(presses.length, 10)
})
