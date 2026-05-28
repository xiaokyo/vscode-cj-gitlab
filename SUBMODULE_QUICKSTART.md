# 快速开始 - Submodule 支持

## 测试 Submodule 功能

### 创建测试项目结构

如果你想测试 submodule 功能，可以按照以下步骤创建测试项目：

```bash
# 1. 创建主项目
mkdir test-main-project
cd test-main-project
git init
echo "# Main Project" > README.md
git add .
git commit -m "Initial commit"

# 2. 添加 submodule（示例：共享库）
# 方式A：添加本地 submodule（用于测试）
mkdir ../shared-lib
cd ../shared-lib
git init
echo "# Shared Library" > README.md
git add .
git commit -m "Initial commit"

# 方式B：添加远程 submodule
cd ../test-main-project
git submodule add ../shared-lib ./libs/shared-lib
git add .gitmodules .gitignore
git commit -m "Add submodule: shared-lib"

# 3. 在 VSCode 中打开主项目
code test-main-project
```

### 验证功能

1. **打开 CJ GitLab 面板**
   - 在 VSCode 左侧边栏找到 CJ GitLab 图标
   - 点击进入 CJ GitLab 视图

2. **查看 Tab 显示**
   - 如果项目有 submodule，会看到多个 Tab
   - Submodule 会显示 "SM" badge 进行区分
   - 例如：`MP`（主项目）、`SL`（shared-lib）- SM

3. **切换 Tab**
   - 点击任何 Tab 进行切换
   - 观察项目信息是否正确更新
   - 分支、Pipeline、Tag 等信息应对应切换后的项目

4. **查看日志**
   - 在 VSCode 输出面板（Output）中查看 "CJ GitLab" 日志
   - 可以看到 submodule 检测的详细过程

## 常见问题

### Q: 为什么 submodule 分支显示为 "N/A"？
**A:** 这通常表示 submodule 目录存在但还未初始化。运行 `git submodule update --init` 初始化后会显示正确的分支。

### Q: 我能直接在 submodule Tab 中提交代码吗？
**A:** 可以。当你切换到 submodule Tab 时，所有操作（如提交、push 到测试环境等）都会在该 submodule 中执行。

### Q: 如果项目中没有 submodule 会怎样？
**A:** 不会显示额外的 Tab。只显示工作区文件夹。这是正常的。

### Q: Submodule 支持多层嵌套吗？
**A:** 当前版本只支持第一级 submodule。如果 submodule 中还有 submodule，需要在 submodule 中再打开一个项目窗口。

## 深入了解

详见 [SUBMODULE_SUPPORT.md](./SUBMODULE_SUPPORT.md) 文档获取技术细节。
