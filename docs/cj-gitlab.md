# 系统级要求

规划执行需求开始时，都要使用curl --noproxy "*" 请求地址 https://wiki.cjdropshipping.cn/plugins/viewstorage/viewpagestorage.action?pageId=88507465 查看最新执行要求，规划任务给subagent也需告知subagent需要阅读；
1、文档需要完整阅读一遍，分析出完整任务后，在当前文档最后阅读位置插入阅读标记“# 26年1月1日 xx:xx:xx(取系统实时日期和时间) ，第x次提交(补充需求时，加上第x次补充)\n👨‍💻**提交人：${git username 运行git命令获取}**\n ## 规划任务: \n### xxxx(任务1)\n### xxxx(任务2)“；
2、任务完成后在第1条规则插入末尾插入执行结果的时间及状态，例子“## 任务处理结果: \n > ### 📄xxxx 处理结果（使用引用任务信息，给出完成内容，如果是排查问题，直接写出排查依据和结果） \n🛑**26年1月1日 xx:xx:xx 第x次提交已完成**”。 
3、完成每个任务和本文档写入后，使用“ `wc -l`当前文件行号或`tail` 当前文档尾部”的方式检查最新补充，如果存在更新或者补充要求，继续执行第1、2条规则，否则执行下一条规则；
4、每次文档更新需要遵循TDD开发模式及本文档`系统级要求`要求重新规划完成任务；规划最后一个任务必须是使用askQuestions工具Multi-select模式要求我补充需求（首选项：阅读 ${当前文档路径} 完成补充任务，如果用户选择此项表示用户在当前文档补充了新需求，需要按照要求重新读取文档内容，如果没有在尾部读取到新内容可能用户未保存，需重新调用askQuestions工具询问，Multi-select模式列出建议的后续任务），检查任务完整性不得跳过。

# 任务描述：
- 多工作区间的时候在UI上体现多项目的tab，可以自由切换
- 每个tab上显示项目名称和当前分支名称
- 切换tab时自动切换对应的工作区和分支
- Pipeline Status的下面还要展示正在运行的merge request请求

# 26年03月30日 14:35:14，第1次提交
👨‍💻**提交人：小K**
## 规划任务:
### 1. 扩展 GitlabService 支持获取所有工作区项目信息及其分支、MR 数据
### 2. 扩展 CJGitlabView 向 webview 传递所有工作区项目列表（含分支名）
### 3. 在 webview index.html 头部实现多项目 Tab 栏（项目名 + 分支名）
### 4. webview main.js 处理 Tab 切换并发送 switchProject 消息
### 5. CJGitlabView 处理 switchProject 消息，切换工作区并刷新
### 6. Pipeline Status 下方新增 Active Merge Requests 面板
### 7. 静态检查和编译验证

## 任务处理结果:
> ### 📄任务1 - GitlabService 新增 `getAllWorkspaceProjectInfos()` 方法
> 遍历所有 `vscode.workspace.workspaceFolders`，对每个项目执行 `git rev-parse --abbrev-ref HEAD` 获取当前分支，返回 `{ name, branch, fsPath, isActive }` 数组。

> ### 📄任务2 - CJGitlabView 传递多项目数据
> `updateContent()` 中调用 `getAllWorkspaceProjectInfos()` 获取 `workspaceTabs`，同时获取当前项目的 opened 状态 MR 列表 `activeMergeRequests`，一并写入 `__INITIAL_STATE__`。

> ### 📄任务3 - webview index.html 多项目 Tab 栏
> 在 `#app` 顶部添加 `.workspace-tabs` 容器，仅在工作区项目 > 1 时显示。每个 Tab 展示项目名(`.workspace-tab-name`) + 分支名 badge(`.workspace-tab-branch`)，active 状态高亮。

> ### 📄任务4 - main.js Tab 切换 + MR 消息处理
> 新增 `switchProject(tab)` 方法，发送 `{ command: 'switchProject', fsPath }` 消息。新增 `activeMergeRequests` data 属性，监听 `active_merge_requests` 消息更新。

> ### 📄任务5 - CJGitlabView 处理 switchProject
> `onDidReceiveMessage` 新增 `switchProject` case，根据 `data.fsPath` 找到对应 workspace folder，调用 `setTargetProjectByWorkspaceFolder` + `refresh()`。

> ### 📄任务6 - Active Merge Requests 面板
> Pipeline Status 下方新增 `.active-mr-panel`，展示当前项目所有 opened MR（标题链接、源→目标分支、作者、merge_status badge）。定时器每5秒同步更新。

> ### 📄任务7 - 编译验证
> `webpack --mode production` 编译成功，无 TS 错误。

**改动文件清单**：
- `src/GitlabService.ts` — 新增 `getAllWorkspaceProjectInfos()`
- `src/CJGitlabView.ts` — 新增 `switchProject` 消息处理、传递 `workspaceTabs` + `activeMergeRequests`、定时器中同步 MR
- `resources/webview/index.html` — 新增 workspace-tabs 和 active-mr-panel
- `resources/webview/main.js` — 新增 `switchProject` 方法、`activeMergeRequests` 数据、`active_merge_requests` 消息监听
- `resources/webview/styles.css` — 新增 Tab 栏和 MR 面板样式

🛑**26年03月30日 14:44:52 第1次提交已完成**

补充：
- 运行的Pipeline对应的merge request也要展示出来

# 26年03月30日 14:52:25，第2次提交（第1次补充）
👨‍💻**提交人：小K**
## 规划任务:
### 1. Pipeline Status 区域下方关联展示该 Pipeline ref 对应的 MR

## 任务处理结果:
> ### 📄Pipeline 关联 MR 展示
> 在 Pipeline Status 面板内部，pipeline-meta 下方新增 `pipeline-mr-list`，通过 computed `pipelineMergeRequests` 过滤 `activeMergeRequests` 中 `source_branch === pipelineInfo.ref` 的 MR。每个 MR 展示标题链接和目标分支。

**改动文件**：
- `resources/webview/index.html` — Pipeline Status 内新增 Related MR 区域
- `resources/webview/main.js` — 新增 `pipelineMergeRequests` computed
- `resources/webview/styles.css` — 新增 `.pipeline-mr-*` 样式

🛑**26年03月30日 14:53:42 第2次提交（第1次补充）已完成**

补充：
- activeMergeRequests的样式不要展示成Pipeline的子项，单独展示，还要展示是否有冲突，是否可以合并等信息
- Pipeline相关的MR没有展示出来，排查原因并修复

# 26年03月30日 14:59:22，第3次提交（第2次补充）
👨‍💻**提交人：小K**
## 规划任务:
### 1. 排查 Pipeline 关联 MR 不展示的原因并修复
### 2. 重构 Pipeline 关联 MR 为独立面板，增加冲突/可合并信息

## 任务处理结果:
> ### 📄任务1 - Pipeline 关联 MR 不展示排查与修复
> **根因**：`pipelineMergeRequests` computed 仅匹配 `mr.source_branch === pipeline.ref`，但 pipeline 合并后运行在目标分支上时 `ref` 等于目标分支名（如 `dev`/`master`），无法匹配 MR 的 source_branch。
> **修复**：改为匹配 `mr.source_branch === ref || mr.target_branch === ref`，覆盖源分支推送触发和目标分支合并触发两种场景。

> ### 📄任务2 - 重构 MR 面板为独立展示 + 冲突信息
> - Pipeline 关联 MR 从 `.pipeline-status-content` 内部移出，改为独立的 `.active-mr-panel`
> - Active MR 面板增加 `has_conflicts` 冲突标记（⚠️ 有冲突）
> - `merge_status` 展示改为中文可读格式（`formatMergeStatus`：✅ 可合并 / ❌ 不可合并 / ⏳ 未检查 / 🔄 检查中）
> - MergeRequestN 类型新增 `has_conflicts?: boolean` 字段

**改动文件**：
- `resources/webview/index.html` — Pipeline MR 移为独立面板，Active MR 增加冲突/可合并展示
- `resources/webview/main.js` — 修复 `pipelineMergeRequests` 匹配逻辑，新增 `formatMergeStatus` 方法
- `resources/webview/styles.css` — 新增 `.active-mr-conflict` 样式
- `src/types/mergeRequestN.ts` — 新增 `has_conflicts` 字段

🛑**26年03月30日 15:01:30 第3次提交（第2次补充）已完成**

补充：
- Active Merge Requests要单独展示，不要放在Pipeline Status下面，增加一个标题Active Merge Requests，展示每个MR的状态（是否有冲突，是否可以合并等信息）

# 26年03月30日 15:03:41，第4次提交（第3次补充）
👨‍💻**提交人：小K**
## 规划任务:
### 1. 确认当前代码状态并打包 vsix 安装测试

## 任务处理结果:
> ### 📄确认：Active MR 面板已在第3次提交中完成独立化
> 当前 `index.html` 中 Active Merge Requests 已是独立面板（非 Pipeline 子项），有独立标题 "Active Merge Requests"，每个 MR 展示：
> - 标题（可点击跳转）
> - 源分支 → 目标分支
> - 作者
> - merge_status（✅ 可合并 / ❌ 不可合并 / ⏳ 未检查 / 🔄 检查中）
> - has_conflicts 冲突标记（⚠️ 有冲突）
>
> 此需求在第3次提交中已实现。若看不到效果，需要重新打包 vsix 安装。

已打包并安装 `cj-gitlab-0.1.21.vsix`，请重新加载 VS Code 窗口查看效果。

🛑**26年03月30日 15:09:35 第4次提交（第3次补充）已完成**

补充：
- 有Tab进行切换了，就不需要切换项目的按钮了

# 26年03月30日 15:11:20，第5次提交（第4次补充）
👨‍💻**提交人：小K**
## 规划任务:
### 1. 移除 header 中的 "切换项目" 按钮行

## 任务处理结果:
> ### 📄移除切换项目按钮
> 从 `index.html` header 中移除了 `.workspace-switch-row`（包含"目标项目"标签和"切换项目"按钮），由 Tab 栏完成项目切换功能。
> 已重新打包 `cj-gitlab-0.1.21.vsix` 并安装。

🛑**26年03月30日 15:14:41 第5次提交（第4次补充）已完成**

补充：
- 切换tab时要有loading效果

# 26年03月30日 15:15:09，第6次提交（第5次补充）
👨‍💻**提交人：小K**
## 规划任务:
### 1. 切换 Tab 时在 webview 内显示 loading 遮罩

## 任务处理结果:
> ### 📄Tab 切换 Loading 效果
> - 新增 `tabSwitching` data，点击非 active Tab 时立即设为 `true`
> - 新增 `.global-loading` 遮罩（固定定位 + 旋转 spinner + 文案"切换项目中..."）
> - Tab 切换后 `CJGitlabView.refresh()` 重建整个 webview HTML，loading 遮罩随旧 DOM 销毁
> - 已打包安装 `cj-gitlab-0.1.21.vsix`

🛑**26年03月30日 15:16:28 第6次提交（第5次补充）已完成**

补充：
- Pipeline Related MR不是相关分支的MR，而是当前Pipeline的ref对应的MR，是已经合并对应Pipeline的MR

# 26年03月30日 15:26:34，第7次提交（第6次补充）
👨‍💻**提交人：小K**
## 规划任务:
### 1. 获取已合并到 Pipeline ref 分支的 MR 列表并展示

## 任务处理结果:
> ### 📄Pipeline Related MR 改为已合并 MR
> **根因**：之前使用 `activeMergeRequests`（opened 状态）过滤，但需求是展示 **已合并到 pipeline.ref 分支** 的 MR。
> **修复**：
> - `GitlabService` 新增 `getMergedMergeRequests(projectId, targetBranch)`，调用 GitLab API `state=merged&target_branch=xxx&per_page=10&order_by=updated_at&sort=desc`
> - `CJGitlabView` 初始化和定时器中调用此方法获取 `pipelineMergedMRs`
> - `main.js` 中 `pipelineMergedMRs` 从 `__INITIAL_STATE__` 直接取值，不再用 computed 过滤
> - HTML 中 Pipeline Related MR 面板展示每个 MR 的：标题、源→目标分支、作者、合并时间
> - 已打包安装 `cj-gitlab-0.1.21.vsix`

🛑**26年03月30日 15:29:02 第7次提交（第6次补充）已完成**

补充：
- MR都可复制对应的信息： 标题、分支、链接、提交人等一键到剪贴板，参考Copy功能

# 26年03月30日 15:31:18，第8次提交（第7次补充）
👨‍💻**提交人：小K**
## 规划任务:
### 1. 为 Active MR 和 Pipeline Related MR 面板的每个 MR 项增加一键复制按钮

## 任务处理结果:
> ### 📄MR 一键复制功能
> 为 **Pipeline Related MR** 和 **Active Merge Requests** 面板的每个 MR 项增加了 📋 复制按钮：
> - 按钮默认隐藏，hover MR 项时显示（opacity 过渡）
> - 点击复制内容格式（多行文本）：
>   ```
>   标题: xxx
>   分支: source → target
>   链接: https://...
>   提交人: xxx
>   ```
> - 复用已有 `copyText` command 通过 VS Code clipboard API 写入剪贴板
> - **修改文件**：`index.html`（两处 MR 面板增加 `.active-mr-title-row` + 复制按钮）、`main.js`（新增 `copyMrInfo` 方法）、`styles.css`（新增 `.active-mr-title-row`、`.mr-copy-btn` 样式）
> - 已打包安装 `cj-gitlab-0.1.21.vsix`

🛑**26年03月30日 15:34:47 第8次提交（第7次补充）已完成**

补充：
- Pipeline Related MR显示前面两个即可

# 26年03月30日 15:38:11，第9次提交（第8次补充）
👨‍💻**提交人：小K**
## 规划任务:
### 1. Pipeline Related MR 面板限制只展示前 2 条

## 任务处理结果:
> ### 📄Pipeline Related MR 限制展示数量
> 在 `index.html` 中将 `v-for="mr in pipelineMergedMRs"` 改为 `v-for="mr in pipelineMergedMRs.slice(0, 2)"`，前端只展示最新的 2 条已合并 MR。
> - 已打包安装 `cj-gitlab-0.1.21.vsix`

🛑**26年03月30日 15:39:02 第9次提交（第8次补充）已完成**

# 每次运行的结果插入到本段前面，以下为每次阅读时候都要确认没有遗忘的规则要求：

1、每次文档更新需要遵循TDD开发模式及本文档`系统级要求`要求重新规划完成任务；2、规划最后一个任务必须是使用askQuestions工具Multi-select模式要求我补充需求（首选项：阅读 ${当前文档路径} 完成补充任务，如果用户选择此项表示用户在当前文档补充了新需求，需要按照要求重新读取文档内容，如果没有在尾部读取到新内容可能用户未保存，需重新调用askQuestions工具询问，Multi-select模式列出建议的后续任务），检查任务完整性不得跳过。3、允许直接操作本地的软件和git管理的代码，注意操作远程会有修改、删除数据效果并且不可撤销的操作必须先写入完整的操作方案，然后调用askQuestions工具Multi-select模式询问，确认后按照方案操作。4、当出现纠正的时候需要在修改的每个代码文件、方法前面按照规范写入注意事项注释说明，比如java代码需要遵循java doc注释规范，js代码需要遵循js doc注释规范；阅读代码时需要注意这些注释说明，理解修改的原因和目的；5、及时清理掉无用的文件，无用的日志文件，临时文件保存到tmp目录；6、注意检查保密、密钥等信息不要加入git管理，如果存在提示我需要删除；