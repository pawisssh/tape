// @ts-check
/// <reference path="../types/chrome.d.ts" />
/// <reference path="../types/index.js" />
/// <reference path="../types/obsidian.js" />

// Kept in sync with extension/obsidian/markdown.js's DEFAULT_FILENAME_TEMPLATE. Not
// imported directly because this file is a plain <script>, not a module (matching
// upstream's existing vanilla-JS pages — no bundler in Phase 3).
const DEFAULT_OBSIDIAN_FILENAME_TEMPLATE = "{{date}} - {{title}}"

// Kept in sync with extension/obsidian/llm.js's DEFAULT_LLM_ENDPOINT/DEFAULT_LLM_MODEL/
// DEFAULT_LLM_TIMEOUT_MS, for the same reason as DEFAULT_OBSIDIAN_FILENAME_TEMPLATE above.
const DEFAULT_LLM_ENDPOINT = "http://localhost:1234/v1/chat/completions"
const DEFAULT_LLM_MODEL = ""
const DEFAULT_LLM_TIMEOUT_MS = 90000

let isMeetingsTableExpanded = false

document.addEventListener("DOMContentLoaded", function () {
    const webhookUrlForm = document.querySelector("#webhook-url-form")
    const webhookUrlInput = document.querySelector("#webhook-url")
    const saveButton = document.querySelector("#save-webhook")
    const autoPostCheckbox = document.querySelector("#auto-post-webhook")
    const autoDownloadCheckbox = document.querySelector("#auto-download-file")
    const simpleWebhookBodyRadio = document.querySelector("#simple-webhook-body")
    const advancedWebhookBodyRadio = document.querySelector("#advanced-webhook-body")
    const recoverLastMeetingButton = document.querySelector("#recover-last-meeting")
    const showAllButton = document.querySelector("#show-all")

    // Obsidian settings form elements
    const obsidianSettingsForm = document.querySelector("#obsidian-settings-form")
    const obsidianVaultNameInput = document.querySelector("#obsidian-vault-name")
    const obsidianFolderInput = document.querySelector("#obsidian-folder")
    const obsidianFileNameTemplateInput = document.querySelector("#obsidian-filename-template")
    const autoSaveObsidianCheckbox = document.querySelector("#auto-save-obsidian")

    // LLM summary settings form elements (Phase 4)
    const llmSettingsForm = document.querySelector("#llm-settings-form")
    const llmEndpointInput = document.querySelector("#obsidian-llm-endpoint")
    const llmModelInput = document.querySelector("#obsidian-llm-model")
    const llmTimeoutInput = document.querySelector("#obsidian-llm-timeout")
    const useLlmSummaryCheckbox = document.querySelector("#use-llm-summary")

    // The .txt download must stay an always-on fallback unless another exporter
    // (webhook or Obsidian) is active, so the user is never left with zero export
    // paths. Hides/forces the "auto-download" checkbox on based on whether webhook
    // auto-post or Obsidian auto-save is enabled.
    function updateAutoDownloadCheckBox() {
        if (autoDownloadCheckbox?.parentElement instanceof HTMLDivElement) {
            const webhookOn = autoPostCheckbox instanceof HTMLInputElement && autoPostCheckbox.checked
            const obsidianOn = autoSaveObsidianCheckbox instanceof HTMLInputElement && autoSaveObsidianCheckbox.checked
            const anotherExporterActive = webhookOn || obsidianOn

            autoDownloadCheckbox.parentElement.style.display = anotherExporterActive ? "flex" : "none"
            if (!anotherExporterActive && autoDownloadCheckbox instanceof HTMLInputElement) {
                autoDownloadCheckbox.checked = true
                chrome.storage.sync.set({
                    autoDownloadFileAfterMeeting: true,
                }, function () { })
            }
        }
    }

    // Initial load of transcripts
    loadMeetings()

    // Reload transcripts when page becomes visible
    document.addEventListener("visibilitychange", function () {
        if (document.visibilityState === "visible") {
            loadMeetings()
        }
    })

    chrome.storage.onChanged.addListener(() => {
        loadMeetings()
    })

    if (recoverLastMeetingButton instanceof HTMLButtonElement) {
        recoverLastMeetingButton.addEventListener("click", function () {
            /** @type {ExtensionMessage} */
            const message = {
                type: "recover_last_meeting",
            }
            chrome.runtime.sendMessage(message, function (responseUntyped) {
                const response = /** @type {ExtensionResponse} */ (responseUntyped)
                loadMeetings()
                scrollTo({ top: 0, behavior: "smooth" })
                if (response.success) {
                    if (response.message === "No recovery needed") {
                        alert("Nothing to recover—you're on top of the world!")
                    }
                    else {
                        alert("Last meeting recovered successfully!")
                    }
                }
                else {
                    const parsedError = /** @type {ErrorObject} */ (response.message)
                    if (parsedError.errorCode === "013") {
                        alert(parsedError.errorMessage)
                    }
                    else if (parsedError.errorCode === "014") {
                        alert("Nothing to recover—you're on top of the world!")
                    }
                    else {
                        alert("Could not recover last meeting!")
                        console.error(parsedError.errorMessage)
                    }
                }
            })
        })
    }

    if (saveButton instanceof HTMLButtonElement && webhookUrlForm instanceof HTMLFormElement && webhookUrlInput instanceof HTMLInputElement && autoPostCheckbox instanceof HTMLInputElement && simpleWebhookBodyRadio instanceof HTMLInputElement && advancedWebhookBodyRadio instanceof HTMLInputElement) {
        // Initially disable the save button
        saveButton.disabled = true

        // Load saved webhook URL, auto-post setting, and webhook body type
        chrome.storage.sync.get(["webhookUrl", "autoPostWebhookAfterMeeting", "autoDownloadFileAfterMeeting", "webhookBodyType"], function (resultSyncUntyped) {
            const resultSync = /** @type {ResultSync} */ (resultSyncUntyped)

            if (resultSync.webhookUrl) {
                webhookUrlInput.value = resultSync.webhookUrl
                saveButton.disabled = !webhookUrlInput.checkValidity()
            }

            // Set checkbox state
            autoPostCheckbox.checked = resultSync.autoPostWebhookAfterMeeting
            if (autoDownloadCheckbox instanceof HTMLInputElement) {
                autoDownloadCheckbox.checked = resultSync.autoDownloadFileAfterMeeting !== false
            }
            updateAutoDownloadCheckBox()

            // Set radio button state
            if (resultSync.webhookBodyType === "advanced") {
                advancedWebhookBodyRadio.checked = true
            } else {
                simpleWebhookBodyRadio.checked = true
            }
        })

        // Handle URL input changes
        webhookUrlInput.addEventListener("input", function () {
            saveButton.disabled = !webhookUrlInput.checkValidity()
        })

        // Save webhook URL, auto-post setting, and webhook body type
        webhookUrlForm.addEventListener("submit", function (e) {
            e.preventDefault()
            const webhookUrl = webhookUrlInput.value
            if (webhookUrl === "") {
                // Save webhook URL and settings
                chrome.storage.sync.set({
                    webhookUrl: webhookUrl
                }, function () {
                    alert("Webhook URL saved!")
                })
            }
            else if (webhookUrl && webhookUrlInput.checkValidity()) {
                // Request runtime permission for the webhook URL
                requestWebhookAndNotificationPermission(webhookUrl).then(() => {
                    // Save webhook URL and settings
                    chrome.storage.sync.set({
                        webhookUrl: webhookUrl
                    }, function () {
                        alert("Webhook URL saved!")
                    })
                }).catch((error) => {
                    alert("Fine! No webhooks for you!")
                    console.error("Webhook permission error:", error)
                })
            }
        })

        // Auto save auto-post setting
        autoPostCheckbox.addEventListener("change", function () {
            // Save webhook URL and settings
            chrome.storage.sync.set({
                autoPostWebhookAfterMeeting: autoPostCheckbox.checked,
            }, function () {
                updateAutoDownloadCheckBox()
            })
        })

        if (autoDownloadCheckbox instanceof HTMLInputElement) {
            autoDownloadCheckbox.addEventListener("change", function () {
                if (!autoDownloadCheckbox.checked) {
                    if (!confirm("Text file serves as a harmless backup, you sure you don't need it?")) {
                        autoDownloadCheckbox.checked = true
                        return
                    }
                }
                chrome.storage.sync.set({
                    autoDownloadFileAfterMeeting: autoDownloadCheckbox.checked,
                }, function () { })
            })
        }

        // Auto save webhook body type
        simpleWebhookBodyRadio.addEventListener("change", function () {
            // Save webhook URL and settings
            chrome.storage.sync.set({ webhookBodyType: "simple" }, function () { })
        })

        // Auto save webhook body type
        advancedWebhookBodyRadio.addEventListener("change", function () {
            // Save webhook URL and settings
            chrome.storage.sync.set({ webhookBodyType: advancedWebhookBodyRadio.checked ? "advanced" : "simple" }, function () { })
        })
    }

    if (obsidianSettingsForm instanceof HTMLFormElement && obsidianVaultNameInput instanceof HTMLInputElement && obsidianFolderInput instanceof HTMLInputElement && obsidianFileNameTemplateInput instanceof HTMLInputElement && autoSaveObsidianCheckbox instanceof HTMLInputElement) {
        // Load saved Obsidian settings
        chrome.storage.sync.get([
            "obsidianVaultName",
            "obsidianFolder",
            "obsidianFileNameTemplate",
            "autoSaveToObsidianAfterMeeting",
        ], function (resultSyncUntyped) {
            const resultSync = /** @type {ResultSync} */ (resultSyncUntyped)

            obsidianVaultNameInput.value = resultSync.obsidianVaultName || ""
            obsidianFolderInput.value = resultSync.obsidianFolder || ""
            obsidianFileNameTemplateInput.value = resultSync.obsidianFileNameTemplate || DEFAULT_OBSIDIAN_FILENAME_TEMPLATE
            autoSaveObsidianCheckbox.checked = resultSync.autoSaveToObsidianAfterMeeting === true

            updateAutoDownloadCheckBox()
        })

        // Save vault name / folder / filename template
        obsidianSettingsForm.addEventListener("submit", function (e) {
            e.preventDefault()
            chrome.storage.sync.set({
                obsidianVaultName: obsidianVaultNameInput.value.trim(),
                obsidianFolder: obsidianFolderInput.value.trim(),
                obsidianFileNameTemplate: obsidianFileNameTemplateInput.value.trim() || DEFAULT_OBSIDIAN_FILENAME_TEMPLATE,
            }, function () {
                alert("Obsidian settings saved!")
            })
        })

        // Auto save the auto-save-to-Obsidian toggle
        autoSaveObsidianCheckbox.addEventListener("change", function () {
            if (autoSaveObsidianCheckbox.checked && !obsidianVaultNameInput.value.trim()) {
                alert("Please enter and save a vault name before enabling auto-save.")
                autoSaveObsidianCheckbox.checked = false
                return
            }
            chrome.storage.sync.set({
                autoSaveToObsidianAfterMeeting: autoSaveObsidianCheckbox.checked,
            }, function () {
                updateAutoDownloadCheckBox()
            })
        })
    }

    if (llmSettingsForm instanceof HTMLFormElement && llmEndpointInput instanceof HTMLInputElement && llmModelInput instanceof HTMLInputElement && llmTimeoutInput instanceof HTMLInputElement && useLlmSummaryCheckbox instanceof HTMLInputElement) {
        // Load saved LLM settings
        chrome.storage.sync.get([
            "obsidianLlmEndpoint",
            "obsidianLlmModel",
            "obsidianLlmTimeoutMs",
            "obsidianUseLlm",
        ], function (resultSyncUntyped) {
            const resultSync = /** @type {ResultSync} */ (resultSyncUntyped)

            llmEndpointInput.value = resultSync.obsidianLlmEndpoint || DEFAULT_LLM_ENDPOINT
            llmModelInput.value = resultSync.obsidianLlmModel || DEFAULT_LLM_MODEL
            llmTimeoutInput.value = String(resultSync.obsidianLlmTimeoutMs || DEFAULT_LLM_TIMEOUT_MS)
            // Only ever reflect a *granted* permission as "on" — obsidianUseLlm must
            // never silently read as enabled without the matching host permission, so
            // the extension stays fully functional (falls through to the null-fallback
            // path) even if the permission was revoked out-of-band (e.g. via
            // chrome://extensions) after being saved as true.
            const wantsLlm = resultSync.obsidianUseLlm === true
            if (wantsLlm) {
                const originPattern = llmEndpointOriginPattern(llmEndpointInput.value)
                if (originPattern) {
                    chrome.permissions.contains({ origins: [originPattern] }, function (hasPermission) {
                        useLlmSummaryCheckbox.checked = hasPermission === true
                        if (!hasPermission) {
                            // Permission was revoked since this was last saved as "on" —
                            // reflect reality in storage too, so triggerObsidianHandoffIfConfigured's
                            // read of obsidianUseLlm doesn't disagree with what the UI shows.
                            chrome.storage.sync.set({ obsidianUseLlm: false }, function () { })
                        }
                    })
                } else {
                    useLlmSummaryCheckbox.checked = false
                }
            } else {
                useLlmSummaryCheckbox.checked = false
            }
        })

        // Save endpoint / model / timeout
        llmSettingsForm.addEventListener("submit", function (e) {
            e.preventDefault()
            const timeoutMs = parseInt(llmTimeoutInput.value, 10)
            chrome.storage.sync.set({
                obsidianLlmEndpoint: llmEndpointInput.value.trim() || DEFAULT_LLM_ENDPOINT,
                obsidianLlmModel: llmModelInput.value.trim(),
                obsidianLlmTimeoutMs: Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : DEFAULT_LLM_TIMEOUT_MS,
            }, function () {
                alert("LLM settings saved!")
            })
        })

        // The permission request MUST happen directly inside this checkbox's own
        // click/change handler so it counts as a genuine user gesture — Chrome refuses
        // chrome.permissions.request() calls made outside one (e.g. from a blur handler
        // or an unrelated effect).
        useLlmSummaryCheckbox.addEventListener("change", function () {
            if (!useLlmSummaryCheckbox.checked) {
                chrome.storage.sync.set({ obsidianUseLlm: false }, function () { })
                return
            }

            const endpoint = llmEndpointInput.value.trim() || DEFAULT_LLM_ENDPOINT
            const originPattern = llmEndpointOriginPattern(endpoint)
            if (!originPattern) {
                alert("Please enter a valid endpoint URL before enabling LLM summaries.")
                useLlmSummaryCheckbox.checked = false
                return
            }

            useLlmSummaryCheckbox.disabled = true
            chrome.permissions.request({ origins: [originPattern] }).then((granted) => {
                useLlmSummaryCheckbox.disabled = false
                if (granted) {
                    chrome.storage.sync.set({
                        obsidianUseLlm: true,
                        obsidianLlmEndpoint: endpoint,
                    }, function () { })
                } else {
                    useLlmSummaryCheckbox.checked = false
                    chrome.storage.sync.set({ obsidianUseLlm: false }, function () { })
                }
            }).catch((error) => {
                useLlmSummaryCheckbox.disabled = false
                useLlmSummaryCheckbox.checked = false
                chrome.storage.sync.set({ obsidianUseLlm: false }, function () { })
                console.error("LLM endpoint permission error:", error)
                alert("Could not request permission for that endpoint. Enable LLM summaries again once fixed.")
            })
        })
    }

    if (showAllButton instanceof HTMLButtonElement) {
        showAllButton.addEventListener("click", () => {
            const meetingsTableContainer = document.querySelector("#meetings-table-container")
            meetingsTableContainer?.classList.remove("fade-mask")
            showAllButton.setAttribute("style", "display:none;")
            isMeetingsTableExpanded = true
        })
    }

    // handlePermissions()
})


// Request runtime permission for webhook URL
/**
 * @param {string} url
 */
function requestWebhookAndNotificationPermission(url) {
    return new Promise((resolve, reject) => {
        try {
            const urlObj = new URL(url)
            const originPattern = `${urlObj.protocol}//${urlObj.hostname}/*`

            // Request both host and notifications permissions
            chrome.permissions.request({
                origins: [originPattern],
                permissions: ["notifications"]
            }).then((granted) => {
                if (granted) {
                    resolve("Permission granted")
                } else {
                    reject(new Error("Permission denied"))
                }
            }).catch((error) => {
                reject(error)
            })
        } catch (error) {
            reject(error)
        }
    })
}

// Derive the origin match pattern (for chrome.permissions.request/contains) from a
// configured LLM endpoint URL. Kept in sync with extension/obsidian/llm.js's
// endpointOriginPattern() for the same reason as the DEFAULT_LLM_* constants above —
// this file is a plain <script>, not a module, so it can't import that function
// directly. Chrome match patterns have no port component (any port on the host is
// implicitly covered), matching the pattern already used for webhook URLs below.
/**
 * @param {string} endpoint
 * @returns {string | null}
 */
function llmEndpointOriginPattern(endpoint) {
    try {
        const url = new URL(endpoint)
        return `${url.protocol}//${url.hostname}/*`
    } catch {
        return null
    }
}

// Minimal HTML-escaping for text (e.g. LLM-generated summaries) inserted via
// innerHTML — this content did not originate from this extension's own code, so it
// should never be interpreted as markup.
/**
 * @param {string} text
 * @returns {string}
 */
function escapeHtml(text) {
    return String(text)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;")
}

// Load and display recent transcripts
function loadMeetings() {
    const meetingsTable = document.querySelector("#meetings-table")

    chrome.storage.local.get(["meetings"], function (resultLocalUntyped) {
        const resultLocal = /** @type {ResultLocal} */ (resultLocalUntyped)
        // Clear existing content
        if (meetingsTable) {
            meetingsTable.innerHTML = ""


            if (resultLocal.meetings && resultLocal.meetings.length > 0) {
                const meetings = resultLocal.meetings
                // Loop through the array in reverse order to list latest meeting first
                for (let i = meetings.length - 1; i >= 0; i--) {
                    const meeting = meetings[i]
                    const timestamp = new Date(meeting.meetingStartTimestamp).toLocaleString()
                    const durationString = getDuration(meeting.meetingStartTimestamp, meeting.meetingEndTimestamp)

                    const row = document.createElement("tr")
                    row.innerHTML = `
                    <td>
                        <div contenteditable="true" class="meeting-title" data-index="${i}" title="Rename">
                        ${meeting.meetingTitle || meeting.title || "Google Meet call"}
                    </div>
                    </td>
                    <td>
                     ${meeting.meetingSoftware ? meeting.meetingSoftware : ""} 
                    </td>
                    <td>${timestamp} &nbsp; &#9679; &nbsp; ${durationString}</td>
                    <td>
                        ${(
                            () => {
                                switch (meeting.webhookPostStatus) {
                                    case "successful":
                                        return `<span class="status-success">Successful</span>`
                                    case "failed":
                                        return `<span class="status-failed">Failed</span>`
                                    case "new":
                                        return `<span class="status-new">New</span>`
                                    default:
                                        return `<span class="status-new">Unknown</span>`
                                }
                            }
                        )()}
                    </td>
                    <td>
                        ${(
                            () => {
                                switch (meeting.obsidianSaveStatus) {
                                    case "handed_off":
                                        return `<span class="status-success">Sent</span>`
                                    case "failed":
                                        return `<span class="status-failed">Failed</span>`
                                    case "pending":
                                        return `<span class="status-new">Pending</span>`
                                    default:
                                        return `<span class="sub-text">Not sent</span>`
                                }
                            }
                        )()}
                    </td>
                    <td>
                        ${meeting.llmSummaryMarkdown ? `
                            <details class="llm-summary-details">
                                <summary>View summary</summary>
                                <pre class="llm-summary-content">${escapeHtml(meeting.llmSummaryMarkdown)}</pre>
                            </details>
                        ` : `<span class="sub-text">—</span>`}
                    </td>
                    <td>
                        <div style="display: flex; gap: 1rem; justify-content: end">
                            <button class="download-button" data-index="${i}" title="Download" aria-label="Download this meeting transcript">
                                <img src="./icons/download.svg" alt="">
                            </button>
                            <button class="post-button" data-index="${i}" title="${meeting.webhookPostStatus === "new" ? `Post webhook` : `Repost webhook`}" aria-label="${meeting.webhookPostStatus === "new" ? `` : ``}">
                                ${meeting.webhookPostStatus === "new" ? `` : ``}
                                <img src="./icons/webhook.svg" alt="">
                            </button>
                            &nbsp;
                            <button class="obsidian-save-button" data-index="${i}" title="Save to Obsidian" aria-label="Save this meeting to Obsidian">
                                Save to Obsidian
                            </button>
                            &nbsp;
                             <button class="delete-button" data-index="${i}" title="Delete" aria-label="Delete this meeting">
                                <img src="./icons/delete.svg" alt="">
                            </button>
                        </div>
                    </td>
                `
                    meetingsTable.appendChild(row)

                    // Add event listener to meeting title input
                    const meetingTitleInput = row.querySelector(".meeting-title")
                    if (meetingTitleInput instanceof HTMLDivElement) {
                        meetingTitleInput.addEventListener("blur", function () {
                            const updatedMeeting = /** @type {Meeting} */ {
                                ...meeting,
                                meetingTitle: meetingTitleInput.innerText
                            }
                            meetings[i] = updatedMeeting
                            chrome.storage.local.set({ meetings: meetings }, function () {
                                console.log("Meeting title updated")
                            })
                        })
                    }

                    // Add event listener to the webhook post button
                    const downloadButton = row.querySelector(".download-button")
                    if (downloadButton instanceof HTMLButtonElement) {
                        downloadButton.addEventListener("click", function () {
                            // Send message to background script to download text file
                            const index = parseInt(downloadButton.getAttribute("data-index") ?? "-1")
                            /** @type {ExtensionMessage} */
                            const message = {
                                type: "download_transcript_at_index",
                                index: index
                            }
                            chrome.runtime.sendMessage(message, (responseUntyped) => {
                                const response = /** @type {ExtensionResponse} */ (responseUntyped)
                                if (!response.success) {
                                    alert("Could not download transcript")
                                    const parsedError = /** @type {ErrorObject} */ (response.message)
                                    if (typeof parsedError === 'object') {
                                        console.error(parsedError.errorMessage)
                                    }
                                }
                            })
                        })
                    }

                    // Add event listener to the webhook post button
                    const webhookPostButton = row.querySelector(".post-button")
                    if (webhookPostButton instanceof HTMLButtonElement) {
                        webhookPostButton.addEventListener("click", function () {
                            chrome.storage.sync.get(["webhookUrl"], function (resultSyncUntyped) {
                                const resultSync = /** @type {ResultSync} */ (resultSyncUntyped)
                                if (resultSync.webhookUrl) {
                                    // Request runtime permission for the webhook URL. Needed for cases when user signs on a new browser—webhook URL and other sync variables are available, but runtime permissions will be missing.
                                    requestWebhookAndNotificationPermission(resultSync.webhookUrl).then(() => {
                                        // Disable button and update text
                                        webhookPostButton.disabled = true
                                        webhookPostButton.textContent = meeting.webhookPostStatus === "new" ? "Posting..." : "Reposting..."

                                        // Send message to background script to post webhook
                                        const index = parseInt(webhookPostButton.getAttribute("data-index") ?? "-1")
                                        /** @type {ExtensionMessage} */
                                        const message = {
                                            type: "post_webhook_at_index",
                                            index: index
                                        }
                                        chrome.runtime.sendMessage(message, (responseUntyped) => {
                                            const response = /** @type {ExtensionResponse} */ (responseUntyped)
                                            loadMeetings()
                                            if (response.success) {
                                                alert("Posted successfully!")
                                            }
                                            else {
                                                const parsedError = /** @type {ErrorObject} */ (response.message)
                                                if (typeof parsedError === 'object') {
                                                    console.error(parsedError.errorMessage)
                                                }
                                            }
                                        })
                                    }).catch((error) => {
                                        alert("Fine! No webhooks for you!")
                                        console.error("Webhook permission error:", error)
                                    })
                                }
                                else {
                                    alert("Please provide a webhook URL")
                                }
                            })
                        })
                    }

                    // Add event listener to the Obsidian save button
                    const obsidianSaveButton = row.querySelector(".obsidian-save-button")
                    if (obsidianSaveButton instanceof HTMLButtonElement) {
                        obsidianSaveButton.addEventListener("click", function () {
                            // Stable id — must match extension/obsidian/store.js's getMeetingId()
                            const meetingId = meeting.meetingStartTimestamp

                            obsidianSaveButton.disabled = true
                            const originalText = obsidianSaveButton.textContent
                            obsidianSaveButton.textContent = "Sending…"

                            /** @type {ExtensionMessage} */
                            const message = {
                                type: "save_meeting_to_obsidian",
                                meetingId: meetingId
                            }
                            chrome.runtime.sendMessage(message, (responseUntyped) => {
                                const response = /** @type {ExtensionResponse} */ (responseUntyped)
                                obsidianSaveButton.disabled = false
                                obsidianSaveButton.textContent = originalText
                                loadMeetings()
                                if (response.success) {
                                    // A new tab was opened to complete the handoff (and possibly
                                    // show Chrome's "Open Obsidian?" prompt) — nothing more to do here.
                                }
                                else {
                                    const parsedError = /** @type {ErrorObject} */ (response.message)
                                    if (typeof parsedError === "object" && parsedError.errorCode === "018") {
                                        alert("Please configure and save an Obsidian vault name first.")
                                    }
                                    else {
                                        alert("Could not save to Obsidian")
                                        if (typeof parsedError === "object") {
                                            console.error(parsedError.errorMessage)
                                        }
                                    }
                                }
                            })
                        })
                    }

                    // Add event listener to the meeting delete button
                    const deleteButton = row.querySelector(".delete-button")
                    if (deleteButton instanceof HTMLButtonElement) {
                        deleteButton.addEventListener("click", function () {
                            if (confirm("Delete this meeting?")) {
                                meetings.splice(i, 1)
                                chrome.storage.local.set({ meetings: meetings }, function () {
                                    console.log("Meeting title updated")
                                })
                            }
                        })
                    }
                }
                const meetingsTableContainer = document.querySelector("#meetings-table-container")
                if (!isMeetingsTableExpanded && meetingsTableContainer && (meetingsTableContainer.clientHeight > 280)) {
                    meetingsTableContainer?.classList.add("fade-mask")
                    document.querySelector("#show-all")?.setAttribute("style", "display: block")
                }
            }
            else {
                meetingsTable.innerHTML = `<tr><td colspan="7">Your next meeting will show up here</td></tr>`
            }
        }
    })
}

function handlePermissions() {
    chrome.scripting
        .getRegisteredContentScripts()
        .then((scripts) => {
            console.log(scripts)
        })

    chrome.storage.sync.get(["wantGoogleMeet", "wantTeams", "wantZoom"], function (resultSyncUntyped) {
        const resultSync = /** @type {ResultSync} */ (resultSyncUntyped)

        console.log(resultSync)

        /** @type {Platform[]} */
        const wantedPlatforms = []
        //  Consider enabled if user has not explicitly opted out
        if (resultSync.wantGoogleMeet) {
            wantedPlatforms.push("google_meet")
        }
        if (resultSync.wantTeams) {
            wantedPlatforms.push("teams")
        }
        if (resultSync.wantZoom) {
            wantedPlatforms.push("zoom")
        }

        console.log(`Wanted platforms: ${wantedPlatforms}`)
        /** @type {ExtensionMessage} */
        const message = {
            type: "get_platform_permission_status",
            platform: wantedPlatforms
        }
        chrome.runtime.sendMessage(message, (responseUntyped) => {
            const response = /** @type {ExtensionResponse} */ (responseUntyped)
            if (response.success) {
                console.log(response.message)

                /** @type {Platform[]} */
                const permissionMissingPlatforms = []

                for (let i = 0; i < wantedPlatforms.length; i++) {
                    if (Array.isArray(response.message) && response.message[i] === "Disabled") {
                        permissionMissingPlatforms.push(wantedPlatforms[i])
                    }
                }

                if (permissionMissingPlatforms.length > 0) {
                    const dialog = document.querySelector('#permission-dialog')
                    const reviewButton = /** @type {HTMLButtonElement} */ (document.querySelector('#review-button'))
                    const laterButton = /** @type {HTMLButtonElement} */ (document.querySelector('#later-button'))

                    // Show the modal
                    // @ts-ignore
                    dialog?.showModal()
                    reviewButton?.focus()

                    // Handle the "Confirm" action
                    reviewButton?.addEventListener("click", () => {
                        // @ts-ignore
                        dialog?.close()

                        // This execution context is now considered a "User Gesture"
                        const disableMsg = {
                            type: "disable_platform",
                            platform: permissionMissingPlatforms
                        }

                        chrome.runtime.sendMessage(disableMsg, (response) => {
                            if (response.success) {
                                chrome.runtime.sendMessage({
                                    type: "enable_platform",
                                    platform: permissionMissingPlatforms
                                })
                            }
                        })
                    })

                    // Handle the "Cancel" action
                    laterButton?.addEventListener("click", () => {
                        // @ts-ignore
                        dialog?.close()
                    })

                }
            }
        })
    })
}

// Format duration between two timestamps, specified in milliseconds elapsed since the epoch
/**
 * @param {string} meetingStartTimestamp - ISO timestamp
 * @param {string} meetingEndTimestamp - ISO timestamp
 */
function getDuration(meetingStartTimestamp, meetingEndTimestamp) {
    const duration = new Date(meetingEndTimestamp).getTime() - new Date(meetingStartTimestamp).getTime()
    const durationMinutes = Math.round(duration / (1000 * 60))
    const durationHours = Math.floor(durationMinutes / 60)
    const remainingMinutes = durationMinutes % 60
    return durationHours > 0
        ? `${durationHours}h ${remainingMinutes}m`
        : `${durationMinutes}m`
}