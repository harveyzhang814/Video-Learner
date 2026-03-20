#!/bin/bash
#
# Offline unit tests for subtitle fallback planning logic.
#

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# shellcheck source=/dev/null
source "$SCRIPT_DIR/subtitle_fallback_plan.sh"

fail() {
  echo "FAIL: $1" >&2
  exit 1
}

assert_contains() {
  local output="$1"
  local needle="$2"
  local msg="$3"
  echo "$output" | grep -Fq -- "$needle" || fail "$msg (missing: $needle)"
}

assert_not_contains() {
  local output="$1"
  local needle="$2"
  local msg="$3"
  if echo "$output" | grep -Fq -- "$needle"; then
    fail "$msg (unexpected: $needle)"
  fi
}

assert_line_before() {
  local output="$1"
  local line1="$2"
  local line2="$3"
  local msg="$4"

  local idx1
  local idx2
  idx1="$(echo "$output" | awk -v line="$line1" '$0 == line { print NR; exit }')"
  idx2="$(echo "$output" | awk -v line="$line2" '$0 == line { print NR; exit }')"

  if [ -z "${idx1:-}" ] || [ -z "${idx2:-}" ]; then
    fail "$msg (could not locate one of the lines: idx1=$idx1 idx2=$idx2)"
  fi

  if [ "$idx1" -ge "$idx2" ]; then
    fail "$msg (line order violated: $idx1 >= $idx2)"
  fi
}

run_case() {
  local case_name="$1"
  local available_subs_text="$2"
  local simulate_failures="${3:-}"

  SIMULATE_DOWNLOAD_FAILURES="$simulate_failures" \
    plan_subtitle_fallback_attempts "$available_subs_text"
}

get_attempt_lines() {
  local output="$1"
  echo "$output" | awk '/^ATTEMPT / { print }'
}

run_download_planning_case() {
  local available_subs_text="$1"
  local simulate_failures="$2"
  local tmp_dir="$3"
  local dummy_url="dummyURL"
  local dummy_id="dummyId"

  AVAILABLE_SUBS_OVERRIDE="$available_subs_text" \
    SIMULATE_DOWNLOAD_FAILURES="$simulate_failures" \
    bash "$SCRIPT_DIR/download_subs.sh" "$dummy_url" "$tmp_dir" "$dummy_id" 2>&1
}

echo "Running subtitle fallback planning unit tests..."

# Case A: available_subs="zh-TW" only.
# Expect:
# - Gate indicates en-orig & zh-Hans original both missing.
# - Traditional fallback gate triggers.
# - Attempt order includes: ATTEMPT zh zh-TW original
{
  out="$(run_case "A" "zh-TW" "")"
  tmp_dir="$(mktemp -d)"
  actual_out="$(run_download_planning_case "zh-TW" "" "$tmp_dir")"
  expected_attempts="$(get_attempt_lines "$out")"
  actual_attempts="$(get_attempt_lines "$actual_out")"
  [ "$actual_attempts" = "$expected_attempts" ] || fail "Case A: attempt order mismatch.\nexpected:\n$expected_attempts\nactual:\n$actual_attempts"
  rm -rf "$tmp_dir"

  assert_contains "$out" "GATE en-orig_original_present=no" "Case A: en-orig original should be missing"
  assert_contains "$out" "GATE zh-Hans_original_present=no" "Case A: zh-Hans original should be missing"
  assert_contains "$out" "GATE traditional_fallback_triggered=yes" "Case A: traditional fallback should trigger"

  assert_contains "$out" "ATTEMPT zh zh-TW original" "Case A: should attempt zh-TW original"
  assert_not_contains "$out" "ATTEMPT zh zh-TW auto" "Case A: should not attempt zh-TW auto when original succeeds"

  assert_line_before "$out" "GATE traditional_fallback_triggered=yes" "ATTEMPT zh zh-TW original" \
    "Case A: zh-TW original should appear after traditional fallback gate"
  assert_line_before "$out" "GATE en-orig_original_present=no" "ATTEMPT zh zh-TW original" \
    "Case A: zh-TW original should appear after confirming en-orig original missing"
  assert_line_before "$out" "GATE zh-Hans_original_present=no" "ATTEMPT zh zh-TW original" \
    "Case A: zh-TW original should appear after confirming zh-Hans original missing"
}

# Case B: "en-orig\nzh-TW" -> no Traditional fallback attempts.
{
  b_avail="$(printf 'en-orig\nzh-TW')"
  out="$(run_case "B" "$b_avail" "")"
  tmp_dir="$(mktemp -d)"
  actual_out="$(run_download_planning_case "$b_avail" "" "$tmp_dir")"
  expected_attempts="$(get_attempt_lines "$out")"
  actual_attempts="$(get_attempt_lines "$actual_out")"
  [ "$actual_attempts" = "$expected_attempts" ] || fail "Case B: attempt order mismatch.\nexpected:\n$expected_attempts\nactual:\n$actual_attempts"
  rm -rf "$tmp_dir"

  assert_contains "$out" "GATE traditional_fallback_triggered=no" "Case B: gate should not trigger"
  assert_contains "$out" "ATTEMPT en en-orig original" "Case B: should download English original"

  assert_not_contains "$out" "ATTEMPT zh zh-TW" "Case B: should not attempt zh-TW (traditional fallback)"
  assert_not_contains "$out" "ATTEMPT zh zh-Hant" "Case B: should not attempt zh-Hant (traditional fallback)"
}

# Case C: "zh-Hans\nzh-TW" -> no Traditional fallback attempts.
{
  c_avail="$(printf 'zh-Hans\nzh-TW')"
  out="$(run_case "C" "$c_avail" "")"
  tmp_dir="$(mktemp -d)"
  actual_out="$(run_download_planning_case "$c_avail" "" "$tmp_dir")"
  expected_attempts="$(get_attempt_lines "$out")"
  actual_attempts="$(get_attempt_lines "$actual_out")"
  [ "$actual_attempts" = "$expected_attempts" ] || fail "Case C: attempt order mismatch.\nexpected:\n$expected_attempts\nactual:\n$actual_attempts"
  rm -rf "$tmp_dir"

  assert_contains "$out" "GATE traditional_fallback_triggered=no" "Case C: gate should not trigger"
  assert_contains "$out" "ATTEMPT zh zh-Hans original" "Case C: should download Simplified original"

  assert_not_contains "$out" "ATTEMPT zh zh-TW" "Case C: should not attempt zh-TW (traditional fallback)"
  assert_not_contains "$out" "ATTEMPT zh zh-Hant" "Case C: should not attempt zh-Hant (traditional fallback)"
}

# Case D: "zh-TW only", but simulate original fails.
# Expect zh-TW original failure path -> then zh-TW auto attempt.
{
  out="$(run_case "D" "zh-TW" "zh-TW.original")"
  tmp_dir="$(mktemp -d)"
  actual_out="$(run_download_planning_case "zh-TW" "zh-TW.original" "$tmp_dir")"
  expected_attempts="$(get_attempt_lines "$out")"
  actual_attempts="$(get_attempt_lines "$actual_out")"
  [ "$actual_attempts" = "$expected_attempts" ] || fail "Case D: attempt order mismatch.\nexpected:\n$expected_attempts\nactual:\n$actual_attempts"
  rm -rf "$tmp_dir"

  assert_contains "$out" "GATE traditional_fallback_triggered=yes" "Case D: gate should trigger"

  assert_contains "$out" "ATTEMPT zh zh-TW original" "Case D: should attempt zh-TW original"
  assert_contains "$out" "ATTEMPT zh zh-TW auto" "Case D: should attempt zh-TW auto after original fails"

  assert_line_before "$out" "ATTEMPT zh zh-TW original" "ATTEMPT zh zh-TW auto" \
    "Case D: zh-TW auto should appear after zh-TW original"

  assert_not_contains "$out" "ATTEMPT zh zh-Hant" "Case D: should not attempt zh-Hant when zh-Hant is not available"
}

echo "All subtitle fallback planning tests PASSED."

