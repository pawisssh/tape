/**
 * @description Returns all elements of the specified selector type and specified textContent. Return array contains the actual element as well as all the parents.
 * @param {string} selector
 * @param {string | RegExp} text
 */
function selectElements(selector, text) {
    var elements = document.querySelectorAll(selector)
    return Array.prototype.filter.call(elements, function (element) {
        return RegExp(text).test(element.textContent)
    })
}

/**
   * @description Shows a responsive notification of specified type and message
   * @param {ExtensionStatusJSON} extensionStatusJSON
   */
function showNotificationGoogleMeet(extensionStatusJSON) {
    // Banner CSS
    let html = document.querySelector("html")
    let obj = document.createElement("div")
    let dot = document.createElement("span")
    let logo = document.createElement("img")
    let text = document.createElement("p")

    logo.setAttribute(
        "src",
        LOGO_URL
    )
    logo.setAttribute("height", "32px")
    logo.setAttribute("width", "32px")
    logo.style.cssText = "border-radius: 8px"

    // Remove banner after 5s
    setTimeout(() => {
        obj.style.display = "none"
    }, 5000)

    obj.style.cssText = `top: 5%; ${commonCSS}`
    dot.style.cssText = `width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; background: ${extensionStatusJSON.status === 200 ? "#f34f16" : "orange"};`
    text.innerHTML = extensionStatusJSON.message

    obj.prepend(text)
    obj.prepend(logo)
    obj.prepend(dot)
    if (html)
        html.append(obj)
}

/**
 * @description Grabs updated meeting title, if available
 * @param {ContentScriptState} state
 */
function updateMeetingTitleGoogleMeet(state) {
    waitForElement(SELECTORS_GOOGLE_MEET.MEETING_TITLE).then((element) => {
        const meetingTitleElement = /** @type {HTMLDivElement} */ (element)
        meetingTitleElement?.setAttribute("contenteditable", "true")
        meetingTitleElement.title = "Edit meeting title for Tape"
        meetingTitleElement.style.cssText = `text-decoration: underline white; text-underline-offset: 4px;`

        meetingTitleElement?.addEventListener("input", handleMeetingTitleElementChange)

        // Pick up meeting name after a delay, since Google meet updates meeting name after a delay
        setTimeout(() => {
            handleMeetingTitleElementChange()
            if (location.pathname === `/${meetingTitleElement.innerText}`) {
                showNotificationGoogleMeet({ status: 200, message: "<b>Give this meeting a title?</b><br/>Edit the underlined text in the bottom left corner" })
            }
        }, 7000)

        function handleMeetingTitleElementChange() {
            state.meetingTitle = meetingTitleElement.innerText
            overWriteChromeStorage(state, ["meetingTitle"], false)
        }
    })
}

/**
 * @description Attempt to get username before meeting starts. Abort interval if valid username is found or if meeting starts and default to "You"
 * @param {ContentScriptState} state
 */
function captureUserName(state) {
    waitForElement(SELECTORS_GOOGLE_MEET.USER_NAME).then(() => {
        // Poll the element until the textContent loads from network or until meeting starts
        const captureUserNameInterval = setInterval(() => {
            if (!state.hasMeetingStarted) {
                const capturedUserName = document.querySelector(SELECTORS_GOOGLE_MEET.USER_NAME)?.textContent
                if (capturedUserName) {
                    state.userName = capturedUserName
                    clearInterval(captureUserNameInterval)
                }
            }
            else {
                clearInterval(captureUserNameInterval)
            }
        }, 100)
    })
}

/**
 * @description Pushes object to array only if it doesn't already exist.
 * @param {ContentScriptState} state
 * @param {ChatMessage} chatBlock
 */
function pushUniqueChatBlock(state, chatBlock) {
    const isExisting = state.chatMessages.some(item =>
        (item.personName === chatBlock.personName) &&
        (item.chatMessageText === chatBlock.chatMessageText)
    )
    if (!isExisting) {
        console.log(chatBlock)
        state.chatMessages.push(chatBlock)
        overWriteChromeStorage(state, ["chatMessages"], false)
    }
}
/**
 * @description Classifies Meet's captions toggle from its icon ligature and its button's
 * aria-pressed. aria-pressed wins when present. Without it, only the older
 * closed_caption_off / closed_caption pair says which state it's in; translate_cc looks
 * the same on and off, so it's "unknown".
 * @param {string | null} iconText
 * @param {string | null | undefined} ariaPressed
 * @returns {"on" | "off" | "unknown"}
 */
function classifyCaptionsToggleGoogleMeet(iconText, ariaPressed) {
    if (!iconText || !SELECTORS_GOOGLE_MEET.TEXT_CAPTIONS_ALL.includes(iconText)) return "unknown"
    if (ariaPressed === "true") return "on"
    if (ariaPressed === "false") return "off"
    if (iconText === SELECTORS_GOOGLE_MEET.TEXT_CAPTIONS_OFF) return "off"
    if (iconText === SELECTORS_GOOGLE_MEET.TEXT_CAPTIONS_ON) return "on"
    return "unknown"
}

/**
 * @description Reads whether Meet's captions toggle is on. "unknown" when the toggle isn't
 * in the toolbar (e.g. folded into More options in a narrow window) or its state can't be
 * read.
 * @returns {"on" | "off" | "unknown"}
 */
function readCaptionsToggleGoogleMeet() {
    const icon = Array.from(document.querySelectorAll(SELECTORS_GOOGLE_MEET.GOOGLE_SYMBOLS))
        .find(element => SELECTORS_GOOGLE_MEET.TEXT_CAPTIONS_ALL.includes(element.textContent ?? ""))
    if (!icon) return "unknown"
    return classifyCaptionsToggleGoogleMeet(icon.textContent, icon.closest("button")?.getAttribute("aria-pressed"))
}

let isTurningOnCaptionsGoogleMeet = false

/**
 * @description Turns captions on with Meet's "c" shortcut. The newer translate_cc button
 * opens a menu instead of toggling, so clicking no longer works. Meet can drop the first
 * keypress when its shortcut handler isn't ready yet, so this re-checks the toggle and
 * retries every 1.5s, up to 10 times. "c" toggles, so it is only sent while the toggle
 * reads "off": never when captions are on or their state can't be read.
 * @param {() => boolean} [shouldStop] checked before each attempt; true ends the retries
 * @returns {Promise<void>}
 */
async function turnOnCaptionsGoogleMeet(shouldStop = () => false) {
    // One loop at a time: two loops (auto mode and a Start capture press) could each send
    // "c" before Meet updates aria-pressed, toggling captions back off.
    if (isTurningOnCaptionsGoogleMeet) return
    isTurningOnCaptionsGoogleMeet = true
    try {
        const maxAttempts = 10
        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
            if (shouldStop() || readCaptionsToggleGoogleMeet() !== "off") return
            dispatchKeyboardShortcut("c", "KeyC", { bubbles: true })
            await new Promise((resolve) => setTimeout(resolve, 1500))
        }
        console.error("Could not turn on captions")
    }
    finally {
        isTurningOnCaptionsGoogleMeet = false
    }
}

/**
 * @description Whether Tape is capturing Meet captions right now: the transcript observer
 * is attached to a live captions region and captions are on. When the CC toggle can't be
 * read, a caption having arrived through the observer stands in for "captions on".
 * @param {{ captionsToggle: "on" | "off" | "unknown", isObserverAttached: boolean, hasCaptionArrived: boolean }} signals
 */
function isCapturingGoogleMeet({ captionsToggle, isObserverAttached, hasCaptionArrived }) {
    if (!isObserverAttached || captionsToggle === "off") return false
    return captionsToggle === "on" || hasCaptionArrived
}
