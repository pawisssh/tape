// Meeting tools rendered in-page for Meet, Teams, Zoom and installed web apps.
// Captions, AI output and user notes are always inserted with textContent.
/** @type {ReturnType<typeof createLiveMeetingPanel> | null} */
let liveMeetingPanel = null
/** @type {ReturnType<typeof createFabMenu> | null} */
let fabMenu = null

// Mirrors OUTPUT_LANGUAGES in extension/obsidian/output-language.js — content scripts are
// classic scripts and cannot import ES modules.
const FAB_MENU_OUTPUT_LANGUAGES = [
    { id: "auto", label: "Auto (match meeting)" },
    { id: "en", label: "English" },
    { id: "th", label: "ไทย (Thai)" },
]

/** @param {{left: number, top: number, width: number, height: number}} rect @param {number} viewportWidth @param {number} viewportHeight */
function getFabViewportPosition(rect, viewportWidth, viewportHeight) {
    return {
        left: Math.max(0, Math.min(rect.left, viewportWidth - rect.width)),
        top: Math.max(0, Math.min(rect.top, viewportHeight - rect.height)),
    }
}

/** @param {DOMRect | {left: number, right: number, top: number, bottom: number}} anchor @param {number} viewportWidth @param {number} viewportHeight */
function getLivePanelPlacement(anchor, viewportWidth, viewportHeight) {
    const margin = 12
    const width = Math.max(0, Math.min(400, viewportWidth - margin * 2))
    const height = Math.max(0, Math.min(560, viewportHeight - margin * 2))
    const below = viewportHeight - anchor.bottom - margin - 8
    const above = anchor.top - margin - 8
    const top = below >= height || below >= above
        ? Math.min(anchor.bottom + 8, viewportHeight - height - margin)
        : Math.max(margin, anchor.top - height - 8)
    return { width, height, left: Math.max(margin, Math.min(anchor.right - width, viewportWidth - width - margin)), top: Math.max(margin, top) }
}

/** @param {DOMRect | {left: number, right: number, top: number, bottom: number}} anchor @param {number} viewportWidth @param {number} viewportHeight @param {number} menuHeight */
function getFabMenuPlacement(anchor, viewportWidth, viewportHeight, menuHeight) {
    const margin = 12
    const width = Math.max(0, Math.min(260, viewportWidth - margin * 2))
    const height = Math.max(0, Math.min(menuHeight, viewportHeight - margin * 2))
    const below = viewportHeight - anchor.bottom - margin - 8
    const above = anchor.top - margin - 8
    const top = below >= height || below >= above
        ? Math.min(anchor.bottom + 8, viewportHeight - height - margin)
        : Math.max(margin, anchor.top - height - 8)
    return { width, left: Math.max(margin, Math.min(anchor.right - width, viewportWidth - width - margin)), top: Math.max(margin, top) }
}

/** @param {string} text @param {(TranscriptBlock & {blockIndex: number}) | null} linked @param {number} [now] @returns {CommentNoteEntry} */
function createCommentNoteEntry(text, linked, now = Date.now()) {
    return {
        timestamp: new Date(now).toISOString(),
        text: text.trim(),
        ...(linked ? { linkedTranscript: {
            personName: linked.personName,
            timestamp: linked.timestamp,
            transcriptText: linked.transcriptText,
            blockIndex: linked.blockIndex,
        } } : {}),
    }
}

/** @param {HTMLElement} fab */
function createLiveMeetingPanel(fab) {
    const host = document.createElement("div")
    host.id = "tape-live-panel"
    host.style.cssText = "all:initial; position:fixed; z-index:2147483647; display:none;"
    const root = host.attachShadow({ mode: "closed" })
    root.innerHTML = `
        <style>
            :host { color-scheme:dark; }
            * { box-sizing:border-box; }
            [hidden] { display:none !important; }
            .panel { height:100%; display:flex; flex-direction:column; overflow:hidden; background:#111; color:#f6f6f6; border:1px solid #333; border-radius:12px; box-shadow:0 16px 48px #0007; font:14px/1.45 -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif; }
            header { display:flex; align-items:center; gap:12px; padding:12px 16px; border-bottom:1px solid #333; }
            h2 { margin:0; font-size:14px; flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
            h3 { margin:0; font-size:13px; }
            p { margin:0; white-space:pre-wrap; overflow-wrap:anywhere; }
            button { font:inherit; background:transparent; color:inherit; border:1px solid #444; border-radius:6px; padding:7px 10px; cursor:pointer; }
            button:hover { background:#ffffff12; }
            button:focus-visible,textarea:focus-visible { outline:2px solid #f34f16; outline-offset:2px; }
            button:disabled { opacity:.4; cursor:default; }
            .close { padding:2px 8px; font-size:20px; border:0; }
            .tabs { display:flex; gap:4px; padding:8px 12px; border-bottom:1px solid #333; }
            .tabs button { display:inline-flex; align-items:center; justify-content:center; gap:6px; flex:1; min-width:0; border-color:transparent; font-size:12px; }
            .tabs button[aria-selected="true"] { background:#ffffff16; border-color:#555; }
            .tabs img { width:18px; height:18px; filter:invert(1); }
            .content { flex:1; min-height:0; display:grid; grid-template-rows:minmax(0,1.1fr) minmax(0,.9fr); }
            .workspace { min-height:0; overflow:auto; padding:10px 16px; border-bottom:1px solid #333; }
            .view-heading { display:flex; justify-content:space-between; align-items:center; gap:8px; }
            .run,.save { background:#f34f16; border-color:#f34f16; color:white; font-weight:600; white-space:nowrap; }
            .run:hover,.save:hover { background:#d94411; }
            .hint { margin-top:7px; color:#999; font-size:12px; }
            .assist-output { margin-top:12px; }
            .preview { margin-bottom:10px; padding:9px; border-radius:6px; background:#ffffff10; }
            .preview strong { display:block; margin-bottom:4px; color:#aaa; font-size:12px; }
            .answer { line-height:1.55; }
            .error { color:#fca5a5; }
            .meta { margin-top:8px; color:#888; font-size:12px; }
            label { display:block; margin-bottom:8px; font-size:13px; font-weight:600; }
            textarea { display:block; width:100%; min-height:76px; max-height:180px; resize:vertical; padding:10px; border:1px solid #555; border-radius:8px; background:#222; color:#fff; font:inherit; }
            textarea::placeholder { color:#999; }
            .linked { position:relative; margin-top:10px; padding:9px 32px 9px 10px; background:#292929; border-left:3px solid #f34f16; border-radius:5px; }
            .linked strong { display:block; margin-bottom:3px; font-size:12px; }
            .linked p { max-height:52px; overflow:hidden; color:#bbb; font-size:12px; }
            .clear-link { position:absolute; top:4px; right:5px; border:0; padding:2px 6px; }
            .note-footer { position:sticky; bottom:-10px; display:flex; justify-content:space-between; align-items:center; gap:10px; margin-top:8px; background:#111; }
            .note-status { color:#a7e3b3; font-size:12px; }
            .note-status.error { color:#fca5a5; }
            .transcript-section { display:flex; flex-direction:column; min-height:0; }
            .transcript-heading { display:flex; justify-content:space-between; gap:8px; padding:9px 16px; color:#ddd; font-size:12px; font-weight:600; border-bottom:1px solid #292929; }
            .transcript-heading span { color:#888; font-weight:400; }
            .transcript-scroll { flex:1; min-height:0; overflow:auto; padding:8px; }
            .transcript-item { display:block; width:100%; margin:0 0 4px; padding:9px; text-align:left; border:1px solid transparent; border-radius:7px; }
            .transcript-item[aria-pressed="true"] { border-color:#f34f16; background:#f34f1620; }
            .speaker { display:flex; justify-content:space-between; gap:8px; margin-bottom:3px; color:#999; font-size:12px; }
            .transcript-item.live p { color:#bbb; font-style:italic; }
            .empty { padding:10px; color:#888; font-size:12px; }
        </style>
        <section class="panel" role="dialog" aria-label="Meeting tools" tabindex="-1">
            <header><h2>Live meeting</h2><button type="button" class="close" aria-label="Close meeting tools">×</button></header>
            <div class="tabs" role="tablist" aria-label="Meeting tools">
                <button type="button" role="tab" id="tab-rewind" data-tab="rewind" aria-controls="view-rewind" aria-selected="false"><img src="${FAB_REWIND_ICON_URL}" alt="" />Rewind</button>
                <button type="button" role="tab" id="tab-recap" data-tab="recap" aria-controls="view-recap" aria-selected="false"><img src="${FAB_RECAP_ICON_URL}" alt="" />Recap</button>
                <button type="button" role="tab" id="tab-note" data-tab="note" aria-controls="view-note" aria-selected="true"><img src="${FAB_NOTE_ICON_URL}" alt="" />Note</button>
            </div>
            <div class="content">
                <div class="workspace">
                    <section id="view-rewind" data-view="rewind" role="tabpanel" aria-labelledby="tab-rewind" hidden>
                        <div class="view-heading"><h3>Last 15 seconds</h3><button type="button" class="run" data-run="rewind">Rewind now</button></div>
                        <p class="hint">Recall or clarify the latest captured speech.</p>
                        <div class="assist-output" hidden aria-live="polite"><div class="preview" hidden><strong>Captured captions</strong><p></p></div><p class="answer"></p><p class="meta"></p></div>
                    </section>
                    <section id="view-recap" data-view="recap" role="tabpanel" aria-labelledby="tab-recap" hidden>
                        <div class="view-heading"><h3>Meeting so far</h3><button type="button" class="run" data-run="recap">Recap now</button></div>
                        <p class="hint">Summarize everything captured since the meeting began.</p>
                        <div class="assist-output" hidden aria-live="polite"><p class="answer"></p><p class="meta"></p></div>
                    </section>
                    <section id="view-note" data-view="note" role="tabpanel" aria-labelledby="tab-note">
                        <label for="note-text">Add a note</label>
                        <textarea id="note-text" placeholder="What do you want to remember?"></textarea>
                        <div class="linked" hidden><strong></strong><p></p><button type="button" class="clear-link" aria-label="Remove linked speech">×</button></div>
                        <p class="hint">Select a line in the transcript below to link it to this note.</p>
                        <div class="note-footer"><p class="note-status" role="status" aria-live="polite"></p><button type="button" class="save">Save note</button></div>
                    </section>
                </div>
                <section class="transcript-section" aria-label="Live transcript">
                    <div class="transcript-heading">Live transcript <span>Select speech to link a note</span></div>
                    <div class="transcript-scroll"></div>
                </section>
            </div>
        </section>`
    document.documentElement.appendChild(host)

    const heading = /** @type {HTMLElement} */ (root.querySelector("h2"))
    const workspace = /** @type {HTMLElement} */ (root.querySelector(".workspace"))
    const transcriptScroll = /** @type {HTMLElement} */ (root.querySelector(".transcript-scroll"))
    const textarea = /** @type {HTMLTextAreaElement} */ (root.querySelector("#note-text"))
    const saveButton = /** @type {HTMLButtonElement} */ (root.querySelector(".save"))
    const noteStatus = /** @type {HTMLElement} */ (root.querySelector(".note-status"))
    const linkedView = /** @type {HTMLElement} */ (root.querySelector(".linked"))
    const tabs = root.querySelectorAll("[data-tab]")
    const runButtons = root.querySelectorAll("[data-run]")
    /** @type {"rewind" | "recap" | "note"} */
    let activeTab = "note"
    /** @type {(TranscriptBlock & {blockIndex: number}) | null} */
    let selectedSpeech = null
    let busy = false
    let saving = false
    let disposed = false
    /** @type {HTMLElement | null} */
    let returnFocus = null

    function place() {
        const position = getLivePanelPlacement(fab.getBoundingClientRect(), window.innerWidth, window.innerHeight)
        for (const key of ["width", "height", "left", "top"]) host.style[key] = position[key] + "px"
    }
    function close() {
        host.style.display = "none"
        for (const trigger of fab.querySelectorAll("[aria-controls='tape-live-panel']")) trigger.setAttribute("aria-expanded", "false")
        returnFocus?.focus()
    }
    /** @param {"rewind" | "recap" | "note"} tab */
    function setTab(tab) {
        if (activeTab !== tab) workspace.scrollTop = 0
        activeTab = tab
        for (const button of tabs) {
            const selected = button.getAttribute("data-tab") === tab
            button.setAttribute("aria-selected", String(selected))
            const tabButton = /** @type {HTMLButtonElement} */ (button)
            tabButton.tabIndex = selected ? 0 : -1
        }
        for (const view of root.querySelectorAll("[data-view]")) /** @type {HTMLElement} */ (view).hidden = view.getAttribute("data-view") !== tab
    }
    function renderLink() {
        linkedView.hidden = !selectedSpeech
        const noteHint = /** @type {HTMLElement} */ (root.querySelector("#view-note .hint"))
        noteHint.hidden = !!selectedSpeech
        if (!selectedSpeech) return
        const time = selectedSpeech.timestamp ? new Date(selectedSpeech.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : ""
        linkedView.querySelector("strong").textContent = selectedSpeech.personName + (time ? " · " + time : "")
        linkedView.querySelector("p").textContent = selectedSpeech.transcriptText
    }
    /** @param {number} index @param {TranscriptBlock} block */
    function selectSpeech(index, block) {
        selectedSpeech = { blockIndex: index, personName: block.personName, timestamp: block.timestamp, transcriptText: block.transcriptText }
        for (const item of root.querySelectorAll(".transcript-item")) item.setAttribute("aria-pressed", String(Number(item.getAttribute("data-index")) === index))
        noteStatus.textContent = ""
        setTab("note")
        renderLink()
        textarea.focus()
    }
    function refresh() {
        if (host.style.display === "none" || disposed) return
        const state = currentLiveMeetingState
        const capturing = !!state?.hasMeetingStarted && !state.hasMeetingEnded
        for (const button of runButtons) /** @type {HTMLButtonElement} */ (button).disabled = busy || !capturing
        saveButton.disabled = saving || !capturing
        heading.textContent = state?.meetingTitle || "Live meeting"
        const atBottom = transcriptScroll.scrollHeight - transcriptScroll.scrollTop - transcriptScroll.clientHeight < 50
        transcriptScroll.replaceChildren()
        const blocks = state ? getLiveSnapshot(state, "recap").transcript : []
        for (const [index, block] of blocks.entries()) {
            if (selectedSpeech?.blockIndex === index && selectedSpeech.personName === block.personName && selectedSpeech.timestamp === block.timestamp) selectedSpeech.transcriptText = block.transcriptText
            const item = document.createElement("button")
            item.type = "button"
            item.className = "transcript-item" + (index >= state.transcript.length ? " live" : "")
            item.dataset.index = String(index)
            item.setAttribute("aria-pressed", String(selectedSpeech?.blockIndex === index))
            item.setAttribute("aria-label", "Link a note to " + block.personName + ": " + block.transcriptText)
            const speaker = document.createElement("div")
            speaker.className = "speaker"
            const name = document.createElement("span")
            name.textContent = block.personName
            const time = document.createElement("span")
            time.textContent = block.timestamp ? new Date(block.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : ""
            speaker.append(name, time)
            const text = document.createElement("p")
            text.textContent = block.transcriptText
            item.append(speaker, text)
            item.addEventListener("click", () => selectSpeech(index, block))
            transcriptScroll.appendChild(item)
        }
        if (!blocks.length) {
            const empty = document.createElement("p")
            empty.className = "empty"
            empty.textContent = capturing ? "Waiting for captions…" : "Start meeting capture to use these tools."
            transcriptScroll.appendChild(empty)
        }
        renderLink()
        if (atBottom) transcriptScroll.scrollTop = transcriptScroll.scrollHeight
    }
    /** @param {"rewind" | "recap"} mode */
    function run(mode) {
        if (busy || !currentLiveMeetingState?.hasMeetingStarted || currentLiveMeetingState.hasMeetingEnded) return
        setTab(mode)
        busy = true
        const view = root.querySelector("#view-" + mode)
        const output = /** @type {HTMLElement} */ (view.querySelector(".assist-output"))
        const answer = /** @type {HTMLElement} */ (output.querySelector(".answer"))
        const meta = /** @type {HTMLElement} */ (output.querySelector(".meta"))
        output.hidden = false
        output.setAttribute("aria-busy", "true")
        answer.className = "answer"
        answer.textContent = mode === "rewind" ? "AI is interpreting these captions…" : "Summarizing the meeting so far…"
        meta.textContent = ""
        if (mode === "rewind") {
            const recent = getLiveSnapshot(currentLiveMeetingState, "rewind").transcript
            const preview = /** @type {HTMLElement} */ (output.querySelector(".preview"))
            preview.hidden = recent.length === 0
            preview.querySelector("p").textContent = recent.map(block => block.personName + ": " + block.transcriptText).join("\n")
        }
        refresh()
        workspace.scrollTop = 0
        chrome.runtime.sendMessage({ type: "live_assist", mode }, (response) => {
            const error = chrome.runtime.lastError
            if (disposed) return
            busy = false
            output.setAttribute("aria-busy", "false")
            answer.textContent = !error && typeof response?.message === "string" ? response.message : "Could not reach AI. Please try again."
            answer.className = error || !response?.success ? "answer error" : "answer"
            meta.textContent = response?.progress || (response?.model ? response.model + (response.capturedAt ? " · Through " + new Date(response.capturedAt).toLocaleTimeString() : "") : "")
            refresh()
        })
    }
    function saveNote() {
        const state = currentLiveMeetingState
        if (saving || !state?.hasMeetingStarted || state.hasMeetingEnded) return
        const text = textarea.value.trim()
        if (!text) {
            noteStatus.textContent = "Write a note first."
            noteStatus.classList.add("error")
            textarea.focus()
            return
        }
        saving = true
        saveButton.disabled = true
        noteStatus.classList.remove("error")
        noteStatus.textContent = "Saving…"
        const entry = createCommentNoteEntry(text, selectedSpeech)
        chrome.storage.local.get(["liveCommentNotes"], (result) => {
            if (disposed) return
            if (chrome.runtime.lastError || currentLiveMeetingState !== state || state.hasMeetingEnded) {
                saving = false
                noteStatus.textContent = "Could not save this note. Try again."
                noteStatus.classList.add("error")
                refresh()
                return
            }
            const notes = Array.isArray(result.liveCommentNotes) ? result.liveCommentNotes : []
            chrome.storage.local.set({ liveCommentNotes: [...notes, entry] }, () => {
                if (disposed) return
                saving = false
                if (chrome.runtime.lastError) {
                    noteStatus.textContent = "Could not save this note. Try again."
                    noteStatus.classList.add("error")
                } else {
                    textarea.value = ""
                    selectedSpeech = null
                    noteStatus.textContent = "Note saved"
                    noteStatus.classList.remove("error")
                    renderLink()
                    for (const item of root.querySelectorAll(".transcript-item")) item.setAttribute("aria-pressed", "false")
                }
                refresh()
            })
        })
    }
    /** @param {"rewind" | "recap" | "note"} [mode] */
    function open(mode) {
        if (host.style.display === "none") returnFocus = /** @type {HTMLElement} */ (document.activeElement)
        host.style.display = "block"
        place()
        setTab(mode || activeTab)
        refresh()
        for (const trigger of fab.querySelectorAll("[aria-controls='tape-live-panel']")) trigger.setAttribute("aria-expanded", "true")
        if (mode === "note") textarea.focus()
        else /** @type {HTMLElement} */ (root.querySelector(".close")).focus()
        if (mode === "rewind" || mode === "recap") run(mode)
    }
    function outside(event) {
        if (host.style.display !== "none" && !event.composedPath().includes(host) && !fab.contains(event.target)) close()
    }
    function escape(event) {
        if (event.key === "Escape" && host.style.display !== "none") {
            event.preventDefault()
            event.stopPropagation()
            close()
        }
    }
    root.querySelector(".close").addEventListener("click", close)
    const tabOrder = /** @type {const} */ (["rewind", "recap", "note"])
    for (const element of tabs) {
        const button = /** @type {HTMLButtonElement} */ (element)
        button.addEventListener("click", () => setTab(/** @type {"rewind" | "recap" | "note"} */ (button.getAttribute("data-tab"))))
        button.addEventListener("keydown", (event) => {
            const current = tabOrder.indexOf(activeTab)
            const next = event.key === "ArrowRight" ? (current + 1) % tabOrder.length
                : event.key === "ArrowLeft" ? (current + tabOrder.length - 1) % tabOrder.length
                    : event.key === "Home" ? 0 : event.key === "End" ? tabOrder.length - 1 : -1
            if (next < 0) return
            event.preventDefault()
            setTab(tabOrder[next])
            const nextButton = /** @type {HTMLElement} */ (root.querySelector("#tab-" + tabOrder[next]))
            nextButton.focus()
        })
    }
    for (const button of runButtons) button.addEventListener("click", () => run(/** @type {"rewind" | "recap"} */ (button.getAttribute("data-run"))))
    root.querySelector(".clear-link").addEventListener("click", () => {
        selectedSpeech = null
        renderLink()
        for (const item of root.querySelectorAll(".transcript-item")) item.setAttribute("aria-pressed", "false")
    })
    saveButton.addEventListener("click", saveNote)
    textarea.addEventListener("keydown", (event) => {
        if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
            event.preventDefault()
            saveNote()
        }
    })
    document.addEventListener("pointerdown", outside, true)
    document.addEventListener("keydown", escape, true)
    window.addEventListener("resize", place)
    const observer = new MutationObserver(place)
    observer.observe(fab, { attributes: true, attributeFilter: ["style"] })
    return {
        open, refresh,
        close() { if (host.style.display !== "none") close() },
        toggle() { if (host.style.display === "none") open(); else close() },
        destroy() {
            disposed = true
            observer.disconnect()
            document.removeEventListener("pointerdown", outside, true)
            document.removeEventListener("keydown", escape, true)
            window.removeEventListener("resize", place)
            host.remove()
        },
    }
}

/** @param {HTMLElement} fab @param {"rewind" | "recap" | "note"} [mode] */
function toggleLiveMeetingPanel(fab, mode) {
    fabMenu?.close()
    liveMeetingPanel ||= createLiveMeetingPanel(fab)
    if (mode) liveMeetingPanel.open(mode)
    else liveMeetingPanel.toggle()
}

/** "More" dropdown on the FAB — in-meeting settings, persisted to chrome.storage.sync. @param {HTMLElement} fab */
function createFabMenu(fab) {
    const host = document.createElement("div")
    host.id = "tape-fab-menu"
    host.style.cssText = "all:initial; position:fixed; z-index:2147483647; display:none;"
    const root = host.attachShadow({ mode: "closed" })
    root.innerHTML = `
        <style>
            :host { color-scheme:dark; }
            * { box-sizing:border-box; }
            .menu { background:#111; color:#f6f6f6; border:1px solid #333; border-radius:12px; box-shadow:0 16px 48px #0007; padding:6px; font:14px/1.45 -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif; }
            .title { padding:8px 10px 6px; font-size:12px; font-weight:600; color:#999; text-transform:uppercase; letter-spacing:.04em; }
            .group { padding:6px 10px 4px; font-size:13px; font-weight:600; }
            button { display:flex; align-items:center; gap:8px; width:100%; padding:8px 10px; font:inherit; text-align:left; background:transparent; color:inherit; border:0; border-radius:6px; cursor:pointer; }
            button:hover,button:focus-visible { background:#ffffff14; outline:none; }
            button:focus-visible { box-shadow:inset 0 0 0 2px #f34f16; }
            .check { width:16px; color:#f34f16; font-weight:700; flex-shrink:0; }
            .hint { padding:4px 10px 8px; color:#888; font-size:12px; }
        </style>
        <div class="menu" role="menu" aria-label="Tape settings">
            <div class="title">Settings</div>
            <div class="group" id="language-label">AI output language</div>
            <div role="group" aria-labelledby="language-label">
                ${FAB_MENU_OUTPUT_LANGUAGES.map(language => `<button type="button" role="menuitemradio" aria-checked="false" tabindex="-1" data-language="${language.id}"><span class="check" aria-hidden="true"></span>${language.label}</button>`).join("")}
            </div>
            <p class="hint">Applies to Rewind, Recap and meeting summaries.</p>
        </div>`
    document.documentElement.appendChild(host)

    const menu = /** @type {HTMLElement} */ (root.querySelector(".menu"))
    const items = /** @type {HTMLButtonElement[]} */ ([...root.querySelectorAll("[role='menuitemradio']")])
    const trigger = () => /** @type {HTMLElement | null} */ (fab.querySelector("#fab-menu-button"))
    let selected = "auto"
    let disposed = false

    function isOpen() { return host.style.display !== "none" }
    function place() {
        if (!isOpen()) return
        const position = getFabMenuPlacement(fab.getBoundingClientRect(), window.innerWidth, window.innerHeight, menu.offsetHeight || 220)
        for (const key of ["width", "left", "top"]) host.style[key] = position[key] + "px"
    }
    /** @param {unknown} value */
    function render(value) {
        selected = value === "en" || value === "th" ? value : "auto"
        for (const item of items) {
            const checked = item.dataset.language === selected
            const check = /** @type {HTMLElement} */ (item.querySelector(".check"))
            item.setAttribute("aria-checked", String(checked))
            check.textContent = checked ? "✓" : ""
        }
    }
    /** @param {boolean} [restoreFocus] */
    function close(restoreFocus = true) {
        if (!isOpen()) return
        host.style.display = "none"
        trigger()?.setAttribute("aria-expanded", "false")
        if (restoreFocus) trigger()?.focus()
    }
    function open() {
        liveMeetingPanel?.close()
        host.style.display = "block"
        place()
        trigger()?.setAttribute("aria-expanded", "true")
        chrome.storage.sync.get(["outputLanguage"], (result) => {
            if (disposed) return
            render(result?.outputLanguage)
            ;(items.find(item => item.dataset.language === selected) || items[0]).focus()
        })
    }
    /** @param {string} language */
    function choose(language) {
        render(language)
        chrome.storage.sync.set({ outputLanguage: selected })
        close()
    }
    for (const [index, item] of items.entries()) {
        item.addEventListener("click", () => choose(/** @type {string} */ (item.dataset.language)))
        item.addEventListener("keydown", (event) => {
            const next = event.key === "ArrowDown" ? (index + 1) % items.length
                : event.key === "ArrowUp" ? (index + items.length - 1) % items.length
                    : event.key === "Home" ? 0 : event.key === "End" ? items.length - 1 : -1
            if (next < 0) return
            event.preventDefault()
            items[next].focus()
        })
    }
    /** @param {PointerEvent} event */
    function outside(event) {
        if (isOpen() && !event.composedPath().includes(host) && !trigger()?.contains(/** @type {Node} */ (event.target))) close(false)
    }
    /** @param {KeyboardEvent} event */
    function escape(event) {
        if (event.key === "Escape" && isOpen()) {
            event.preventDefault()
            event.stopPropagation()
            close()
        }
    }
    /** @param {{[key: string]: chrome.storage.StorageChange}} changes @param {string} areaName */
    function storageChanged(changes, areaName) {
        if (areaName === "sync" && changes.outputLanguage) render(changes.outputLanguage.newValue)
    }
    document.addEventListener("pointerdown", outside, true)
    document.addEventListener("keydown", escape, true)
    window.addEventListener("resize", place)
    chrome.storage.onChanged.addListener(storageChanged)
    const observer = new MutationObserver(place)
    observer.observe(fab, { attributes: true, attributeFilter: ["style"] })
    return {
        close() { close(false) },
        toggle() { if (isOpen()) close(); else open() },
        destroy() {
            disposed = true
            observer.disconnect()
            document.removeEventListener("pointerdown", outside, true)
            document.removeEventListener("keydown", escape, true)
            window.removeEventListener("resize", place)
            chrome.storage.onChanged.removeListener(storageChanged)
            host.remove()
        },
    }
}

/** @param {HTMLElement} fab */
function toggleFabMenu(fab) {
    fabMenu ||= createFabMenu(fab)
    fabMenu.toggle()
}
