let isTeamsInjected = false

setInterval(() => {
  // Meeting lobby
  const isJoinButtonFound = document.querySelector(SELECTORS_TEAMS.PREJOIN_JOIN_BUTTON)

  // On the meeting lobby and main teams function is not running, inject it
  // This won't cause multiple main teams injections into the current meeting because when the previous meeting ends, all UI elements are gone, destroying the corresponding event listeners
  if (isJoinButtonFound && !isTeamsInjected) {
    initTeams()
    isTeamsInjected = true
  }
  // Reset flag for next meeting lobby visit
  if (!isJoinButtonFound) {
    isTeamsInjected = false
  }
}, 2000)

function initTeams() {
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
      const state = createContentScriptState("Teams", "teams")
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

            teamsMeetingRoutines(state)
          }
          else {
            // Show downtime message as extension status is 400
            showNotificationTeams(state.extensionStatusJSON)
          }
        })
      })
    })
}

/**
 * @description Waits for the captions region to appear and attaches the transcript
 * MutationObserver. Extracted as its own function so it can be re-invoked as a
 * manual retry when auto-record fails to attach — see attemptManualCaptureRetryTeams().
 * Safe to call again even while a prior call is still pending (e.g. hung in
 * waitForElement(), which never times out on its own): the success path only acts
 * if state.transcriptTargetNode isn't already set, so a stale/duplicate resolution
 * is a no-op instead of double-attaching.
 * @param {ContentScriptState} state
 */
function attachTranscriptListenerTeams(state) {
  // Wait for transcript node to be visible
  return waitForElement(SELECTORS_TEAMS.CAPTIONS_REGION).then((element) => {
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
    // Create transcript observer instance linked to the callback function. Registered irrespective of operation mode, so that any visible transcript can be picked up during the meeting, independent of the operation mode.
    // Initial attach and monitor every 2s
    startTranscriptMonitor(state)
    markCaptureRecovered(state)
  })
    .catch((err) => {
      console.error(err)
      markCaptureFailed(state)
      showNotificationTeams(extensionStatusJSON_bug)

      logError(state, "001", err)
    })
}

/**
 * @description Click handler for the FAB's not-recording play icon — re-runs the
 * transcript attach chain. No-ops if capture isn't currently marked failed.
 * @param {ContentScriptState} state
 */
function attemptManualCaptureRetryTeams(state) {
  if (!state.isTranscriptDomErrorCaptured) return
  console.log("Manual capture retry triggered")
  attachTranscriptListenerTeams(state)
}

/**
 * @param {ContentScriptState} state
 */
function teamsMeetingRoutines(state) {
  renderFab(() => attemptManualCaptureRetryTeams(state))

  // CRITICAL DOM DEPENDENCY. Wait until the meeting end icon appears, used to detect meeting start
  waitForElement(SELECTORS_TEAMS.HANGUP_BUTTON).then(() => {
    console.log("Meeting started")
    /** @type {ExtensionMessage} */
    const message = {
      type: "new_meeting_started"
    }
    chrome.runtime.sendMessage(message, function () { })
    state.hasMeetingStarted = true
    // Update meeting startTimestamp
    state.meetingStartTimestamp = new Date().toISOString()
    overWriteChromeStorage(state, ["meetingStartTimestamp"], false)

    //*********** MEETING START ROUTINES **********//
    updateMeetingTitle(state)

    // Fire captions shortcut based on operation mode. Async operation.
    chrome.storage.sync.get(["operationMode"], function (resultSyncUntyped) {
      const resultSync = /** @type {ResultSync} */ (resultSyncUntyped)
      if (resultSync.operationMode === "manual") {
        console.log("Manual mode selected, leaving transcript off")
        showNotificationTeams({ status: 400, message: "<strong>TranscripTonic is not running</strong> <br /> Turn on captions, if needed (More > Language > Captions)" })
      }
      else {
        // Allow keyboard event listener to be ready
        setTimeout(() => {
          dispatchLiveCaptionsShortcut()
          // Show message to enable because keyboard shortcut does not work in guest meetings
          showNotificationTeams(state.extensionStatusJSON)
        }, 2000)
      }
    })

    // **** REGISTER TRANSCRIPT LISTENER **** //
    attachTranscriptListenerTeams(state)
    // waitForElement() never times out on its own — it polls forever — so this is the
    // real-world detector for "auto-record silently never attached" (as opposed to the
    // narrower DOM-race errors attachTranscriptListenerTeams's own .catch() covers).
    scheduleCaptureFailureDeadline(state)


    //*********** MEETING END ROUTINES **********//
    waitForElement(SELECTORS_TEAMS.HANGUP_BUTTON).then((element) => {
      // For some reason, capturing the reference to #hangup-button immediately is not working. Need to wait for a moment.
      setTimeout(() => {
        // CRITICAL DOM DEPENDENCY. Event listener to capture meeting end button click by user
        let endCallElement = element
        if (endCallElement?.nextElementSibling?.tagName === "BUTTON") {
          endCallElement = /** @type {Element} */ (endCallElement?.parentElement)
        }
        endCallElement?.addEventListener("click", meetingEndRoutines)

        function meetingEndRoutines() {
          endCallElement?.removeEventListener("click", meetingEndRoutines)
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
        }
      }, 1000)
    })
  })
}




/**
   * @description Callback function to execute when transcription mutations are observed.
   * @param {ContentScriptState} state
   * @param {MutationRecord[]} mutationsList
   */
function transcriptMutationCallbackTeams(state, mutationsList) {
  mutationsList.forEach(async (mutation) => {
    try {
      // const transcriptTargetNode = document.querySelector(`[data-tid="closed-caption-v2-virtual-list-content"]`)
      if (mutation.type === "characterData") {
        const mutationTargetElement = mutation.target.parentElement

        const currentPersonName = mutationTargetElement?.parentElement?.previousSibling?.textContent
        const currentTranscriptText = mutationTargetElement?.textContent

        if (currentPersonName && currentTranscriptText) {
          // Starting fresh in a meeting
          if (!state.stateTranscriptBlock.mutationTargetElement) {
            state.stateTranscriptBlock.mutationTargetElement = mutation.target.parentElement
            state.stateTranscriptBlock.personName = currentPersonName
            state.stateTranscriptBlock.timestamp = new Date().toISOString()
            state.stateTranscriptBlock.transcriptTextBuffer = currentTranscriptText
          }
          // Some prior transcript buffer exists
          else {
            // New transcript UI block
            if (state.stateTranscriptBlock.mutationTargetElement !== mutation.target.parentElement) {
              // Push previous transcript block
              pushBufferToTranscript(state)

              // Update stateTranscriptBlock for next mutation and store transcript block timestamp
              state.stateTranscriptBlock.mutationTargetElement = mutation.target.parentElement
              state.stateTranscriptBlock.personName = currentPersonName
              state.stateTranscriptBlock.timestamp = new Date().toISOString()
              state.stateTranscriptBlock.transcriptTextBuffer = currentTranscriptText
            }
            // Same transcript UI block being appended
            else {
              // Update stateTranscriptBlock for next mutation
              state.stateTranscriptBlock.transcriptTextBuffer = currentTranscriptText
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
        showNotificationTeams(extensionStatusJSON_bug)

        logError(state, "005", err)
      }
      markCaptureFailed(state)
    }
  })
}