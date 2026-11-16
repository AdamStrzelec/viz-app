#!/usr/bin/env bash
# Project status line: records context usage for the visual review panel (vite.visual-review.ts reads it),
# then renders the user's global status line unchanged.
input=$(cat)
dir="${CLAUDE_PROJECT_DIR:-$(pwd)}/.claude/.context-usage"
sid=$(printf '%s' "$input" | jq -r '.session_id // empty')
pct=$(printf '%s' "$input" | jq -r '.context_window.used_percentage // empty')
if [ -n "$sid" ] && [ -n "$pct" ]; then
  mkdir -p "$dir"
  printf '%s' "$input" | jq -c '{session_id, used_percentage: .context_window.used_percentage, updated_at: (now * 1000 | floor)}' \
    > "$dir/$sid.json" 2>/dev/null
fi
global="$HOME/.claude/statusline-command.sh"
[ -f "$global" ] && printf '%s' "$input" | bash "$global"
