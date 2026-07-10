# 一键 commit + push 设计

## 背景

`GitlabService.checkStatusNoCommit` 在发布/合并前拦截脏工作区,报错「有未提交的文件, 请先提交, 并推送到远程仓库」。用户被迫切到终端或 Git 面板手动 add/commit/push 后才能继续发布。这是发布流程中的常见堵点。

本功能提供独立的「一键提交」入口:一步完成 `add -A` → `commit` → `push`(含首次推送自动 set-upstream),消除跳出插件手动操作的成本。

## 需求(已确认)

- **入口**:独立命令 `cj-gitlab.commitAndPush` + webview 按钮,与发布流程解耦(发布拦截逻辑保持不变)。
- **message**:点击后弹 `showInputBox` 手动填写;留空/取消则中止。
- **add 范围**:`git add -A`(暂存全部改动,含新增/删除)。
- **push 目标**:当前分支 push 到 `origin` 同名分支;首次推送(无 upstream)自动 `--set-upstream origin <branch>`。
- **转义**:message 通过 `git commit -F -` 从 stdin 读入,彻底避开 shell 字符串拼接与注入。

## 架构与落点

### GitlabService.ts

1. **可注入命令 runner**(为可测性引入)
   - 现有 `execCommand` 直接调用模块级 `execAsync`,无法注入 mock。
   - 引入实例级 runner 字段,默认包装 `execAsync`,支持传 stdin。构造时可注入替身。
   - 签名:`type CmdRunner = (command: string, opts: { cwd: string; input?: string }) => Promise<{ stdout: string }>`
   - `execCommand` 改为走该 runner;新增写命令也走它。**不改变现有对外行为**。

2. **新增 `commitAndPush(message: string): Promise<void>`**
   - 前置:`message.trim()` 为空 → 抛「commit message 不能为空」。
   - 检测脏:复用 `git status --porcelain`;干净 → 抛「无待提交改动」(由 View 层转成友好 Toast,不作为错误)。
   - 执行序列:
     1. `git add -A`
     2. `git commit -F -`,message 经 stdin 传入
     3. push:先试 `git push`;若 stderr/err 含 `no upstream` / `has no upstream`,降级 `git push --set-upstream origin <currentBranch>`(复用 `checkoutBranch` 已有的 try/catch 降级模式)。
   - 任一步失败向上抛,携带原始错误信息。

### CJGitlabView.ts

- 新增 `public async commitAndPush()`:
  1. 先查 `getNoCommitFiles()`,空 → `Toast.info("无待提交改动")` 返回(不弹输入框)。
  2. `vscode.window.showInputBox({ prompt: "输入 commit message", placeHolder: "..." })`;取消/空 → 返回。
  3. `withProgress`(Notification)包裹 `gitlabService.commitAndPush(message)`。
  4. 成功 `Toast.info("提交并推送成功")`;失败 `Toast.error(err.message)`。
- `onDidReceiveMessage` 加 `case "commitAndPush": this.commitAndPush(); break;`

### extension.ts

- 注册命令 `cj-gitlab.commitAndPush` → `provider.commitAndPush()`。

### package.json

- `contributes.commands` 加 `{ "command": "cj-gitlab.commitAndPush", "title": "CJ GitLab: 一键提交并推送" }`。

### webview

- `index.html`:在合适位置加「一键提交」按钮。
- `main.js`:加方法 `commitAndPush() { this.vsPostMsg({ command: 'commitAndPush' }); }`。

## 数据流

```
按钮/命令
  → View.commitAndPush()
    → getNoCommitFiles()  (空则提前返回)
    → showInputBox → message
    → withProgress → Service.commitAndPush(message)
        → status --porcelain 校验
        → add -A
        → commit -F -  (message via stdin)
        → push  (失败降级 set-upstream)
    → Toast 成功/失败
```

## 错误处理

| 情况 | 处理 |
|------|------|
| 工作区干净 | Toast 提示「无待提交改动」,不弹框,不报错 |
| 用户取消输入框 / message 空 | 静默返回 |
| add/commit 失败 | Toast.error 原始错误 |
| push 无 upstream | 自动降级 set-upstream,对用户透明 |
| push 其他失败(冲突/权限) | Toast.error 原始错误 |

## 测试策略(TDD)

项目当前零测试,配置了 `@vscode/test-cli`(`out/test/**/*.test.js`)。`commitAndPush` 的 git 命令序列是纯逻辑,通过注入 mock runner 可脱离 VS Code API 测试。

搭建:新增 `src/test/GitlabService.commitAndPush.test.ts`,编译到 `out/test/`。因 `commitAndPush` 内部依赖 `getCurrentWorkspaceRootPath()`(读 VS Code 工作区)与 `getCurrentBranch()`,测试时对被测实例做最小打桩(覆写这两个方法返回固定值),核心断言落在注入的 runner 收到的命令序列。

测试用例(先红后绿):

1. **空 message** → 抛错,runner 未被调用任何写命令。
2. **干净工作区**(runner 对 `status --porcelain` 返回空)→ 抛「无待提交改动」,未执行 add/commit/push。
3. **正常路径**(status 返回脏)→ runner 依次收到 `add -A`、`commit -F -`(且 input === message)、`push`。
4. **无 upstream 降级** → 首个 `git push` 抛含 `no upstream` 的错误,runner 随后收到 `push --set-upstream origin <branch>`。
5. **message 含特殊字符**(`" $ ` 反引号)→ 经 stdin 传入,runner 收到的 command 不含拼接的 message,input 原样保留(验证无注入)。

不测 InputBox/Toast/withProgress 等 View 层 UI 交互(依赖 VS Code runtime,手动验证)。

## 手动验证

在真实 CJ 项目改一个文件 → 点「一键提交」→ 填 message → 观察 Git 面板改动被提交、远程分支收到 push;删除本地 upstream 再试验证 set-upstream 降级。

## 非目标(YAGNI)

- 不做选文件粒度的 add(已确认 add -A)。
- 不改发布流程的拦截逻辑。
- 不做 message 默认值/模板。
- 不做 commit 前的 lint/hook 干预。
