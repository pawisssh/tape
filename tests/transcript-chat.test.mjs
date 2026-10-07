import { describe, test } from "node:test"
import assert from "node:assert/strict"
import { buildTranscriptChatMessages } from "../extension/obsidian/transcript-chat.js"

function makeMeeting() {
    return {
        meetingSoftware: "Google Meet",
        meetingTitle: "Launch review",
        meetingStartTimestamp: "2026-01-01T09:00:00.000Z",
        meetingEndTimestamp: "2026-01-01T09:30:00.000Z",
        transcript: [
            {
                personName: "Ada",
                timestamp: "2026-01-01T09:01:00.000Z",
                transcriptText: "The launch moves to Friday.",
            },
        ],
        chatMessages: [
            {
                personName: "Ben",
                timestamp: "2026-01-01T09:02:00.000Z",
                chatMessageText: "I will update the release notes.",
            },
        ],
        webhookPostStatus: "new",
    }
}

describe("buildTranscriptChatMessages", () => {
    test("grounds the conversation in the transcript and preserves session turns", () => {
        const history = [
            { id: "1", role: "user", content: "When is launch?", createdAt: "2026-01-01T10:00:00.000Z" },
            { id: "2", role: "assistant", content: "Friday.", createdAt: "2026-01-01T10:00:01.000Z" },
        ]

        const messages = buildTranscriptChatMessages(makeMeeting(), history, "auto")

        assert.equal(messages[0].role, "system")
        assert.match(messages[0].content, /Use only the supplied meeting source/)
        assert.match(messages[0].content, /Launch review/)
        assert.match(messages[0].content, /Ada/)
        assert.match(messages[0].content, /The launch moves to Friday\./)
        assert.match(messages[0].content, /I will update the release notes\./)
        assert.deepEqual(messages.slice(1), [
            { role: "user", content: "When is launch?" },
            { role: "assistant", content: "Friday." },
        ])
    })

    test("includes the configured output language instruction", () => {
        const messages = buildTranscriptChatMessages(makeMeeting(), [], "th")
        assert.match(messages[0].content, /Write every natural-language value in your answer in Thai/)
    })
})
