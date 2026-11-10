const SELECTORS_GOOGLE_MEET = {
    USER_NAME: ".awLEm",
    MEETING_TITLE: ".u6vdEc",
    GOOGLE_SYMBOLS: ".google-symbols",
    TEXT_CALL_END: "call_end",
    // Captions toggle icon ligatures. Older Meet shows closed_caption_off / closed_caption;
    // newer Meet shows translate_cc (a combined translate + captions menu) whose ligature
    // doesn't change with state, so only its button's aria-pressed tells on from off.
    TEXT_CAPTIONS_OFF: "closed_caption_off",
    TEXT_CAPTIONS_ON: "closed_caption",
    TEXT_CAPTIONS_TRANSLATE: "translate_cc",
    TEXT_CAPTIONS_ALL: ["closed_caption_off", "closed_caption", "translate_cc"],
    TEXT_CHAT: "chat",
    TRANSCRIPT_REGION: 'div[role="region"][tabindex="0"]',
    CHAT_LIVE_REGION: 'div[aria-live="polite"].Ge9Kpc'
}