#!/bin/bash
# scripts/user-config.sh — load user config into environment. SOURCE ONLY.
#
# Resolution order:
#   1. VDL_CONFIG_FILE env var (for testing / override)
#   2. ~/.config/vdl/settings.conf (persistent user config)
#
# After sourcing, all variables from the config file are available in the caller's env.

VDL_USER_CONFIG="${VDL_CONFIG_FILE:-$HOME/.config/vdl/settings.conf}"

if [ -f "$VDL_USER_CONFIG" ]; then
    # shellcheck source=/dev/null
    source "$VDL_USER_CONFIG"
fi
