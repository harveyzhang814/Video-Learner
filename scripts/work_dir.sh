#!/bin/bash
# scripts/work_dir.sh — resolve the configurable work root/dir. SOURCE ONLY.
#
# Resolution (must mirror core/paths.js):
#   1. env WORK_ROOT (non-empty)
#   2. else WORK_ROOT from scripts/settings.conf
#   3. else project dir (parent of scripts/)
# Exports: WORK_ROOT, WORK_DIR (=<root>/work), DB_PATH (=<work>/database.sqlite).
# Ensures WORK_DIR exists.

_wd_script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
_wd_project_dir="$(dirname "$_wd_script_dir")"

# 1+2: only consult settings.conf when env did not provide WORK_ROOT.
if [ -z "${WORK_ROOT:-}" ] && [ -f "$_wd_script_dir/settings.conf" ]; then
    # shellcheck source=/dev/null
    source "$_wd_script_dir/settings.conf"
fi

# 3: default to project dir.
if [ -z "${WORK_ROOT:-}" ]; then
    WORK_ROOT="$_wd_project_dir"
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
