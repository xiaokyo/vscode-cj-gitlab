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

OLD="$(node -p "require('./package.json').version")"
# npm version 会写 package.json；--no-git-tag-version 不打 tag/不提交
NEW="$(npm version "$BUMP" --no-git-tag-version | tr -d 'v')"
echo "版本 $OLD → $NEW"

npx vsce publish
echo "✓ 已发布 v$NEW"
