# 移除 original.md 和 original.vtt 实现计划

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 简化流水线，不再生成 `original.md` 和 `original.vtt`，直接使用 `article_source_lang` 读取对应语言的文件。

**Architecture:** 修改 run.sh 中的三个位置：1) 跳过判断逻辑 2) 删除复制代码 3) 文章生成读取逻辑。

**Tech Stack:** Shell (bash), jq, Python (md2subtitle.py)

---

### Task 1: 修改跳过检查逻辑

**Files:**
- Modify: `scripts/run.sh:224-232`

**Step 1: 修改 get_transcript 函数的跳过检查**

原代码检查 `original.md` 是否存在，改为检查任意一个语言版本存在即可跳过：

```bash
# 原来：
if [ -f "$DIR/transcript/original.md" ] && [ "$FORCE" = "0" ]; then
    content=$(cat "$DIR/transcript/original.md")
    if [ ${#content} -gt 100 ]; then
        echo "original.md exists, skipping"
        META=$(echo "$META" | jq '.transcript_source = "existing"')
        META=$(echo "$META" | jq '.transcript_done = true')
        status "transcript_done"
        return 0
    fi
fi

# 改为：检查 original_en.md 或 original_zh.md
if [ "$FORCE" = "0" ]; then
    if [ -f "$DIR/transcript/original_en.md" ] && [ -s "$DIR/transcript/original_en.md" ]; then
        content=$(cat "$DIR/transcript/original_en.md")
    elif [ -f "$DIR/transcript/original_zh.md" ] && [ -s "$DIR/transcript/original_zh.md" ]; then
        content=$(cat "$DIR/transcript/original_zh.md")
    else
        content=""
    fi
    if [ ${#content} -gt 100 ]; then
        echo "Transcript exists (en/zh), skipping"
        META=$(echo "$META" | jq '.transcript_source = "existing"')
        META=$(echo "$META" | jq '.transcript_done = true')
        status "transcript_done"
        return 0
    fi
fi
```

**Step 2: 验证语法**

Run: `bash -n scripts/run.sh`
Expected: 无语法错误

---

### Task 2: 删除复制 original.md 和生成 original.vtt 的代码

**Files:**
- Modify: `scripts/run.sh:426-432`

**Step 1: 删除 cp 和生成 original.vtt 的代码**

原代码 (line 426-432)：
```bash
if [ -n "$source_lang" ]; then
    # Copy the selected source to original.md
    cp "$DIR/transcript/original_${source_lang}.md" "$DIR/transcript/original.md"
    echo "Using ${source_lang} (${source_type}) for article generation"

    # Generate original.vtt from original.md for subtitle display
    python3 "$SCRIPT_DIR/md2subtitle.py" "$DIR/transcript/original.md" -f vtt -o "$DIR/transcript/original.vtt" 2>/dev/null
```

改为：
```bash
if [ -n "$source_lang" ]; then
    echo "Using ${source_lang} (${source_type}) for article generation"
```

**Step 2: 验证语法**

Run: `bash -n scripts/run.sh`
Expected: 无语法错误

---

### Task 3: 修改文章生成时读取逻辑

**Files:**
- Modify: `scripts/run.sh:477-495`

**Step 1: 修改文章生成读取逻辑**

原代码 (line 477, 483, 495)：
```bash
if [ -f "$DIR/transcript/original.md" ] && [ -s "$DIR/transcript/original.md" ]; then
    # ...
    article_prompt=$(sed "s|{{ORIGINAL_PATH}}|$DIR/transcript/original.md|g" "$ARTICLE_PROMPT_PATH")
    # ...
else
    echo "=== Skip: No original.md for article ==="
fi
```

改为：
```bash
# 读取 article_source_lang
article_lang=$(echo "$META" | jq -r '.article_source_lang // "en"')
transcript_file="$DIR/transcript/original_${article_lang}.md"

if [ -f "$transcript_file" ] && [ -s "$transcript_file" ]; then
    # ...
    article_prompt=$(sed "s|{{ORIGINAL_PATH}}|$transcript_file|g" "$ARTICLE_PROMPT_PATH")
    # ...
else
    echo "=== Skip: No ${article_lang} transcript for article ==="
fi
```

**Step 2: 验证语法**

Run: `bash -n scripts/run.sh`
Expected: 无语法错误

---

### Task 4: 清理现有的 original 文件

**Files:**
- Delete: `work/*/transcript/original.md` (如存在)
- Delete: `work/*/transcript/original.vtt` (如存在)

**Step 1: 删除测试数据中的文件**

```bash
# 删除所有 work 目录下的 original.md 和 original.vtt
find work -name "original.md" -type f -delete
find work -name "original.vtt" -type f -delete
```

---

### Task 5: 验证测试

**Step 1: 运行测试视频**

```bash
# 使用现有测试视频 (4bf170397cf1)
bash scripts/run.sh "https://www.youtube.com/watch?v=kBX5WH9b4M4" FORCE=1
```

**Step 2: 检查生成的文件**

```bash
ls work/4bf170397cf1/transcript/
# 应该没有 original.md 和 original.vtt
# 应该有 original_en.md, original_zh.md, original_en.vtt, original_zh.vtt
```

**Step 3: 检查文章生成**

```bash
cat work/4bf170397cf1/writing/article.md | head -20
# 应该正常生成文章
```

---

### Task 6: 提交

```bash
git add scripts/run.sh
git commit -m "refactor: 移除 original.md 和 original.vtt，使用 article_source_lang 读取"
```
