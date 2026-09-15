/**
 * @description State Factory: Returns a pristine, isolated meeting state block.
 * @param {MeetingSoftware} meetingSoftware
 * @param {Platform} platform
 * @returns {ContentScriptState}
 */
function createContentScriptState(meetingSoftware, platform) {
    return {
        meetingSoftware: meetingSoftware,
        platform: platform,
        userName: "You",
        transcript: [],
        chatMessages: [],
        liveCommentNotes: [],
        stateTranscriptBlock: {
            timestamp: "",
            mutationTargetElement: null,
            personName: "",
            transcriptTextBuffer: "",

        },
        // Left unset until the platform's "meeting started" detection actually confirms
        // the user has joined (see googleMeetRoutines()/teamsMeetingRoutines()/
        // zoomMeetingRoutines()). Stamping "now" here would make renderFab()'s initial
        // storage read (which runs before that detection resolves) start the FAB's live
        // timer immediately — including while still on the pre-join lobby screen.
        meetingStartTimestamp: null,
        meetingTitle: document.title,
        transcriptTargetNode: null,
        transcriptObserver: null,
        chatMessagesTargetNode: null,
        chatMessagesObserver: null,
        isTranscriptDomErrorCaptured: false,
        isChatMessagesDomErrorCaptured: false,
        hasMeetingStarted: false,
        hasMeetingEnded: false,
        zoomIframe: null,
        extensionStatusJSON: {
            status: 200,
            message: "<strong>TranscripTonic is running</strong> <br /> Do not turn off captions"
        }
    }
}

/**
 * @description Fetches extension status from GitHub and saves to chrome storage. Defaults to 200, if remote server is unavailable.
 * @param {ContentScriptState} state
 */
function checkExtensionStatus(state) {
    return new Promise((resolve, reject) => {
        // Set default value as 200
        state.extensionStatusJSON = {
            status: 200,
            message: state.meetingSoftware ? NOTIFICATION_PLATFORM_CONFIGS[state.platform].notificationText : ""
        }

        // https://stackoverflow.com/a/42518434
        fetch(
            state.meetingSoftware ? NOTIFICATION_PLATFORM_CONFIGS[state.platform].statusUrl : "",
            { cache: "no-store" }
        )
            .then((response) => response.json())
            .then((result) => {
                const minVersion = result.minVersion

                // Disable extension if version is below the min version
                if (!meetsMinVersion(chrome.runtime.getManifest().version, minVersion)) {
                    state.extensionStatusJSON.status = 400
                    state.extensionStatusJSON.message = `<strong>TranscripTonic is not running</strong> <br /> Please update to v${minVersion} by following <a href="https://github.com/vivek-nexus/transcriptonic/wiki/Manually-update-TranscripTonic" target="_blank">these instructions</a>`
                }
                else {
                    // Update status based on response
                    state.extensionStatusJSON.status = result.status
                    state.extensionStatusJSON.message = result.message
                    state.extensionStatusJSON.showBetaMessage = (result.showBetaMessage === true)
                }

                console.log("Extension status fetched and saved")
                resolve("Extension status fetched and saved")
            })
            .catch((err) => {
                console.error(err)
                reject("Could not fetch extension status")

                logError(state, "008", err)
            })
    })
}

/**
 * @description Overwrite state to chrome storage
 * @param {ContentScriptState} state
 * @param {Array<"meetingSoftware"  | "meetingTitle" | "meetingStartTimestamp" | "transcript" | "chatMessages" | "liveCommentNotes">} keys
 * @param {boolean} sendDownloadMessage
 */
function overWriteChromeStorage(state, keys, sendDownloadMessage) {
    const objectToSave = {}
    if (keys.includes("meetingSoftware")) objectToSave.meetingSoftware = state.meetingSoftware
    if (keys.includes("meetingTitle")) objectToSave.meetingTitle = state.meetingTitle
    if (keys.includes("meetingStartTimestamp")) objectToSave.meetingStartTimestamp = state.meetingStartTimestamp
    if (keys.includes("transcript")) objectToSave.transcript = state.transcript
    if (keys.includes("chatMessages")) objectToSave.chatMessages = state.chatMessages
    if (keys.includes("liveCommentNotes")) objectToSave.liveCommentNotes = state.liveCommentNotes

    chrome.storage.local.set(objectToSave, function () {
        if (sendDownloadMessage) {
            /** @type {ExtensionMessage} */
            const message = { type: "meeting_ended" }
            chrome.runtime.sendMessage(message, (responseUntyped) => {
                const response = /** @type {ExtensionResponse} */ (responseUntyped)
                if ((!response.success)) {
                    const parsedError = /** @type {ErrorObject} */ (response.message)
                    if (parsedError.errorCode === "010") {
                        console.error(parsedError.errorMessage)
                    }
                }
            })
        }
    })
}

/**
 * @description Attempts to recover last meeting to the best possible extent.
 */
function recoverLastMeeting() {
    return new Promise((resolve, reject) => {
        /** @type {ExtensionMessage} */
        const message = {
            type: "recover_last_meeting",
        }
        chrome.runtime.sendMessage(message, function (responseUntyped) {
            const response = /** @type {ExtensionResponse} */ (responseUntyped)
            if (response.success) {
                resolve("Last meeting recovered successfully or recovery not needed")
            }
            else {
                reject(response.message)
            }
        })
    })
}

/**
 * @description Efficiently waits until the element of the specified selector and textContent appears in the DOM. Polls only on animation frame change
 * @param {string} selector
 * @param {string | RegExp} [text]
 * @param {HTMLIFrameElement | null} iframe
 */
async function waitForElement(selector, text, iframe = null) {
    // If an iframe is provided, use its content document; otherwise, default to top-level document
    const targetDoc = iframe ? /** @type {Document} */ (iframe.contentDocument) : document

    if (text) {
        // loops for every animation frame change, until the required element is found
        while (!Array.from(targetDoc.querySelectorAll(selector)).find(element => element.textContent === text)) {
            await new Promise((resolve) => requestAnimationFrame(resolve))
        }
    }
    else {
        // loops for every animation frame change, until the required element is found
        while (!targetDoc.querySelector(selector)) {
            await new Promise((resolve) => requestAnimationFrame(resolve))
        }
    }
    return targetDoc.querySelector(selector)
}

/**
 * @description Single, flat polling monitor that handles initial attachment and all re-attachments.
 * @param {ContentScriptState} state
 */
function startTranscriptMonitor(state) {
    state.transcriptTargetNode = null
    /**
     * @type {number | undefined}
     */
    let monitorInterval = undefined

    // Call immediately
    transcriptMonitor()
    // Start monitoring
    monitorInterval = setInterval(transcriptMonitor, 2000)

    function transcriptMonitor() {
        if (state.hasMeetingEnded) {
            clearInterval(monitorInterval)
            return
        }

        let activeNode

        switch (state.platform) {
            case "google_meet":
                activeNode = document.querySelector(SELECTORS_GOOGLE_MEET.TRANSCRIPT_REGION)
                break
            case "teams":
                activeNode = document.querySelector(SELECTORS_TEAMS.CAPTIONS_REGION)
                break
            case "zoom":
                const iframe = /** @type {Document} */ (/** @type {HTMLIFrameElement} */(document.querySelector(SELECTORS_ZOOM.IFRAME))?.contentDocument)
                activeNode = iframe.querySelector(SELECTORS_ZOOM.TRANSCRIPT_CONTAINER)
                break
            default:
                break
        }

        if (!activeNode) {
            return
        }

        // If the active node is new, replaced, or disconnected, re-attach the observer
        if (!state.transcriptTargetNode || activeNode !== state.transcriptTargetNode || !state.transcriptTargetNode.isConnected) {
            if (!state.transcriptTargetNode) {
                console.log("Captions region detected. Attaching observer...")
            }
            else if (activeNode !== state.transcriptTargetNode) {
                console.log("Captions region replaced. Re-attaching observer...")
            }

            // Flush any in-flight buffer to prevent losing text on transitions
            pushBufferToTranscript(state)
            state.stateTranscriptBlock.personName = ""
            state.stateTranscriptBlock.transcriptTextBuffer = ""
            state.stateTranscriptBlock.timestamp = ""

            if (state.transcriptObserver) {
                state.transcriptObserver.disconnect()
            }

            state.transcriptTargetNode = activeNode
            state.transcriptObserver = new MutationObserver((mutations) => {
                switch (state.platform) {
                    case "google_meet":
                        transcriptMutationCallbackGoogleMeet(state, mutations)
                        break
                    case "teams":
                        transcriptMutationCallbackTeams(state, mutations)
                        break
                    case "zoom":
                        transcriptMutationCallbackZoom(state, mutations)
                        break
                    default:
                        break
                }
            })
            state.transcriptObserver.observe(activeNode, mutationConfig)

            // If specified, hide the whole transcript node
            chrome.storage.sync.get(["hideCaptions"], function (resultSyncUntyped) {
                const resultSync = /** @type {ResultSync} */ (resultSyncUntyped)
                if ((resultSync.hideCaptions === true) && (state.transcriptTargetNode)) {
                    if (state.platform === "teams") {
                        waitForElement(SELECTORS_TEAMS.CAPTIONS_REGION_WRAPPER).then((element) => {
                            element?.setAttribute("style", `height:40px`)
                        })
                        waitForElement(SELECTORS_TEAMS.CAPTIONS_REGION).then((element) => {
                            element?.setAttribute("style", `opacity:0`)
                        })
                    }
                    else {
                        state.transcriptTargetNode.setAttribute("style", `opacity:0; height:0px`)
                    }
                }
            })
        }
    }
}

/**
 * @param {ContentScriptState} state
 */
function broadcastLiveBuffer(state) {
    /** @type {ExtensionMessage} */
    const message = {
        type: "broadcast_live_buffer",
        stateTranscriptBlock: {
            mutationTargetElement: null,
            personName: state.stateTranscriptBlock.personName,
            timestamp: state.stateTranscriptBlock.timestamp,
            transcriptTextBuffer: state.stateTranscriptBlock.transcriptTextBuffer
        }
    }
    chrome.runtime.sendMessage(message, () => { })
}

/**
 * @param {ContentScriptState} state
 */
function pushBufferToTranscript(state) {
    if ((state.stateTranscriptBlock.personName !== "") && (state.stateTranscriptBlock.transcriptTextBuffer !== "")) {
        state.transcript.push({
            "personName": state.stateTranscriptBlock.personName === "You" ? state.userName : state.stateTranscriptBlock.personName,
            "timestamp": state.stateTranscriptBlock.timestamp,
            "transcriptText": state.stateTranscriptBlock.transcriptTextBuffer
        })
        overWriteChromeStorage(state, ["transcript"], false)
    }
}

/**
 * @description Waits and grabs meeting title from document title
 * @param {ContentScriptState} state
 */
function updateMeetingTitle(state) {
    setTimeout(() => {
        // NON CRITICAL DOM DEPENDENCY
        state.meetingTitle = document.title
        overWriteChromeStorage(state, ["meetingTitle"], false)
    }, 5000)
}

function pulseStatus() {
    const statusActivityCSS = `position: fixed;
    top: 0px;
    width: 100%;
    height: 4px;
    z-index: 100;
    transition: background-color 0.3s ease-in
  `
    /** @type {HTMLDivElement | null}*/
    let activityStatus = document.querySelector(`#transcriptonic-status`)
    if (!activityStatus) {
        let html = document.querySelector("html")
        activityStatus = document.createElement("div")
        activityStatus.setAttribute("id", "transcriptonic-status")
        activityStatus.style.cssText = `background-color: #2A9ACA; ${statusActivityCSS}`
        html?.appendChild(activityStatus)
    }
    else {
        activityStatus.style.cssText = `background-color: #2A9ACA; ${statusActivityCSS}`
    }

    setTimeout(() => {
        activityStatus.style.cssText = `background-color: transparent; ${statusActivityCSS}`
    }, 3000)
}

/** Handle for the FAB's live elapsed-timer interval, shared between renderFab() and unmountFab(). */
let fabTimerIntervalId = null

/**
 * @description Formats elapsed seconds since `startIso` as zero-padded H:MM:SS (e.g. "0:00:23", "1:04:12").
 * @param {string} startIso
 */
function formatElapsedTime(startIso) {
    const elapsedSeconds = Math.max(0, Math.floor((Date.now() - new Date(startIso).getTime()) / 1000))
    const h = Math.floor(elapsedSeconds / 3600)
    const m = Math.floor((elapsedSeconds % 3600) / 60)
    const s = elapsedSeconds % 60
    const pad = (/** @type {number} */ n) => String(n).padStart(2, "0")
    return `${h}:${pad(m)}:${pad(s)}`
}

/**
 * @param {HTMLElement} fab
 * @param {string} startIso
 */
function startFabTimer(fab, startIso) {
    if (fabTimerIntervalId) clearInterval(fabTimerIntervalId)
    const timerText = fab.querySelector("#fab-timer-text")
    const tick = () => { if (timerText) timerText.textContent = formatElapsedTime(startIso) }
    tick()
    fabTimerIntervalId = setInterval(tick, 1000)
}

/**
 * @description Toggles the FAB between its recording and not-recording looks (brand
 * segment color/mark, timer icon, timer text opacity). When switching to not-recording,
 * freezes/stops the live timer at 0:00:00 per the Figma "not record" state.
 * @param {boolean} isRecording
 */
function setFabRecordingState(isRecording) {
    const fab = /** @type {HTMLElement | null} */ (document.querySelector("#transcriptonic-fab"))
    if (!fab) return

    const brandSegment = /** @type {HTMLElement} */ (fab.querySelector("#fab-brand-segment"))
    const brandMark = /** @type {HTMLImageElement} */ (fab.querySelector("#fab-brand-mark"))
    const timerIcon = /** @type {HTMLImageElement} */ (fab.querySelector("#fab-timer-icon"))
    const timerText = /** @type {HTMLElement} */ (fab.querySelector("#fab-timer-text"))

    if (brandSegment) brandSegment.style.backgroundColor = isRecording ? "#f34f16" : "#a6a6a6"
    if (brandMark) brandMark.src = isRecording ? FAB_BRAND_MARK_URL : FAB_BRAND_MARK_INACTIVE_URL
    if (timerIcon) timerIcon.src = isRecording ? FAB_RECORDING_ICON_URL : FAB_PLAY_ICON_URL
    if (timerText) timerText.style.color = isRecording ? "white" : "rgba(255,255,255,0.38)"

    if (!isRecording) {
        if (fabTimerIntervalId) {
            clearInterval(fabTimerIntervalId)
            fabTimerIntervalId = null
        }
        if (timerText) timerText.textContent = "0:00:00"
    }

    const timerSegment = /** @type {HTMLElement} */ (fab.querySelector("#fab-timer-segment"))
    if (timerSegment) {
        if (isRecording) {
            timerSegment.removeAttribute("role")
            timerSegment.removeAttribute("tabindex")
            timerSegment.removeAttribute("aria-label")
            timerSegment.style.cursor = "default"
        }
        else {
            timerSegment.setAttribute("role", "button")
            timerSegment.setAttribute("tabindex", "0")
            timerSegment.setAttribute("aria-label", "Retry starting capture")
            timerSegment.style.cursor = "pointer"
        }
    }
}

/**
 * @description Marks capture as failed (idempotent) and flips the FAB to its
 * not-recording look. Called both from the ~15s deadline check and from the
 * narrower DOM-race error paths in each platform's caption-attach chain.
 * @param {ContentScriptState} state
 */
function markCaptureFailed(state) {
    if (state.isTranscriptDomErrorCaptured) return
    state.isTranscriptDomErrorCaptured = true
    setFabRecordingState(false)
}

/**
 * @description Marks capture as recovered (idempotent) and flips the FAB back to
 * its recording look. Called once a caption-attach attempt (initial or retried)
 * actually succeeds.
 * @param {ContentScriptState} state
 */
function markCaptureRecovered(state) {
    if (!state.isTranscriptDomErrorCaptured) return
    state.isTranscriptDomErrorCaptured = false
    setFabRecordingState(true)
}

/**
 * @description Schedules the ~15s deadline used to detect the common "auto-record
 * silently never attaches" case, since waitForElement() polls forever and never
 * times out or rejects on its own. If no transcript target node has been found by
 * the deadline, treats capture as failed.
 * @param {ContentScriptState} state
 */
function scheduleCaptureFailureDeadline(state) {
    setTimeout(() => {
        if (!state.transcriptTargetNode && !state.hasMeetingEnded) {
            markCaptureFailed(state)
        }
    }, 15000)
}

/**
 * @param {() => void} [onRetryCapture] Called when the user clicks/activates the
 * timer segment to manually retry starting capture (only meaningful while the FAB
 * is in its not-recording look — role/tabindex are only exposed then).
 */
function renderFab(onRetryCapture) {
    const fabCss = `
        position: fixed;
        top: 50%;
        bottom: 50%;
        right: 8px;
        height: 40px;
        width: auto;
        border-radius: 8px;
        z-index: 100;
        display: flex;
        align-items: center;
        box-shadow: 0px 8px 12px rgba(0,0,0,0.24);
        cursor: grab;
        border: none;
        padding: 0;
        overflow: hidden;
    `

    const html = document.querySelector("html")
    const fab = document.createElement("div")
    fab.id = "transcriptonic-fab"
    fab.title = "TranscripTonic"
    fab.style.cssText = fabCss

    fab.innerHTML = `
        <div id="fab-brand-segment" role="button" tabindex="0" aria-label="Open TranscripTonic" style="background-color: #f34f16; height: 100%; display: flex; align-items: center; padding: 8px 12px; flex-shrink: 0; cursor: pointer;">
            <img id="fab-brand-mark" src="${FAB_BRAND_MARK_URL}" alt="" draggable="false" style="width: 44px; height: 20px; object-fit: contain; display: block;" />
        </div>

        <div id="fab-timer-segment" style="background-color: black; height: 100%; display: flex; align-items: center; gap: 4px; padding: 8px 12px 8px 8px; flex-shrink: 0;">
            <img id="fab-timer-icon" src="${FAB_RECORDING_ICON_URL}" alt="" draggable="false" style="width: 24px; height: 24px; display: block;" />
            <span id="fab-timer-text" style="color: white; font-weight: 700; font-size: 20px; line-height: 28px; white-space: nowrap; font-variant-numeric: tabular-nums; display: inline-block; min-width: 8ch; text-align: left; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif;">0:00:00</span>
        </div>

        <div id="fab-note-button" role="button" tabindex="0" aria-label="Add a note" title="Add a note" style="background-color: #f6f6f6; width: 48px; height: 100%; flex-shrink: 0; display: flex; align-items: center; justify-content: center; padding: 8px; cursor: pointer;">
            <img src="${FAB_NOTE_ICON_URL}" alt="" draggable="false" style="width: 24px; height: 24px; display: block;" />
        </div>

        <div id="fab-menu-button" role="button" tabindex="0" aria-label="More options" title="More options" style="background-color: #f6f6f6; width: 48px; height: 100%; flex-shrink: 0; display: flex; align-items: center; justify-content: center; padding: 8px; cursor: pointer;">
            <img src="${FAB_MENU_ICON_URL}" alt="" draggable="false" style="width: 24px; height: 24px; display: block;" />
        </div>
    `

    html?.appendChild(fab)
    makeVerticallyDraggable(fab)

    const brandSegment = /** @type {HTMLElement} */ (fab.querySelector("#fab-brand-segment"))
    const timerSegment = /** @type {HTMLElement} */ (fab.querySelector("#fab-timer-segment"))
    const noteButton = /** @type {HTMLElement} */ (fab.querySelector("#fab-note-button"))
    const menuButton = /** @type {HTMLElement} */ (fab.querySelector("#fab-menu-button"))

    function openSidePanel() {
        /** @type {ExtensionMessage} */
        const message = { type: "open_side_panel" }
        chrome.runtime.sendMessage(message, () => { })
    }

    brandSegment.addEventListener("click", openSidePanel)
    brandSegment.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
            e.preventDefault()
            openSidePanel()
        }
    })

    noteButton.addEventListener("mouseenter", () => { noteButton.style.filter = "brightness(0.95)" })
    noteButton.addEventListener("mouseleave", () => { noteButton.style.filter = "none" })
    noteButton.addEventListener("click", (e) => {
        e.stopPropagation()
        toggleNotePanel(fab)
    })
    noteButton.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
            e.preventDefault()
            e.stopPropagation()
            toggleNotePanel(fab)
        }
    })

    // Only meaningful in the not-recording look (setFabRecordingState toggles the
    // role/tabindex that make this segment focusable) — onRetryCapture itself also
    // no-ops while already recording, via its own isTranscriptDomErrorCaptured guard.
    timerSegment.addEventListener("click", (e) => {
        e.stopPropagation()
        onRetryCapture?.()
    })
    timerSegment.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
            e.preventDefault()
            e.stopPropagation()
            onRetryCapture?.()
        }
    })

    // Menu is present per the design but its behavior isn't defined yet — intentionally
    // a no-op beyond hover feedback until a follow-up defines what "more options" contains.
    menuButton.addEventListener("mouseenter", () => { menuButton.style.filter = "brightness(0.95)" })
    menuButton.addEventListener("mouseleave", () => { menuButton.style.filter = "none" })
    menuButton.addEventListener("click", (e) => { e.stopPropagation() })
    menuButton.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
            e.preventDefault()
            e.stopPropagation()
        }
    })

    // 1. Initial storage query on load
    chrome.storage.local.get(["meetingStartTimestamp"], (resultUntyped) => {
        const result = /** @type {ResultLocal} */ (resultUntyped)
        if (result.meetingStartTimestamp) startFabTimer(fab, result.meetingStartTimestamp)
    })

    // 2. Storage event listener for ongoing updates
    chrome.storage.onChanged.addListener((changes, areaName) => {
        if (areaName === "local" && changes.meetingStartTimestamp) {
            startFabTimer(fab, changes.meetingStartTimestamp.newValue)
        }
    })
}

/**
 * @description Lazily creates the (initially hidden) note-capture panel, a sibling of the
 * FAB rather than a child of it, so it can be positioned independently and isn't affected
 * by the FAB's drag handling. Idempotent — returns the existing panel on repeat calls.
 * @returns {HTMLElement}
 */
function renderNotePanel() {
    const existing = document.querySelector("#transcriptonic-note-panel")
    if (existing) return /** @type {HTMLElement} */ (existing)

    const panelCss = `
        position: fixed;
        display: none;
        flex-direction: column;
        gap: 8px;
        width: 220px;
        padding: 10px;
        border-radius: 8px;
        z-index: 100;
        background-color: #f6f6f6;
        box-shadow: 0px 8px 12px rgba(0,0,0,0.24);
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif;
    `

    const panel = document.createElement("div")
    panel.id = "transcriptonic-note-panel"
    panel.style.cssText = panelCss
    panel.innerHTML = `
        <textarea id="transcriptonic-note-input" placeholder="Add a note…" rows="3" style="
            resize: none;
            border: none;
            outline: none;
            border-radius: 8px;
            padding: 8px;
            background-color: white;
            color: #1f1f1f;
            font-size: 13px;
            font-family: inherit;
        "></textarea>
        <div style="display: flex; align-items: center; justify-content: flex-end; gap: 8px;">
            <span id="transcriptonic-note-confirmation" style="display: none; color: #2e7d32; font-size: 12px;">Saved</span>
            <button id="transcriptonic-note-save" style="
                border: none;
                border-radius: 8px;
                padding: 6px 12px;
                background-color: #f34f16;
                color: white;
                font-size: 12px;
                font-weight: 600;
                cursor: pointer;
            ">Save</button>
        </div>
    `

    document.querySelector("html")?.appendChild(panel)

    const textarea = /** @type {HTMLTextAreaElement} */ (panel.querySelector("#transcriptonic-note-input"))
    const saveButton = /** @type {HTMLButtonElement} */ (panel.querySelector("#transcriptonic-note-save"))
    const confirmation = /** @type {HTMLElement} */ (panel.querySelector("#transcriptonic-note-confirmation"))

    function saveNote() {
        const text = textarea.value.trim()
        if (!text) {
            closeNotePanel()
            return
        }
        chrome.storage.local.get(["liveCommentNotes"], (resultUntyped) => {
            const result = /** @type {ResultLocal} */ (resultUntyped)
            const liveCommentNotes = (result.liveCommentNotes || []).concat([
                { timestamp: new Date().toISOString(), text }
            ])
            chrome.storage.local.set({ liveCommentNotes }, () => {
                textarea.value = ""
                confirmation.style.display = "inline"
                setTimeout(() => {
                    confirmation.style.display = "none"
                    closeNotePanel()
                }, 800)
            })
        })
    }

    saveButton.addEventListener("click", (e) => {
        e.stopPropagation()
        saveNote()
    })

    // Don't let typing/clicking in the textarea reach the FAB's drag/click handling —
    // the panel is a sibling of the FAB, not a descendant, so this is only needed for
    // mousedown/click bubbling up to `document`'s click-away listener below.
    textarea.addEventListener("mousedown", (e) => e.stopPropagation())
    textarea.addEventListener("click", (e) => e.stopPropagation())
    textarea.addEventListener("keydown", (e) => {
        if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault()
            saveNote()
        }
        else if (e.key === "Escape") {
            closeNotePanel()
        }
        e.stopPropagation()
    })

    // Click-away to close
    document.addEventListener("mousedown", (e) => {
        const target = /** @type {Element} */ (e.target)
        if (panel.style.display !== "none" && !panel.contains(target) && !target.closest("#fab-note-button")) {
            closeNotePanel()
        }
    })

    return panel
}

function closeNotePanel() {
    const panel = document.querySelector("#transcriptonic-note-panel")
    if (panel) /** @type {HTMLElement} */ (panel).style.display = "none"
}

/**
 * @param {HTMLElement} fab
 */
function toggleNotePanel(fab) {
    const panel = renderNotePanel()
    const isOpen = panel.style.display !== "none"
    if (isOpen) {
        closeNotePanel()
        return
    }

    const fabRect = fab.getBoundingClientRect()
    panel.style.top = `${fabRect.bottom + 8}px`
    panel.style.right = `${window.innerWidth - fabRect.right}px`
    panel.style.display = "flex"

    const textarea = /** @type {HTMLTextAreaElement} */ (panel.querySelector("#transcriptonic-note-input"))
    textarea.focus()
}

/**
 * @param {HTMLElement} fab
 */
function makeVerticallyDraggable(fab) {
    let isDragging = false
    let startY = 0
    let initialTop = 0
    let hasMoved = false

    const onPointerDown = (e) => {
        isDragging = true
        hasMoved = false

        const clientY = e.touches ? e.touches[0].clientY : e.clientY
        startY = clientY
        initialTop = fab.getBoundingClientRect().top

        // Attach movement listeners to document so fast drags aren't lost
        document.addEventListener("mousemove", onPointerMove)
        document.addEventListener("mouseup", onPointerUp)
        document.addEventListener("touchmove", onPointerMove, { passive: false })
        document.addEventListener("touchend", onPointerUp)
    }

    const onPointerMove = (e) => {
        if (!isDragging) return

        const clientY = e.touches ? e.touches[0].clientY : e.clientY
        const deltaY = clientY - startY

        // Threshold (3px) to differentiate click from drag
        if (Math.abs(deltaY) > 3) {
            hasMoved = true
            if (e.cancelable) e.preventDefault() // Prevent scrolling on touch
        }

        let newTop = initialTop + deltaY

        // Bound vertical position inside the visible viewport
        const maxTop = window.innerHeight - fab.offsetHeight
        newTop = Math.max(0, Math.min(newTop, maxTop))

        fab.style.top = `${newTop}px`
    }

    const onPointerUp = () => {
        isDragging = false
        document.removeEventListener("mousemove", onPointerMove)
        document.removeEventListener("mouseup", onPointerUp)
        document.removeEventListener("touchmove", onPointerMove)
        document.removeEventListener("touchend", onPointerUp)
    }

    fab.addEventListener("mousedown", onPointerDown)
    fab.addEventListener("touchstart", onPointerDown, { passive: true })

    // Block the 'click' event if the user dragged the button
    fab.addEventListener("click", (e) => {
        if (hasMoved) {
            e.stopImmediatePropagation()
            e.preventDefault()
            hasMoved = false
        }
    }, true) // Capture phase ensures it runs before the side-panel click handler
}

function unmountFab() {
    if (fabTimerIntervalId) {
        clearInterval(fabTimerIntervalId)
        fabTimerIntervalId = null
    }
    const fab = document.querySelector("#transcriptonic-fab")
    if (fab) {
        fab.remove()
    }
    const notePanel = document.querySelector("#transcriptonic-note-panel")
    if (notePanel) {
        notePanel.remove()
    }
}

/**
   * @description Logs active transcript to console
   * @param {ContentScriptState} state
   */
function logTranscriptToConsole(state) {
    if (state.stateTranscriptBlock.transcriptTextBuffer.length > 125) {
        console.log(state.stateTranscriptBlock.transcriptTextBuffer.slice(0, 50) + "   ...   " + state.stateTranscriptBlock.transcriptTextBuffer.slice(-50))
    }
    else {
        console.log(state.stateTranscriptBlock.transcriptTextBuffer)
    }
}

/**
   * @description Logs anonymous errors to a Google sheet for swift debugging
   * @param {ContentScriptState} state
   * @param {string} code
   * @param {any} err
   */
function logError(state, code, err) {
    fetch(`${LOG_ERROR_SCRIPT_URL}?version=${chrome.runtime.getManifest().version}&code=${code}&error=${encodeURIComponent(err)}&meetingSoftware=${state.meetingSoftware}`, { mode: "no-cors" })
}

/**
   * @description Checks if the installed extension version meets the minimum required version.
   * @param {string} oldVer
   * @param {string} newVer
   */
function meetsMinVersion(oldVer, newVer) {
    const oldParts = oldVer.split('.')
    const newParts = newVer.split('.')
    for (var i = 0; i < newParts.length; i++) {
        const a = ~~newParts[i] // parse int
        const b = ~~oldParts[i] // parse int
        if (a > b) return false
        if (a < b) return true
    }
    return true
}
