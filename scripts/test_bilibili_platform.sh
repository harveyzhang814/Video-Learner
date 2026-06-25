#!/bin/bash
# Offline unit tests for scripts/platform.sh

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
source "$SCRIPT_DIR/platform.sh"

pass=0; fail=0
ok()   { echo "PASS: $1"; pass=$((pass+1)); }
nok()  { echo "FAIL: $1"; fail=$((fail+1)); }

# Bilibili URLs — must return true (exit 0)
is_bilibili "https://www.bilibili.com/video/BV1xx411c7mD"       && ok "www.bilibili.com"        || nok "www.bilibili.com"
is_bilibili "https://bilibili.com/video/BV1xx"                  && ok "bilibili.com (no www)"   || nok "bilibili.com (no www)"
is_bilibili "https://www.bilibili.com/video/BV1BJ411W7pX?p=3"  && ok "bilibili.com with ?p="   || nok "bilibili.com with ?p="
is_bilibili "https://m.bilibili.com/video/BV1xx"                && ok "m.bilibili.com"          || nok "m.bilibili.com"

# Non-Bilibili URLs — must return false (exit 1)
is_bilibili "https://www.youtube.com/watch?v=dQw4w9WgXcQ" && nok "youtube should be false" || ok "youtube is false"
is_bilibili "https://youtu.be/dQw4w9WgXcQ"                && nok "youtu.be should be false" || ok "youtu.be is false"
is_bilibili "https://vimeo.com/123456"                     && nok "vimeo should be false"   || ok "vimeo is false"
is_bilibili ""                                             && nok "empty should be false"   || ok "empty is false"

echo ""
echo "Results: $pass passed, $fail failed"
[ "$fail" -eq 0 ] || exit 1
