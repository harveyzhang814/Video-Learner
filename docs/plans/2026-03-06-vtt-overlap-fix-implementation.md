# VTT Overlap Fix Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix the overlap issue in vtt_converter.py where output lines contain repeated content from previous lines.

**Architecture:** Add a post-processing step that removes overlapping prefixes from consecutive entries by finding the longest common prefix between adjacent texts.

**Tech Stack:** Python 3, regex, string manipulation

---

### Task 1: Add overlap removal function

**Files:**
- Modify: `scripts/vtt_converter.py:30-60`

**Step 1: Write the test for overlap removal**

Create a temporary test file to verify the function:

```python
# Test overlap removal logic
def remove_overlap_prefix(current_text, previous_text, min_overlap=3):
    """Remove overlapping prefix from current text"""
    if not previous_text or not current_text:
        return current_text

    # Find longest common prefix
    overlap = ""
    for i in range(len(previous_text)):
        if current_text.startswith(previous_text[i:]):
            overlap = previous_text[i:]
            break

    # Only remove if overlap is significant
    if len(overlap) >= min_overlap:
        return current_text[len(overlap):].lstrip()
    return current_text


# Test cases
def test_remove_overlap_prefix():
    # Case 1: Clear overlap
    result = remove_overlap_prefix(
        "new release stuff and it's all headlined by what I saw",
        "All right, so Apple is doing a week of new release stuff and it's all headlined"
    )
    assert result == "by what I saw", f"Got: {result}"

    # Case 2: No overlap
    result = remove_overlap_prefix(
        "completely different text",
        "some previous text"
    )
    assert result == "completely different text", f"Got: {result}"

    # Case 3: Short overlap (less than 3 chars)
    result = remove_overlap_prefix(
        "abc different text",
        "xyz abc something"
    )
    assert result == "abc different text", f"Got: {result}"

    print("All tests passed!")


if __name__ == '__main__':
    test_remove_overlap_prefix()
```

**Step 2: Run test to verify logic**

Run: `python3 -c "$(cat << 'EOF'
def remove_overlap_prefix(current_text, previous_text, min_overlap=3):
    if not previous_text or not current_text:
        return current_text
    for i in range(len(previous_text)):
        if current_text.startswith(previous_text[i:]):
            overlap = previous_text[i:]
            break
    else:
        overlap = ""
    if len(overlap) >= min_overlap:
        return current_text[len(overlap):].lstrip()
    return current_text

# Test cases
result = remove_overlap_prefix(
    "new release stuff and it's all headlined by what I saw",
    "All right, so Apple is doing a week of new release stuff and it's all headlined"
)
assert result == "by what I saw", f"Got: {result}"

result = remove_overlap_prefix(
    "completely different text",
    "some previous text"
)
assert result == "completely different text", f"Got: {result}"

result = remove_overlap_prefix(
    "abc different text",
    "xyz abc something"
)
assert result == "abc different text", f"Got: {result}"

print("All tests passed!")
EOF
)"`
Expected: "All tests passed!"

**Step 3: Modify vtt_converter.py to add overlap removal**

Read the current file and modify the merge logic:

```python
# Add this helper function before the convert_vtt_to_markdown function
def remove_overlap_prefix(current_text, previous_text, min_overlap=3):
    """Remove overlapping prefix from current text."""
    if not previous_text or not current_text:
        return current_text

    # Find longest common prefix by trying different offsets
    for i in range(len(previous_text)):
        if current_text.startswith(previous_text[i:]):
            overlap = previous_text[i:]
            break
    else:
        overlap = ""

    # Only remove if overlap is significant (>= min_overlap chars)
    if len(overlap) >= min_overlap:
        return current_text[len(overlap):].lstrip()
    return current_text
```

Then modify the merge loop (around line 38-51) to use this function:

```python
    # Merge entries with overlap removal
    if entries:
        merged = []
        current_sec, current_start, current_text = entries[0]
        for sec, start, text in entries[1:]:
            time_diff = sec - current_sec

            if time_diff < 0.5:
                # Case 1: nearby in time - merge with longer text
                if len(text) > len(current_text):
                    current_sec, current_start, current_text = sec, start, text
            else:
                # Check for overlap before adding
                cleaned_text = remove_overlap_prefix(text, current_text)
                merged.append((current_start, current_text))
                current_sec, current_start, current_text = sec, start, cleaned_text
        merged.append((current_start, current_text))
```

**Step 4: Run the converter on test file to verify**

Run: `python3 scripts/vtt_converter.py work/4bf170397cf1/transcript/subs/4bf170397cf1.en.auto.vtt /tmp/test_output.md`

Then check output: `head -20 /tmp/test_output.md`

Expected: First few lines should NOT have overlapping content:
```
[00:00:02] All right, so Apple is doing a week of
[00:00:04] by what I saw today, which is the newest, cheapest entry to the MacBook
[00:00:10] lineup, the MacBook Neo. First of all,
```

**Step 5: Commit**

Run:
```bash
git add scripts/vtt_converter.py
git commit -m "fix: remove overlapping prefixes in VTT converter

- Add remove_overlap_prefix function to find and remove common prefixes
- Modify merge logic to clean up overlapping content between entries"
```
