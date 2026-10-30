#!/bin/bash
# PreToolUse(Bash) guard: keep agents off the upstream fork parent (vivek-nexus/transcriptonic).
# See AGENTS.md "Repository scope". Reads are fine; outward-facing commands are denied.
cmd=$(jq -r '.tool_input.command // ""')

deny() {
    jq -n --arg r "$1 This repo is pawisssh/tape; vivek-nexus/transcriptonic is off limits (AGENTS.md)." \
        '{hookSpecificOutput: {hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: $r}}'
    exit 0
}

# gh or curl naming the upstream repo/owner.
if grep -Eiq '(^|[^[:alnum:]_-])(gh|curl)[[:space:]].*(vivek-nexus|transcriptonic)' <<<"$cmd"; then
    deny "Blocked: gh/curl command targets the upstream repo."
fi

# git push to the upstream remote or an upstream URL.
if grep -Eiq 'git([[:space:]]+-C[[:space:]]+[^[:space:]]+)?[[:space:]]+push[^;&|]*([[:space:]]upstream([[:space:]]|$)|vivek-nexus)' <<<"$cmd"; then
    deny "Blocked: git push to upstream."
fi

# gh writes without an explicit --repo pawisssh/tape can resolve to the fork parent.
if grep -Eq '(^|[^[:alnum:]_-])gh[[:space:]]+(pr|issue)[[:space:]]+(create|comment|merge|close|reopen|edit|review|ready)' <<<"$cmd" \
    && ! grep -Eq '(--repo|-R)[[:space:]=]+pawisssh/tape' <<<"$cmd"; then
    deny "Blocked: gh pr/issue write without --repo pawisssh/tape."
fi

exit 0
