# 移除 original.md 和 original.vtt 设计

## 目标

简化流水线，不再生成 `original.md` 和 `original.vtt`，直接使用 `article_source_lang` 读取对应语言的文件。

## 修改内容

### 1. run.sh

**移除生成 original.md 的逻辑：**
- 删除 line 427-432 中复制和生成 original.md 的代码
- 文章生成时直接读取 `original_{article_source_lang}.md`

**修改位置：**
- line 224-227: 跳过 original.md 的判断 → 改为检查对应语言文件
- line 427-432: 删除 cp 和生成 original.vtt 的代码
- line 477-483: 改为读取 `original_${article_source_lang}.md`

### 2. 保留的文件

| 文件 | 用途 |
|------|------|
| `original_en.md` | 英文逐字稿 |
| `original_zh.md` | 中文逐字稿 |
| `original_en.vtt` | 字幕模块英文 |
| `original_zh.vtt` | 字幕模块中文 |

### 3. meta.json

保持现有 `article_source_lang` 字段不变。

## 测试验证

运行脚本后检查：
- `work/<id>/transcript/` 下不再有 `original.md` 和 `original.vtt`
- 文章生成正常（读取正确的语言版本）
- 字幕模块正常切换中英文
