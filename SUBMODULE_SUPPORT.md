# Git Submodule 支持文档

## 功能描述

本更新为 CJ GitLab VSCode 插件添加了 Git submodule 的支持，允许用户：

1. **自动检测 submodule** — 插件会自动识别项目中定义的所有 Git submodule
2. **在 Tab 中展示 submodule** — submodule 会作为独立的 Tab 显示在左侧栏中，与工作区项目并列
3. **在 submodule 间切换** — 用户可以点击 submodule Tab 来切换当前工作的项目
4. **标识 submodule** — submodule Tab 会显示 "SM" badge 来区分于普通工作区项目

## 实现细节

### 后端（TypeScript）

#### GitlabService.ts 新增方法

**1. `getSubmodules()`**
- 从 `.gitmodules` 文件读取 submodule 配置
- 获取每个 submodule 的名称、路径、URL 和当前分支
- 返回 submodule 信息数组

**2. `getAllWorkspaceProjectInfos()` 增强**
- 原有功能：收集所有工作区项目
- 新增功能：追加所有 submodule 信息
- 每个项目/submodule 返回：
  - `name`: 项目/submodule 名称
  - `branch`: 当前分支
  - `fsPath`: 完整文件系统路径
  - `isActive`: 是否当前活跃
  - `isSubmodule`: 是否为 submodule（新增标志）

**3. `getCurrentWorkspaceFolder()` 增强**
- 支持非工作区路径的 submodule
- 动态创建虚拟 WorkspaceFolder 对象用于 submodule

### 前端（Vue）

#### 视图层更改（index.html）

- Tab 元素添加 `workspace-tab-submodule` class（条件绑定）
- Tab 内添加 "SM" badge 用于标识 submodule

#### 样式层更改（styles.css）

```css
.workspace-tab-submodule {
  opacity: 0.75;  /* submodule tab 稍微透明化 */
}

.workspace-tab-badge {
  position: absolute;
  top: -4px;
  right: -4px;
  background: #007acc;
  color: white;
  font-size: 10px;
  font-weight: 700;
  padding: 2px 4px;
  border-radius: 3px;
}
```

#### 逻辑层更改（main.js）

- Tab 切换逻辑已支持 submodule 路径
- `switchProject()` 方法处理 submodule 的切换

### 后端视图层更改（CJGitlabView.ts）

- `switchProject` 命令处理器增强：
  - 先尝试从工作区文件夹查找
  - 如果不是工作区项目，则作为 submodule 处理

## 使用场景

### 场景 1：多子模块项目

```
主项目（main-project）
├── submodule: common-ui
├── submodule: shared-utils
└── submodule: api-client
```

**Tab 展示：**
- MP（Main Project）- 当前活跃
- CU（Common UI） - SM badge
- SU（Shared Utils） - SM badge
- AC（API Client） - SM badge

用户可点击任何 Tab 切换工作环境，对应项目的分支、pipeline、tag 等信息会更新。

### 场景 2：混合工作区 + Submodule

```
VSCode 工作区（多文件夹）
├── Folder: backend-service
├── Folder: frontend-app
└── Submodule: shared-libs (在 backend-service 中)
```

**Tab 展示：**
- BS（Backend Service）
- FA（Frontend App）
- SL（Shared Libs） - SM badge

### 场景 3：嵌套 Submodule（当前支持）

如果 submodule 中还有 submodule，当前实现只会检测第一级。

## 技术注意事项

1. **Submodule 初始化**
   - 如果 submodule 未初始化（目录为空），会显示分支为 "N/A"
   - 点击该 Tab 仍会尝试切换，但 GitLab API 调用可能失败（这是正常的）

2. **性能**
   - `.getSubmodules()` 在首次加载时被调用
   - 使用 git config 读取，性能开销很小

3. **路径处理**
   - submodule 路径支持嵌套（如 `packages/common/shared-ui`）
   - 使用相对路径存储在 `.gitmodules`，运行时转换为绝对路径

## 测试建议

1. **基础功能**
   - [ ] 创建包含 submodule 的测试项目
   - [ ] 验证 Tab 显示正确
   - [ ] 验证 SM badge 显示

2. **切换功能**
   - [ ] 点击 submodule Tab 切换成功
   - [ ] 切换后 projectInfo.name 正确
   - [ ] 切换后 currentBranch 正确

3. **边界情况**
   - [ ] 未初始化的 submodule
   - [ ] 没有 .gitmodules 文件的项目
   - [ ] Submodule 路径包含特殊字符

4. **UI 视觉**
   - [ ] SM badge 位置和样式正确
   - [ ] 悬停时 Tab 展开正常
   - [ ] 激活状态颜色正确

## 未来增强

1. **嵌套 submodule 支持** — 递归扫描多层 submodule
2. **快速初始化** — 按钮快速初始化未初始化的 submodule
3. **路径导航** — 右键菜单在文件浏览器中打开 submodule
4. **批量操作** — 对多个 submodule 执行 pull/push 操作
