#!/bin/bash

# 确保脚本在错误时停止执行
set -e

# 使用 patch 版本升级
echo "开始升级补丁版本..."
npm version patch

# 获取新的版本号
NEW_VERSION=$(node -p "require('./package.json').version")

# 提交并推送更改
git push origin master

# 切换到 Node.js 18
echo "切换到 Node.js 18..."
nvm use 18

# 执行 vsce publish
echo "开始发布到 VS Code Marketplace..."
yarn vsce publish

echo "✨ 发布完成！版本: v$NEW_VERSION" 