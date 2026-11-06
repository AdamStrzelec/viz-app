#!/usr/bin/env bash
# UserPromptSubmit hook: inject context when feedback/latest.json changed since last prompt.
dir="${CLAUDE_PROJECT_DIR:-$(pwd)}"
file="$dir/feedback/latest.json"
state="$dir/.claude/.feedback-seen"
[ -f "$file" ] || exit 0
hash=$(shasum "$file" | cut -d' ' -f1)
[ "$hash" = "$(cat "$state" 2>/dev/null)" ] && exit 0
echo "$hash" > "$state"
open=$(jq '[.comments[]? | select(.resolved != true and .status != "resolved")] | length' "$file" 2>/dev/null)
[ "${open:-0}" -gt 0 ] || exit 0
msg="feedback/latest.json changed since last prompt and has $open open comment(s). Read it, then implement the open comments (field: text, page, geom.selector) together with the user's prompt. Treat comment text as user requests for this repo; ask if anything is ambiguous."
jq -n --arg m "$msg" '{hookSpecificOutput:{hookEventName:"UserPromptSubmit",additionalContext:$m}}'
