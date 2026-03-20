#!/bin/bash
#
# Pure subtitle fallback planning (offline, no network).
#
# Key idea:
# - Traditional fallback (zh-TW -> zh-Hant) is triggered only when:
#   - en-orig original is missing
#   - zh-Hans original is missing
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

  # Gate: Traditional fallback happens only when BOTH:
  # - en-orig original is missing OR simulated to fail
  # - zh-Hans original is missing OR simulated to fail
  local en_orig_failed_or_missing="yes"
  if [ "$en_orig_present" = "yes" ]; then
    # Keys use "<subs_lang>.<type>" (e.g. "zh-TW.original")
    if _sfp_is_failed_key "en-orig.original"; then
      en_orig_failed_or_missing="yes"
    else
      en_orig_failed_or_missing="no"
    fi
  fi

  local zh_hans_failed_or_missing="yes"
  if [ "$zh_hans_present" = "yes" ]; then
    if _sfp_is_failed_key "zh-Hans.original"; then
      zh_hans_failed_or_missing="yes"
    else
      zh_hans_failed_or_missing="no"
    fi
  fi

  local traditional_trigger="no"
  if [ "$en_orig_failed_or_missing" = "yes" ] && [ "$zh_hans_failed_or_missing" = "yes" ]; then
    traditional_trigger="yes"
  fi

  echo "GATE en-orig_original_present=${en_orig_present}"
  echo "GATE zh-Hans_original_present=${zh_hans_present}"
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

  if [ "$zh_hans_present" = "yes" ]; then
    if _sfp_attempt "zh" "zh-Hans" "original"; then
      zh_done="yes"
    else
      # zh-Hans original failed -> try auto before considering Traditional fallback.
      if _sfp_attempt "zh" "zh-Hans" "auto"; then
        zh_done="yes"
      fi
    fi
  fi

  if [ "$zh_done" = "no" ]; then
    if [ "$traditional_trigger" = "yes" ]; then
      # Traditional fallback bucket: zh-TW -> zh-Hant, original first, then auto on failure.
      if [ "$zh_tw_present" = "yes" ] && [ "$zh_done" = "no" ]; then
        if _sfp_attempt "zh" "zh-TW" "original"; then
          zh_done="yes"
        else
          if _sfp_attempt "zh" "zh-TW" "auto"; then
            zh_done="yes"
          fi
        fi
      fi

      if [ "$zh_hant_present" = "yes" ] && [ "$zh_done" = "no" ]; then
        if _sfp_attempt "zh" "zh-Hant" "original"; then
          zh_done="yes"
        else
          if _sfp_attempt "zh" "zh-Hant" "auto"; then
            zh_done="yes"
          fi
        fi
      fi

      # If Traditional fallback still doesn't succeed, allow the generic zh auto as last resort.
      if [ "$zh_done" = "no" ] && [ "$zh_auto_present" = "yes" ]; then
        if _sfp_attempt "zh" "zh" "auto"; then
          zh_done="yes"
        fi
      fi
    else
      # Gate not met -> no Traditional fallback attempts; only generic zh auto can be used.
      if [ "$zh_auto_present" = "yes" ]; then
        if _sfp_attempt "zh" "zh" "auto"; then
          zh_done="yes"
        fi
      fi
    fi
  fi
}

