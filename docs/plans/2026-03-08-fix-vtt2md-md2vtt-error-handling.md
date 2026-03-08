# Fix vtt2md/md2vtt Error Handling Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix the bug where vtt2md and md2vtt steps always show "completed" status even when they fail.

**Architecture:** In the case blocks for vtt2md and md2vtt, add error handling to set status to 'failed' and return early when errors occur.

**Tech Stack:** JavaScript (Node.js), electron

---

### Task 1: Fix vtt2md Error Handling

**Files:**
- Modify: `electron/src/orchestrator.js:233-260`

**Step 1: Read current code**

```bash
# No command needed, will read in next step
```

**Step 2: Modify vtt2md case block**

Find the vtt2md case block (around line 233-250) and add error handling after the error check.

**Step 3: Commit**

```bash
git add electron/src/orchestrator.js
git commit -m "fix: add error handling for vtt2md step"
```

---

### Task 2: Fix md2vtt Error Handling

**Files:**
- Modify: `electron/src/orchestrator.js:261-280`

**Step 1: Read current code to confirm line numbers**

Run: `grep -n "case 'md2vtt':" electron/src/orchestrator.js`

**Step 2: Modify md2vtt case block**

Find the md2vtt case block and add error handling after the error check.

**Step 3: Commit**

```bash
git add electron/src/orchestrator.js
git commit -m "fix: add error handling for md2vtt step"
```

---

### Task 3: Verify the Fix

**Step 1: Check overall logic**

Verify that after both fixes:
- If no errors: step status = 'completed' (set by the else branch)
- If errors: step status = 'failed' (set in the case blocks above)
