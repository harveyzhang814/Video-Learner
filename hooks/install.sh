#!/usr/bin/env bash
# hooks/install.sh — 将 hooks/ 目录下的 Git hooks 安装到 .git/hooks/
# 用法: bash hooks/install.sh
# 每次添加新 hook 后重新运行即可。

set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel)"
HOOKS_SRC="$REPO_ROOT/hooks"
HOOKS_DST="$REPO_ROOT/.git/hooks"

installed=0
skipped=0

for src in "$HOOKS_SRC"/*; do
  name="$(basename "$src")"

  # 跳过本脚本自身和非可执行文件
  [[ "$name" == "install.sh" ]] && continue
  [[ ! -f "$src" ]] && continue

  dst="$HOOKS_DST/$name"

  # 如果目标已是指向同一源的符号链接，跳过
  if [[ -L "$dst" && "$(readlink "$dst")" == "$src" ]]; then
    echo "  already linked: $name"
    ((skipped++)) || true
    continue
  fi

  # 备份已有的非符号链接 hook
  if [[ -f "$dst" && ! -L "$dst" ]]; then
    mv "$dst" "${dst}.bak"
    echo "  backed up existing: $name → ${name}.bak"
  fi

  ln -sf "$src" "$dst"
  chmod +x "$src"
  echo "  installed: $name"
  ((installed++)) || true
done

echo ""
echo "完成：安装 $installed 个 hook，跳过 $skipped 个。"
