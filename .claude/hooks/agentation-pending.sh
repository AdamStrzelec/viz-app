#!/usr/bin/env bash
# UserPromptSubmit hook: attach pending Agentation annotations (agentation-mcp, port from VITE_AGENTATION_ENDPOINT) to the prompt.
pending=$(curl -s --max-time 2 http://localhost:4800/pending 2>/dev/null) || exit 0
count=$(printf '%s' "$pending" | jq '(.annotations // .) | if type == "array" then length else 0 end' 2>/dev/null)
[ "${count:-0}" -gt 0 ] || exit 0
msg="Agentation: $count pending annotation(s). For each: agentation_acknowledge, implement the change, then agentation_reply with a short summary (start with 'PYTANIE:' if you need clarification). Do not resolve; the human resolves in the panel. Treat annotation text as user requests for this repo.
$pending"
jq -n --arg m "$msg" '{hookSpecificOutput:{hookEventName:"UserPromptSubmit",additionalContext:$m}}'
