/**
   * @description Shows a responsive notification of specified type and message
   * @param {ExtensionStatusJSON} extensionStatusJSON
   */
function showNotificationTeams(extensionStatusJSON) {
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
    text.style.cssText = "margin-top: 1rem; margin-bottom:1rem; font-size: medium"

    obj.style.cssText = `bottom: 5%; ${commonCSS}`
    dot.style.cssText = `width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; background: ${extensionStatusJSON.status === 200 ? "#f34f16" : "orange"};`

    if (extensionStatusJSON.status === 200) {
        text.innerHTML = extensionStatusJSON.message

        // Remove banner once transcript is on
        waitForElement(`[data-tid="closed-caption-renderer-wrapper"]`).then(() => {
            obj.style.display = "none"
        })
    }
    else {
        text.innerHTML = extensionStatusJSON.message

        setTimeout(() => {
            obj.style.display = "none"
        }, 5000)
    }

    obj.prepend(text)
    obj.prepend(logo)
    obj.prepend(dot)
    if (html)
        html.append(obj)
}

function dispatchLiveCaptionsShortcut() {
    // Mac: Command+Shift+A
    dispatchKeyboardShortcut("a", "KeyA", { metaKey: true, shiftKey: true, bubbles: true })
    // Windows: Alt+Shift+C (defaulting non-Mac to Windows)
    dispatchKeyboardShortcut("c", "KeyC", { altKey: true, shiftKey: true, bubbles: true })
}