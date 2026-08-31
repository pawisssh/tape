/** @type {ExtensionStatusJSON} */
const extensionStatusJSON_bug = {
    "status": 400,
    "message": `<strong>TranscripTonic encountered a new error</strong> <br /> Please report it <a href="https://github.com/vivek-nexus/transcriptonic/issues" target="_blank">here</a>.`
}
const reportErrorMessage = "There is a bug in TranscripTonic. Please report it at https://github.com/vivek-nexus/transcriptonic/issues"
const LOG_ERROR_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbz0VFUYIke1WK12Q-8y-zQ91bOPRZ8dAL4cRpm309IYZO0k6uYDkTSlfbWFaGvUV_Z-JQ/exec"


/** @type {MutationObserverInit} */
const mutationConfig = { childList: true, attributes: true, subtree: true, characterData: true }

const LOGO_URL = chrome.runtime.getURL("extension/icon.png")
const commonCSS = `background: rgba(44, 44, 46, 0.92);
    color: rgba(255, 255, 255, 0.87);
    backdrop-filter: blur(16px);
    position: fixed;
    left: 0;
    right: 0;
    margin-left: auto;
    margin-right: auto;
    max-width: 780px;
    z-index: 1000;
    padding: 0rem 1rem;
    border-radius: 18px;
    display: flex;
    justify-content: center;
    align-items: center;
    gap: 16px;
    font-size: 1rem;
    line-height: 1.5;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif;
    box-shadow: 0px 16px 16px rgba(12, 12, 13, 0.1), 0px 4px 2px rgba(12, 12, 13, 0.05), 0 0 0 1px rgba(255, 255, 255, 0.12);`

const NOTIFICATION_PLATFORM_CONFIGS = {
    "google_meet": {
        notificationText: "<strong>TranscripTonic is running</strong> <br /> Do not turn off captions",
        statusUrl: "https://ejnana.github.io/transcripto-status/status-prod-meet.json"
    },
    "teams": {
        notificationText: "<b>TranscripTonic is ready, enabling captions...</b> <br /> Please enable manually if not successful (More > Captions)",
        statusUrl: "https://ejnana.github.io/transcripto-status/status-prod-teams.json"
    },
    "zoom": {
        notificationText: "TranscripTonic is ready <br /> <b>Please switch on Zoom captions to begin (More > Captions)</b>",
        statusUrl: "https://ejnana.github.io/transcripto-status/status-prod-zoom.json"
    }
}