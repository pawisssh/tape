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
