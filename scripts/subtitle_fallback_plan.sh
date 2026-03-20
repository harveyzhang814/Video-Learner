#!/bin/bash
#
# Pure subtitle fallback planning (offline, no network).
#
# Key idea:
# - Traditional fallback (zh-TW -> zh-Hant) is triggered only when:
#   - English has no subtitles downloaded at all (neither en-orig original nor en auto succeed)
#   - Simplified Chinese has no subtitles downloaded at all (neither zh-Hans original/auto nor generic zh auto succeed)
# - Attempt order must be deterministic for unit tests.
#

set -euo pipefail

_sfp_token_present() {
  local text="$1"
  local token="$2"
  # Split by whitespace; treat exact token matches as present.
  printf "%s" "$text" | awk -v token="$token" 'BEGIN { RS = "[[:space:]]+" } $0 == token { found = 1 } END { exit(found ? 0 : 1) }'
}

_sfp_fail_set_init() {
  # SIMULATE_DOWNLOAD_FAILURES format (comma-separated):
  #   "zh-TW.original,zh-TW.auto"
  # Keys are "<subs_lang>.<type>" where type is "original"|"auto".
  FAIL_KEYS=()
  if [ -n "${SIMULATE_DOWNLOAD_FAILURES:-}" ]; then
    IFS=',' read -r -a FAIL_KEYS <<< "${SIMULATE_DOWNLOAD_FAILURES}"
  fi
}

_sfp_is_failed_key() {
  local key="$1"
  local k
  for k in "${FAIL_KEYS[@]:-}"; do
    # Trim spaces around items (defensive for CI).
    k="${k#"${k%%[![:space:]]*}"}"
    k="${k%"${k##*[![:space:]]}"}"
    if [ -n "$k" ] && [ "$k" = "$key" ]; then
      return 0
    fi
  done
  return 1
}

_sfp_attempt() {
  local target_lang="$1"   # "en" or "zh" (download naming contract)
  local subs_lang="$2"     # "en-orig", "en", "zh-Hans", "zh-TW", "zh-Hant"
  local sub_type="$3"      # "original" | "auto"

  echo "ATTEMPT ${target_lang} ${subs_lang} ${sub_type}"

  local fail_key="${subs_lang}.${sub_type}"
  if _sfp_is_failed_key "$fail_key"; then
    echo "SIMULATED_FAIL ${target_lang} ${subs_lang} ${sub_type}"
    return 1
  fi

  return 0
}

plan_subtitle_fallback_attempts() {
  # Usage:
  #   plan_subtitle_fallback_attempts "$available_subs_text"
  #
  # Prints:
  #   - gate lines
  #   - ordered "ATTEMPT ..." lines
  #
  local available_subs_text="${1:-}"

  _sfp_fail_set_init

  local en_orig_present="no"
  local zh_hans_present="no"
  local zh_tw_present="no"
  local zh_hant_present="no"
  local en_present="no"
  local zh_auto_present="no"

  if _sfp_token_present "$available_subs_text" "en-orig"; then en_orig_present="yes"; fi
  if _sfp_token_present "$available_subs_text" "zh-Hans"; then zh_hans_present="yes"; fi
  if _sfp_token_present "$available_subs_text" "zh-TW"; then zh_tw_present="yes"; fi
  if _sfp_token_present "$available_subs_text" "zh-Hant"; then zh_hant_present="yes"; fi
  if _sfp_token_present "$available_subs_text" "en"; then en_present="yes"; fi
  if _sfp_token_present "$available_subs_text" "zh"; then zh_auto_present="yes"; fi

  # Gate: Traditional fallback happens only when BOTH are false during planning:
  # - en_any_downloaded: neither en-orig original nor en auto succeed
  # - zh_any_downloaded: neither zh-Hans original/auto succeed nor generic zh auto succeed
  local en_any_downloaded="no"
  if [ "$en_orig_present" = "yes" ]; then
    if ! _sfp_is_failed_key "en-orig.original"; then
      en_any_downloaded="yes"
    fi
  fi
  if [ "$en_any_downloaded" = "no" ] && [ "$en_present" = "yes" ]; then
    if ! _sfp_is_failed_key "en.auto"; then
      en_any_downloaded="yes"
    fi
  fi

  local zh_any_downloaded="no"
  # zh-Hans: original OR auto (both map to zh-Hans.* simulation keys).
  if [ "$zh_hans_present" = "yes" ]; then
    if ! _sfp_is_failed_key "zh-Hans.original"; then
      zh_any_downloaded="yes"
    elif ! _sfp_is_failed_key "zh-Hans.auto"; then
      zh_any_downloaded="yes"
    fi
  fi
  # generic zh auto only counts when zh-Hans has no successful download.
  if [ "$zh_any_downloaded" = "no" ] && [ "$zh_auto_present" = "yes" ]; then
    if ! _sfp_is_failed_key "zh.auto"; then
      zh_any_downloaded="yes"
    fi
  fi

  local traditional_trigger="no"
  if [ "$en_any_downloaded" = "no" ] && [ "$zh_any_downloaded" = "no" ]; then
    traditional_trigger="yes"
  fi

  echo "GATE en_any_downloaded=${en_any_downloaded}"
  echo "GATE zh_any_downloaded=${zh_any_downloaded}"
  echo "GATE traditional_fallback_triggered=${traditional_trigger}"

  # English channel: original preferred, else auto.
  local en_done="no"
  if [ "$en_orig_present" = "yes" ]; then
    if _sfp_attempt "en" "en-orig" "original"; then
      en_done="yes"
    fi
  fi

  if [ "$en_done" = "no" ] && [ "$en_present" = "yes" ]; then
    if _sfp_attempt "en" "en" "auto"; then
      en_done="yes"
    fi
  fi

  # Chinese channel
  local zh_done="no"

  # Simplified attempt order:
  # zh-Hans original -> (fail) zh-Hans auto -> (still fail && available) generic zh auto
  if [ "$zh_hans_present" = "yes" ]; then
    if _sfp_attempt "zh" "zh-Hans" "original"; then
      zh_done="yes"
    else
      if _sfp_attempt "zh" "zh-Hans" "auto"; then
        zh_done="yes"
      fi
    fi
  fi

  if [ "$zh_done" = "no" ] && [ "$zh_auto_present" = "yes" ]; then
    if _sfp_attempt "zh" "zh" "auto"; then
      zh_done="yes"
    fi
  fi

  # Traditional fallback attempt order (only when both channels have no subtitles):
  # zh-TW original -> (fail) zh-TW auto -> zh-Hant original -> (fail) zh-Hant auto
  if [ "$zh_done" = "no" ] && [ "$traditional_trigger" = "yes" ]; then
    if [ "$zh_tw_present" = "yes" ]; then
      if _sfp_attempt "zh" "zh-TW" "original"; then
        zh_done="yes"
      else
        if _sfp_attempt "zh" "zh-TW" "auto"; then
          zh_done="yes"
        fi
      fi
    fi

    if [ "$zh_done" = "no" ] && [ "$zh_hant_present" = "yes" ]; then
      if _sfp_attempt "zh" "zh-Hant" "original"; then
        zh_done="yes"
      else
        if _sfp_attempt "zh" "zh-Hant" "auto"; then
          zh_done="yes"
        fi
      fi
    fi
  fi
}

