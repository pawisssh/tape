let isZoomInjected = false

setInterval(() => {
    // Meeting page
    const zoomUrlPattern = /^https:\/\/app\.zoom\.us\/wc\/\d+\/.+$/
    const isZoomUrlMatching = zoomUrlPattern.test(location.href)

    // On the meeting page and main zoom function is not running, inject it
    // This won't cause multiple main zoom injections into the current meeting because when the previous meeting ends, all UI elements are gone, destroying the corresponding event listeners
    if (isZoomUrlMatching && !isZoomInjected) {
        initZoom()
        isZoomInjected = true
    }
    // Set flag to false when meetings ends and the tab navigates to a non matching URL, or simply the current URL is a non meeting URL
    if (!isZoomUrlMatching) {
        isZoomInjected = false
    }
}, 2000)

function initZoom() {
    // Attempt to recover last meeting, if any. Abort if it takes more than 2 seconds to prevent current meeting getting messed up.
    Promise.race([
        recoverLastMeeting(),
        new Promise((_, reject) =>
            setTimeout(() => reject({ errorCode: "016", errorMessage: "Recovery timed out" }), 2000)
        )
    ]).
        catch((error) => {
            const parsedError = /** @type {ErrorObject} */ (error)
            if ((parsedError.errorCode !== "013") && (parsedError.errorCode !== "014")) {
                console.error(parsedError.errorMessage)
            }
        }).
        finally(() => {
            // Initialise new state for current meeting
            const state = createContentScriptState("Zoom", "zoom")
            // Push fresh state to chrome storage
            overWriteChromeStorage(state, ["meetingSoftware", "meetingStartTimestamp", "meetingTitle", "transcript", "chatMessages", "liveCommentNotes"], false)

            checkExtensionStatus(state).finally(() => {
                console.log("Extension status " + state.extensionStatusJSON.status)

                // Skip starting capture routines entirely when the user has turned capture off.
                chrome.storage.sync.get(["operationMode"], function (resultSyncUntyped) {
                    const resultSync = /** @type {ResultSync} */ (resultSyncUntyped)
                    if (resultSync.operationMode === "off") {
                        console.log("Capture mode is off, not starting capture routines")
                        return
                    }

                    // Enable extension functions only if status is 200
                    if (state.extensionStatusJSON.status === 200) {

                        zoomMeetingRoutines(state)
                    }
                    else {
                        // Show downtime message as extension status is 400
                        showNotificationZoom(state.extensionStatusJSON)
                    }
                })
            })
        })
}

/**
 * @description Waits for the captions container to appear inside the meeting iframe
 * and attaches the transcript MutationObserver. Extracted as its own function so it
 * can be re-invoked as a manual retry when auto-record fails to attach — see
 * attemptManualCaptureRetryZoom(). Safe to call again even while a prior call is
 * still pending (e.g. hung in waitForElement(), which never times out on its own):
 * the success path only acts if state.transcriptTargetNode isn't already set, so a
 * stale/duplicate resolution is a no-op instead of double-attaching.
 * @param {ContentScriptState} state
 * @param {HTMLIFrameElement} iframe
 */
function attachTranscriptListenerZoom(state, iframe) {
    // Wait for transcript node to be visible
    return waitForElement(SELECTORS_ZOOM.TRANSCRIPT_CONTAINER, undefined, iframe).
        then((element) => {
            console.log("Found captions container")
            if (!element) {
                throw new Error("Transcript element not found in DOM")
            }
            // Already attached by a prior (or concurrently retried) attempt — avoid
            // registering a second MutationObserver on the same node.
            if (state.transcriptTargetNode) {
                return
            }

            // CRITICAL DOM DEPENDENCY. Grab the transcript element.
            state.transcriptTargetNode = element
            console.log(`Registering mutation observer on ${SELECTORS_ZOOM.TRANSCRIPT_CONTAINER}`)

            // Create transcript observer instance linked to the callback function. Registered irrespective of operation mode, so that any visible transcript can be picked up during the meeting, independent of the operation mode.
            // Initial attach and monitor every 2s
            startTranscriptMonitor(state)
            markCaptureRecovered(state)
        })
        .catch((err) => {
            console.error(err)
            markCaptureFailed(state)
            showNotificationZoom(extensionStatusJSON_bug)

            logError(state, "001", err)
        })
}

/**
 * @description Click handler for the FAB's not-recording play icon — re-runs the
 * transcript attach chain against the stashed iframe. No-ops if capture isn't
 * currently marked failed, or if the iframe reference isn't available yet.
 * @param {ContentScriptState} state
 */
function attemptManualCaptureRetryZoom(state) {
    if (!state.isTranscriptDomErrorCaptured) return
    if (!state.zoomIframe) return
    console.log("Manual capture retry triggered")
    attachTranscriptListenerZoom(state, state.zoomIframe)
}

/**
 * @param {ContentScriptState} state
 */
function zoomMeetingRoutines(state) {
    renderFab(() => attemptManualCaptureRetryZoom(state))

    waitForElement(SELECTORS_ZOOM.IFRAME).then(() => {
        console.log(`Found iframe`)
        const iframe = /** @type {HTMLIFrameElement | null} */ (document.querySelector(SELECTORS_ZOOM.IFRAME))
        // Stashed so a manual capture retry can re-target the transcript container
        // without re-deriving the iframe/hasIframeLoaded chain.
        state.zoomIframe = iframe

        if (iframe) {
            hasIframeLoaded(iframe).then(() => {
                console.log("Iframe loaded")
                const iframeDOM = iframe.contentDocument

                // CRITICAL DOM DEPENDENCY. Wait until the meeting end icon appears, used to detect meeting start
                if (iframeDOM) {
                    waitForElement(SELECTORS_ZOOM.AUDIO_OPTION_MENU, undefined, iframe).then(() => {
                        console.log("Meeting started")
                        /** @type {ExtensionMessage} */
                        const message = {
                            type: "new_meeting_started"
                        }
                        chrome.runtime.sendMessage(message, function () { })
                        state.hasMeetingStarted = true
                        setFabJoinedState(true)
                        // Update meeting startTimestamp
                        state.meetingStartTimestamp = new Date().toISOString()
                        overWriteChromeStorage(state, ["meetingStartTimestamp"], false)

                        //*********** MEETING START ROUTINES **********//
                        updateMeetingTitle(state)

                        // **** REGISTER TRANSCRIPT LISTENER **** //
                        attachTranscriptListenerZoom(state, iframe)
                        // waitForElement() never times out on its own — it polls forever — so
                        // this is the real-world detector for "auto-record silently never
                        // attached" (as opposed to the narrower DOM-race errors
                        // attachTranscriptListenerZoom's own .catch() covers).
                        scheduleCaptureFailureDeadline(state)


                        //*********** MEETING END ROUTINES **********//
                        try {
                            // CRITICAL DOM DEPENDENCY. Event listener to capture meeting end button click by user
                            const endCallElement = iframeDOM.querySelector(SELECTORS_ZOOM.LEAVE_BUTTON_CONTAINER)
                            endCallElement?.firstChild?.addEventListener("click", function meetingEndRoutines() {
                                endCallElement.removeEventListener("click", meetingEndRoutines)
                                console.log("Meeting ended")
                                // To suppress further errors
                                state.hasMeetingEnded = true
                                if (state.transcriptObserver) {
                                    state.transcriptObserver.disconnect()
                                }

                                // Push any data in the buffer variables to the transcript array. Needed to handle one or more speaking when meeting ends.

                                pushBufferToTranscript(state)
                                // Save to chrome storage and send message to download transcript from background script.
                                // Deliberately excludes "liveCommentNotes" — see the matching comment in
                                // google-meet/index.js's meeting-end handler for why.
                                overWriteChromeStorage(state, ["transcript", "chatMessages"], true)

                                unmountFab()
                            })
                        } catch (err) {
                            console.error(err)
                            showNotificationZoom(extensionStatusJSON_bug)

                            logError(state, "004", err)
                        }
                    })
                }
            })
        }
    })
}



/**
   * @description Callback function to execute when transcription mutations are observed.
   * @param {ContentScriptState} state
   * @param {MutationRecord[]} mutationsList
   */
function transcriptMutationCallbackZoom(state, mutationsList) {
    mutationsList.forEach(async (mutation) => {
        try {
            if (mutation.type === "characterData") {
                const mutationTargetElement = mutation.target.parentElement
                const currentTranscriptText = mutationTargetElement?.textContent

                if (currentTranscriptText) {
                    // Find person name using various strategies
                    const currentPersonName = getPersonName(mutationTargetElement) || "Person"

                    if (currentPersonName && currentTranscriptText) {
                        // Starting fresh in a meeting or resume from no active transcript
                        if (state.stateTranscriptBlock.transcriptTextBuffer === "") {
                            state.stateTranscriptBlock.personName = currentPersonName
                            state.stateTranscriptBlock.timestamp = new Date().toISOString()
                            state.stateTranscriptBlock.transcriptTextBuffer = currentTranscriptText
                        }
                        // Some prior transcript buffer exists
                        else {
                            // New person started speaking
                            if (state.stateTranscriptBlock.personName !== currentPersonName) {
                                // Push previous person's transcript as a block
                                pushBufferToTranscript(state)

                                // Update buffers for next mutation and store transcript block timestamp
                                state.stateTranscriptBlock.personName = currentPersonName
                                state.stateTranscriptBlock.timestamp = new Date().toISOString()
                                state.stateTranscriptBlock.transcriptTextBuffer = currentTranscriptText
                            }
                            // Same person speaking more
                            else {
                                // Update buffers for next mutation
                                // Append only the new part of the transcript
                                state.stateTranscriptBlock.transcriptTextBuffer = state.stateTranscriptBlock.transcriptTextBuffer + findNewPart(state.stateTranscriptBlock.transcriptTextBuffer, currentTranscriptText)
                            }
                        }
                    }
                }

                // Rendered by the side panel
                broadcastLiveBuffer(state)
            }
        }
        catch (err) {
            console.error(err)
            if (!state.isTranscriptDomErrorCaptured && !state.hasMeetingEnded) {
                console.log(reportErrorMessage)
                showNotificationZoom(extensionStatusJSON_bug)

                logError(state, "005", err)
            }
            markCaptureFailed(state)
        }
    })
}