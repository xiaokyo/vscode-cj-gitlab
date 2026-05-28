#!/bin/bash
# submodule-test-setup.sh
# 用于快速创建一个测试项目结构来验证 submodule 功能

set -e

TEST_DIR="${1:-.}/test-submodule-project"
echo "📦 创建测试项目结构: $TEST_DIR"

# 创建测试目录
mkdir -p "$TEST_DIR"
cd "$TEST_DIR"

# 如果已经是 git 仓库，清理
if [ -d ".git" ]; then
  echo "⚠️  项目已存在，清理中..."
  rm -rf .git .gitmodules
fi

echo ""
echo "🔧 初始化主项目..."
git init
git config user.email "test@example.com"
git config user.name "Test User"
echo "# Main Project" > README.md
git add README.md
git commit -m "Initial commit: main project"

echo ""
echo "📚 创建 submodule 1: shared-utils"
mkdir -p libs/shared-utils
cd libs/shared-utils
git init
git config user.email "test@example.com"
git config user.name "Test User"
echo "# Shared Utils Library" > README.md
git add README.md
git commit -m "Initial commit: shared-utils"
cd ../../

echo ""
echo "📚 创建 submodule 2: common-ui"
mkdir -p libs/common-ui
cd libs/common-ui
git init
git config user.email "test@example.com"
git config user.name "Test User"
echo "# Common UI Components" > README.md
git add README.md
git commit -m "Initial commit: common-ui"
cd ../../

echo ""
echo "🔗 添加 submodule 到主项目..."
git submodule add ./libs/shared-utils libs/shared-utils
git submodule add ./libs/common-ui libs/common-ui

echo ""
echo "✅ 提交 submodule 配置..."
git add .gitmodules .gitignore
git commit -m "Add submodules: shared-utils, common-ui"

echo ""
echo "📋 项目结构:"
tree -L 3 -a 2>/dev/null || find . -not -path '*/\.*' -type f | head -20

echo ""
echo "✅ 测试项目创建完成！"
echo ""
echo "📝 接下来的步骤:"
echo "1. 在 VSCode 中打开: code $TEST_DIR"
echo "2. 打开 CJ GitLab 面板 (左侧边栏)"
echo "3. 查看是否显示多个 Tab (主项目 + 2 个 submodule)"
echo "4. 点击 submodule Tab 切换项目"
echo "5. 验证分支信息是否正确更新"
echo ""
