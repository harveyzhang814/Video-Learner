#!/bin/bash
# Optional cookie options for yt-dlp (YouTube "Sign in to confirm you're not a bot").
# Source this in scripts that call yt-dlp, then use: yt-dlp $YT_DLP_COOKIE_OPTS ...
# Config: copy scripts/settings.example.conf to scripts/settings.conf and set
#   YT_DLP_COOKIES_BROWSER=chrome   # or safari, firefox, edge
#   and/or YT_DLP_COOKIES_FILE=/path/to/cookies.txt (Netscape format)

YT_DLP_COOKIE_OPTS=""
_ydc_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=/dev/null
source "$_ydc_dir/user-config.sh"
if [ -n "${YT_DLP_COOKIES_BROWSER:-}" ]; then
    YT_DLP_COOKIE_OPTS="--cookies-from-browser $YT_DLP_COOKIES_BROWSER"
elif [ -n "${YT_DLP_COOKIES_FILE:-}" ] && [ -f "$YT_DLP_COOKIES_FILE" ]; then
    YT_DLP_COOKIE_OPTS="--cookies $YT_DLP_COOKIES_FILE"
fi
unset _ydc_dir
