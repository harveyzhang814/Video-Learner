#!/bin/bash
# Platform detection utilities for yt-dlp download scripts.
# Source this file, then call: is_bilibili "$URL"

# Returns 0 (true) if URL is from bilibili.com (any subdomain)
is_bilibili() {
    local url="${1:-}"
    [[ "$url" == *bilibili.com* ]]
}
