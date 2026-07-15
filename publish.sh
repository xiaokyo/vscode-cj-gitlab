#!/usr/bin/env bash
# 一键：版本+1 → vsce publish。用法: ./publish.sh [patch|minor|major]，默认 patch
# vsce 需 node18+（node16 undici 报 ReadableStream is not defined），脚本内切 nvm 20
set -euo pipefail
cd "$(dirname "$0")"

BUMP="${1:-patch}"

# 切到 node20（若装了 nvm）
if [ -s "$HOME/.nvm/nvm.sh" ]; then
  export NVM_DIR="$HOME/.nvm"
  # shellcheck source=/dev/null
  . "$NVM_DIR/nvm.sh"
  nvm use 20 >/dev/null 2>&1 || nvm use 18 >/dev/null 2>&1 || true
fi

NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
if [ "$NODE_MAJOR" -lt 18 ]; then
  echo "✗ 需 node>=18，当前 $(node -v)。装 nvm 或手动切换后重试" >&2
  exit 1
fi

# bump 前记录 package.json 是否已有未提交改动：脏则无法干净隔离版本行，跳过自动提交，避免裹挟无关改动
PKG_DIRTY_BEFORE=0
if [ -n "$(git status --porcelain -- package.json 2>/dev/null)" ]; then
  PKG_DIRTY_BEFORE=1
fi

OLD="$(node -p "require('./package.json').version")"
# npm version 会写 package.json；--no-git-tag-version 不打 tag/不提交
NEW="$(npm version "$BUMP" --no-git-tag-version | tr -d 'v')"
echo "版本 $OLD → $NEW"

npx vsce publish

# 发布成功后提交版本改动（仅当 bump 前 package.json 干净，才能保证提交只含版本行）
if [ "$PKG_DIRTY_BEFORE" -eq 1 ]; then
  echo "⚠ 发布成功 v$NEW，但 package.json 发布前已有其它未提交改动，跳过自动提交" >&2
  echo "  请自行提交版本改动（勿裹挟无关改动）" >&2
else
  git add package.json
  if git diff --cached --quiet -- package.json; then
    echo "✓ 已发布 v$NEW（package.json 无改动，跳过提交）"
  else
    git commit -q -m "chore: release v$NEW"
    echo "✓ 已发布 v$NEW 并提交版本改动"
  fi
fi
