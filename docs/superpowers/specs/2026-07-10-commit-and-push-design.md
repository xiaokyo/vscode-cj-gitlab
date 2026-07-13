# 一键 commit + push 设计

## 背景

发布/合并流程遇到脏工作区,过去由 `GitlabService.checkStatusNoCommit` 硬拦截报错,现已改为非阻塞 `Toast.warning`(见 commit 9ae28cd:发布照常,仅提示未提交改动不会被包含)。用户仍需自行 add/commit/push 才能让改动进入本次合并,这是发布流程中的常见堵点。

本功能提供独立的「一键提交」入口:一步完成 `add -A` → `commit` → `push`(含首次推送自动 set-upstream),消除跳出插件手动操作的成本。与发布流程解耦,互不调用。

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
   - 引入实例级 runner 字段(字段初始化赋默认实现,不改 arg-less 构造函数,避免动到 `extension.ts` 的 `new GitlabService()`)。测试通过 `service["run"] = mockRunner` 覆写该字段注入替身,无需构造参数。
   - 签名:`type CmdRunner = (command: string, opts: { cwd: string; input?: string }) => Promise<{ stdout: string; stderr: string }>`
   - **默认 runner 不能是 `promisify(exec)`**:`promisify(exec)` 返回 `{stdout,stderr}`,拿不到子进程句柄,无法写 stdin,无法满足 `input` 契约(`git commit -F -` 需从 stdin 读 message)。默认 runner 改为手动包装 `child_process.exec`:持有回调返回的 `ChildProcess`,当 `input !== undefined` 时 `child.stdin.end(input)`;回调里 `err` 时把 `stderr` 挂到 err 再 reject。已验证特殊字符(`" $ ` 反引号、换行)经 stdin 原样送达,无 shell 插值。
   - `execCommand` 改为走该 runner(仍只传 `command`+`cwd`,不传 `input`);新增写命令也走它。**不改变现有对外行为**(返回值取 `.stdout` 并 `trim`,与原 `execAsync().stdout.trim()` 一致)。

2. **新增 `commitAndPush(message: string): Promise<void>`**
   - 前置:`message.trim()` 为空 → 抛「commit message 不能为空」。
   - 检测脏:复用 `git status --porcelain`;干净 → 抛「无待提交改动」(由 View 层转成友好 Toast,不作为错误)。
   - 执行序列:
     1. `git add -A`
     2. `git diff --cached --quiet`:exit 0 表示无暂存差异(porcelain 脏但 add 无果,如 dirty submodule 指针)→ 抛「无待提交改动」,不 commit/push;exit 1(有暂存)才继续。
     3. `git commit -F -`,message 经 stdin 传入
     4. push:**先探测 upstream 而非抓错误文案**(git 输出会本地化,中文 git 下无 `no upstream` 子串,原方案会漏降级)。`git rev-parse --abbrev-ref --symbolic-full-name @{u}` exit 0=有 upstream → `git push`;失败=无 upstream → `await getCurrentBranch()` 取分支,若为 `"未知分支"`/`"HEAD"`(detached)则抛「无法确定当前分支」,否则 `git push --set-upstream origin <branch>`。
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

搭建:新增 `src/test/GitlabService.commitAndPush.test.ts`,编译到 `out/test/`。注入替身通过覆写实例字段 `service["run"] = mockRunner`(mock 记录每次 `{command, input}`,按预设返回 `{stdout, stderr}` 或抛错)。`commitAndPush` 还依赖 `getCurrentWorkspaceRootPath()`(读 VS Code 工作区,无 folder 时会抛)与 `getCurrentBranch()`,测试时一并覆写为返回固定值(如 `"/repo"`、`"feature/x"`)。核心断言落在 mockRunner 收到的命令序列。

测试用例(先红后绿):

1. **空 message**(`"  "`)→ 抛「commit message 不能为空」,mockRunner 零调用。
2. **干净工作区**(mock 对 `status --porcelain` 返回空 stdout)→ 抛「无待提交改动」,未执行 add/commit/push(mock 仅收到 status 一次)。
3. **正常路径**(status 返回脏)→ mock 依次收到 `git add -A`、`git commit -F -`(且该次 `input === message`)、`git push`,共 4 次调用(status+add+commit+push)。
4. **无 upstream 降级** → 首个 `git push` 抛含 `no upstream` 的 err(err.stderr 携带)→ mock 随后收到 `git push --set-upstream origin feature/x`。
5. **message 含特殊字符**(`a" $x `whoami` \n b`)→ 该 message 仅经 commit 那次调用的 `input` 传入;断言所有调用的 `command` 字段都不含该 message 子串(无拼接/无注入),且 commit 调用的 `input` 与原 message 全等。
6. **set-upstream 遇未知分支** → getCurrentBranch 覆写返回 `"未知分支"`,触发 no-upstream 降级路径 → 抛「无法确定当前分支」,mock 未收到任何 `--set-upstream` 命令。

不测 InputBox/Toast/withProgress 等 View 层 UI 交互(依赖 VS Code runtime,手动验证)。

## 手动验证

在真实 CJ 项目改一个文件 → 点「一键提交」→ 填 message → 观察 Git 面板改动被提交、远程分支收到 push;删除本地 upstream 再试验证 set-upstream 降级。

## 非目标(YAGNI)

- 不做选文件粒度的 add(已确认 add -A)。
- 不改发布流程(其脏工作区提示已在 commit 9ae28cd 独立完成,本功能与之解耦)。
- 不做 message 默认值/模板。
- 不做 commit 前的 lint/hook 干预。
