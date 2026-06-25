#!/bin/bash
# scripts/work_dir.sh — resolve the configurable work root/dir. SOURCE ONLY.
#
# Resolution (mirrors core/paths.js):
#   1. env WORK_ROOT (non-empty)
#   2. else WORK_ROOT from VDL_CONFIG_FILE or ~/.config/vdl/settings.conf
#   3. else ~/vdl-work
# Exports: WORK_ROOT, WORK_DIR (=<root>/work), DB_PATH (=<work>/database.sqlite).
# Ensures WORK_DIR exists.

_wd_script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# 1+2: load user config only when env did not provide WORK_ROOT.
if [ -z "${WORK_ROOT:-}" ]; then
    # shellcheck source=/dev/null
    source "$_wd_script_dir/user-config.sh"
fi

# 3: default to ~/vdl-work.
if [ -z "${WORK_ROOT:-}" ]; then
    WORK_ROOT="$HOME/vdl-work"
fi

# Expand leading ~ (bash already expanded $VARs when sourcing settings.conf;
# an env-provided value is taken as-is except for ~).
case "$WORK_ROOT" in
    "~")   WORK_ROOT="$HOME" ;;
    "~/"*) WORK_ROOT="$HOME/${WORK_ROOT#\~/}" ;;
esac

# Strip trailing slashes.
while [ "${WORK_ROOT}" != "/" ] && [ "${WORK_ROOT%/}" != "${WORK_ROOT}" ]; do
    WORK_ROOT="${WORK_ROOT%/}"
done

WORK_DIR="$WORK_ROOT/work"
DB_PATH="$WORK_DIR/database.sqlite"
mkdir -p "$WORK_DIR"
export WORK_ROOT WORK_DIR DB_PATH
