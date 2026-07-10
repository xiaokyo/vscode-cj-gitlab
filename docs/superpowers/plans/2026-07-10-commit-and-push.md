# 一键 commit + push Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 新增独立命令 + webview 按钮,一步完成 `git add -A` → `commit`(message 经 stdin,防注入) → `push`(无 upstream 自动 set-upstream),消除发布前跳出插件手动提交的堵点。

**Architecture:** 在 `GitlabService` 引入可注入的命令 runner(默认包装 `execAsync`,支持 stdin input),新增纯逻辑方法 `commitAndPush(message)`;`CJGitlabView` 加 UI 编排层(InputBox + withProgress + Toast);`extension.ts` 注册命令,`package.json` 声明命令,webview 加按钮。git 逻辑经注入 mock runner 做单元测试。

**Tech Stack:** TypeScript, VS Code Extension API, Node `child_process.exec`, Mocha (`@vscode/test-cli`), webpack。

---

## File Structure

- `src/GitlabService.ts` — 修改:引入 runner 字段 + `execCommand` 走 runner + 新增 `commitAndPush`
- `src/CJGitlabView.ts` — 修改:新增 `commitAndPush()` 编排 + 消息分支
- `src/extension.ts` — 修改:注册命令
- `package.json` — 修改:声明命令
- `resources/webview/index.html` — 修改:加按钮
- `resources/webview/main.js` — 修改:加 `vsPostMsg` 方法
- `src/test/GitlabService.commitAndPush.test.ts` — 创建:单元测试

---

## Task 1: GitlabService 引入可注入 runner(保持现有行为)

**目的:** 让命令执行可被测试替身接管,并支持向命令 stdin 写 input(为 `commit -F -` 铺路)。此任务不改变任何对外行为,是纯重构 + 能力扩展。

**Files:**
- Modify: `src/GitlabService.ts:14`(`execAsync` 定义处)、`src/GitlabService.ts:16-28`(类字段 + 构造函数)、`src/GitlabService.ts:155-165`(`execCommand`)
- Test: `src/test/GitlabService.commitAndPush.test.ts`(创建)

- [ ] **Step 1: 写失败测试 — runner 被注入且 execCommand 走它**

创建 `src/test/GitlabService.commitAndPush.test.ts`:

```typescript
import * as assert from "assert";
import { GitlabService, CmdRunner } from "../GitlabService";

// 收集被执行的命令,便于断言序列
type Call = { command: string; input?: string };

function makeService(
  handler: (command: string, opts: { cwd: string; input?: string }) => Promise<{ stdout: string }>
) {
  const calls: Call[] = [];
  const runner: CmdRunner = async (command, opts) => {
    calls.push({ command, input: opts.input });
    return handler(command, opts);
  };
  const svc = new GitlabService(runner);
  // 隔离 VS Code 工作区依赖:固定 cwd 与当前分支
  (svc as any).getCurrentWorkspaceRootPath = () => "/tmp/repo";
  (svc as any).getCurrentWorkspaceKey = () => "/tmp/repo";
  svc.getCurrentBranch = async () => "feature/x";
  return { svc, calls };
}

suite("GitlabService runner 注入", () => {
  test("execCommand 通过注入的 runner 执行并返回 trim 后的 stdout", async () => {
    const { svc, calls } = makeService(async () => ({ stdout: "  hi \n" }));
    const out = await (svc as any).execCommand("git status");
    assert.strictEqual(out, "hi");
    assert.strictEqual(calls.length, 1);
    assert.strictEqual(calls[0].command, "git status");
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `yarn compile-tests && npx mocha out/test/GitlabService.commitAndPush.test.js`
Expected: FAIL — `CmdRunner` 未导出 / `GitlabService` 构造不接受 runner 参数(编译或运行报错)。

> 注:项目原 `.vscode-test.mjs` 走 VS Code Electron runner。本 suite 是纯逻辑,不依赖 vscode 运行时的行为,用 `mocha` 直接跑编译产物即可。`import * as vscode` 在 `GitlabService` 顶部存在,但被测路径不触达 vscode API(已打桩),Node 下 require `vscode` 会失败——故 Step 3 需保证测试不触发对 vscode 的真实调用。若 `require("vscode")` 在 import 阶段即抛错,则改用下方 Task 1b 的 stub 方案。

- [ ] **Step 3: 实现 — 定义 CmdRunner 类型并注入**

在 `src/GitlabService.ts` 顶部 `const execAsync = promisify(exec);`(第14行)之后新增类型与默认 runner:

```typescript
export type CmdRunner = (
  command: string,
  opts: { cwd: string; input?: string }
) => Promise<{ stdout: string }>;

// 默认 runner:包装 execAsync,支持向 stdin 写 input(用于 git commit -F -)
const defaultRunner: CmdRunner = (command, opts) =>
  new Promise((resolve, reject) => {
    const child = exec(command, { cwd: opts.cwd }, (error, stdout) => {
      if (error) {
        reject(error);
        return;
      }
      resolve({ stdout: String(stdout) });
    });
    if (opts.input !== undefined) {
      child.stdin?.write(opts.input);
      child.stdin?.end();
    }
  });
```

修改类字段与构造函数(第16-28行区域),新增 `private readonly runner: CmdRunner;`,构造函数签名加可选参数:

```typescript
  constructor(runner: CmdRunner = defaultRunner) {
    this.runner = runner;
    const config = vscode.workspace.getConfiguration("cj-gitlab");
    this.baseUrl = config.get("apiUrl") || "";
    this.token = config.get("token") || "";
  }
```

修改 `execCommand`(第155-165行)走 runner:

```typescript
  private async execCommand(command: string): Promise<string> {
    try {
      const { stdout } = await this.runner(command, {
        cwd: this.getCurrentWorkspaceRootPath(),
      });
      return stdout.trim();
    } catch (error) {
      console.error(`Failed to execute command: ${command}`, error);
      throw error;
    }
  }
```

- [ ] **Step 4: 运行测试确认通过**

Run: `yarn compile-tests && npx mocha out/test/GitlabService.commitAndPush.test.js`
Expected: PASS (1 passing)。若因 `require("vscode")` 在 import 阶段抛错导致无法加载,执行 Task 1b 后再回来重跑。

- [ ] **Step 5: 提交**

```bash
rtk git add src/GitlabService.ts src/test/GitlabService.commitAndPush.test.ts
rtk git commit -m "refactor: GitlabService 引入可注入命令 runner"
```

---

## Task 1b(条件性): 隔离测试对 vscode 模块的依赖

**仅当 Task 1 Step 4 因 `Cannot find module 'vscode'` 在 import 阶段失败时执行。** `GitlabService.ts` 顶部 `import * as vscode` 会让 Node 直接 require `vscode`,而该模块只在 Electron 宿主中存在。

**Files:**
- Create: `src/test/vscode-stub.js`
- Modify: `src/test/GitlabService.commitAndPush.test.ts`(顶部加 stub 装载)

- [ ] **Step 1: 创建最小 vscode stub**

创建 `src/test/vscode-stub.js`(JS 而非 TS,避免类型噪音):

```javascript
// 最小 vscode 桩:仅满足 GitlabService import 阶段与构造函数所需
module.exports = {
  workspace: {
    getConfiguration: () => ({ get: () => "" }),
  },
  window: {},
  Uri: { file: (p) => ({ fsPath: p }) },
};
```

- [ ] **Step 2: 在测试文件顶部注册 stub(先于 import GitlabService)**

修改 `src/test/GitlabService.commitAndPush.test.ts`,把首行改为:

```typescript
import * as assert from "assert";
import * as path from "path";
import Module = require("module");
// 拦截 require("vscode") 返回本地桩
const originalResolve = (Module as any)._resolveFilename;
(Module as any)._resolveFilename = function (request: string, ...rest: any[]) {
  if (request === "vscode") {
    return path.join(__dirname, "vscode-stub.js");
  }
  return originalResolve.call(this, request, ...rest);
};
import { GitlabService, CmdRunner } from "../GitlabService";
```

其余测试内容不变。

- [ ] **Step 3: 运行确认通过**

Run: `yarn compile-tests && npx mocha out/test/GitlabService.commitAndPush.test.js`
Expected: PASS。

- [ ] **Step 4: 提交**

```bash
rtk git add src/test/vscode-stub.js src/test/GitlabService.commitAndPush.test.ts
rtk git commit -m "test: 隔离 GitlabService 测试对 vscode 模块的依赖"
```

---

## Task 2: commitAndPush — 空 message 与干净工作区守卫

**Files:**
- Modify: `src/GitlabService.ts`(在 `getNoCommitFiles` 之后,约第784行后新增方法)
- Test: `src/test/GitlabService.commitAndPush.test.ts`

- [ ] **Step 1: 写失败测试 — 空 message 抛错且不执行写命令**

在测试文件的 `suite(...)` 内追加新 suite:

```typescript
suite("commitAndPush 守卫", () => {
  test("空 message 抛错,不执行任何 git 命令", async () => {
    const { svc, calls } = makeService(async () => ({ stdout: "" }));
    await assert.rejects(
      () => svc.commitAndPush("   "),
      /commit message 不能为空/
    );
    assert.strictEqual(calls.length, 0);
  });

  test("工作区干净时抛「无待提交改动」,不执行 add/commit/push", async () => {
    const { svc, calls } = makeService(async (command) => {
      if (command.includes("status --porcelain")) {
        return { stdout: "" };
      }
      return { stdout: "" };
    });
    await assert.rejects(
      () => svc.commitAndPush("feat: x"),
      /无待提交改动/
    );
    const writeCmds = calls.filter(
      (c) => /git (add|commit|push)/.test(c.command)
    );
    assert.strictEqual(writeCmds.length, 0);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `yarn compile-tests && npx mocha out/test/GitlabService.commitAndPush.test.js`
Expected: FAIL — `svc.commitAndPush is not a function`。

- [ ] **Step 3: 实现 — commitAndPush 守卫部分**

在 `src/GitlabService.ts` 的 `getNoCommitFiles()` 方法之后新增:

```typescript
  /**
   * 一键提交并推送:add -A → commit(message 经 stdin) → push(无 upstream 自动 set-upstream)
   * message 为空或工作区干净时抛错,由 View 层转成友好提示
   */
  async commitAndPush(message: string): Promise<void> {
    if (!message.trim()) {
      throw new Error("commit message 不能为空");
    }

    const status = await this.execCommand("git status --porcelain");
    if (!status) {
      throw new Error("无待提交改动");
    }
    // add / commit / push 在后续任务实现
  }
```

- [ ] **Step 4: 运行测试确认通过**

Run: `yarn compile-tests && npx mocha out/test/GitlabService.commitAndPush.test.js`
Expected: PASS (2 新增 + 前序全绿)。

- [ ] **Step 5: 提交**

```bash
rtk git add src/GitlabService.ts src/test/GitlabService.commitAndPush.test.ts
rtk git commit -m "feat: commitAndPush 空message与干净工作区守卫"
```

---

## Task 3: commitAndPush — add/commit(stdin)/push 正常路径

**Files:**
- Modify: `src/GitlabService.ts`(`commitAndPush` 方法体)
- Test: `src/test/GitlabService.commitAndPush.test.ts`

- [ ] **Step 1: 写失败测试 — 命令序列与 stdin 传入**

在 `suite("commitAndPush 守卫", ...)` 后追加:

```typescript
suite("commitAndPush 正常路径", () => {
  test("脏工作区依次执行 add -A、commit -F -(message 经 stdin)、push", async () => {
    const { svc, calls } = makeService(async (command) => {
      if (command.includes("status --porcelain")) {
        return { stdout: " M src/a.ts" };
      }
      return { stdout: "" };
    });

    await svc.commitAndPush("feat: 新功能");

    const seq = calls.map((c) => c.command);
    const addIdx = seq.findIndex((c) => /git add -A/.test(c));
    const commitIdx = seq.findIndex((c) => /git commit -F -/.test(c));
    const pushIdx = seq.findIndex((c) => /git push/.test(c));

    assert.ok(addIdx >= 0, "应执行 git add -A");
    assert.ok(commitIdx > addIdx, "commit 应在 add 之后");
    assert.ok(pushIdx > commitIdx, "push 应在 commit 之后");

    // message 经 stdin 传入,不出现在命令字符串里
    const commitCall = calls[commitIdx];
    assert.strictEqual(commitCall.input, "feat: 新功能");
    assert.ok(!commitCall.command.includes("feat"), "message 不应拼进命令");
  });

  test("message 含 shell 特殊字符时经 stdin 原样传入,命令无注入", async () => {
    const { svc, calls } = makeService(async (command) => {
      if (command.includes("status --porcelain")) {
        return { stdout: " M x" };
      }
      return { stdout: "" };
    });
    const nasty = 'fix: "$(rm -rf /)" `whoami`';
    await svc.commitAndPush(nasty);
    const commitCall = calls.find((c) => /git commit -F -/.test(c.command))!;
    assert.strictEqual(commitCall.input, nasty);
    assert.ok(!commitCall.command.includes("rm -rf"));
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `yarn compile-tests && npx mocha out/test/GitlabService.commitAndPush.test.js`
Expected: FAIL — 未执行 add/commit/push,断言 `addIdx >= 0` 失败。

- [ ] **Step 3: 实现 — 补全 add/commit/push**

将 `commitAndPush` 中的注释行 `// add / commit / push 在后续任务实现` 替换为:

```typescript
    await this.runner("git add -A", {
      cwd: this.getCurrentWorkspaceRootPath(),
    });
    await this.runner("git commit -F -", {
      cwd: this.getCurrentWorkspaceRootPath(),
      input: message,
    });
    await this.pushCurrentBranch();
```

并在 `commitAndPush` 之后新增私有方法(push 逻辑,Task 4 会扩展降级):

```typescript
  /**
   * push 当前分支到 origin,首次推送无 upstream 时自动 set-upstream
   */
  private async pushCurrentBranch(): Promise<void> {
    const cwd = this.getCurrentWorkspaceRootPath();
    await this.runner("git push", { cwd });
  }
```

- [ ] **Step 4: 运行测试确认通过**

Run: `yarn compile-tests && npx mocha out/test/GitlabService.commitAndPush.test.js`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
rtk git add src/GitlabService.ts src/test/GitlabService.commitAndPush.test.ts
rtk git commit -m "feat: commitAndPush 执行 add/commit(stdin)/push"
```

---

## Task 4: push 无 upstream 自动降级 set-upstream

**Files:**
- Modify: `src/GitlabService.ts`(`pushCurrentBranch`)
- Test: `src/test/GitlabService.commitAndPush.test.ts`

- [ ] **Step 1: 写失败测试 — 首次 push 报 no upstream 时降级**

在 `suite("commitAndPush 正常路径", ...)` 后追加:

```typescript
suite("commitAndPush push 降级", () => {
  test("git push 报 no upstream 时降级为 --set-upstream origin <branch>", async () => {
    const { svc, calls } = makeService(async (command) => {
      if (command.includes("status --porcelain")) {
        return { stdout: " M x" };
      }
      if (command === "git push") {
        throw new Error(
          "fatal: The current branch feature/x has no upstream branch."
        );
      }
      return { stdout: "" };
    });

    await svc.commitAndPush("feat: y");

    const setUpstream = calls.find((c) =>
      /git push --set-upstream origin feature\/x/.test(c.command)
    );
    assert.ok(setUpstream, "应降级执行 set-upstream");
  });

  test("git push 因其他原因失败时抛出,不降级", async () => {
    const { svc } = makeService(async (command) => {
      if (command.includes("status --porcelain")) {
        return { stdout: " M x" };
      }
      if (command === "git push") {
        throw new Error("fatal: unable to access: 403 Forbidden");
      }
      return { stdout: "" };
    });
    await assert.rejects(
      () => svc.commitAndPush("feat: z"),
      /403 Forbidden/
    );
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `yarn compile-tests && npx mocha out/test/GitlabService.commitAndPush.test.js`
Expected: FAIL — 首个测试因 `git push` 抛错未被捕获而 reject;set-upstream 未执行。

- [ ] **Step 3: 实现 — pushCurrentBranch 加降级**

替换 `pushCurrentBranch` 为:

```typescript
  /**
   * push 当前分支到 origin,首次推送无 upstream 时自动 set-upstream
   */
  private async pushCurrentBranch(): Promise<void> {
    const cwd = this.getCurrentWorkspaceRootPath();
    try {
      await this.runner("git push", { cwd });
    } catch (err: any) {
      const msg = String(err?.message || err);
      if (/no upstream|has no upstream/i.test(msg)) {
        const branch = await this.getCurrentBranch();
        await this.runner(
          `git push --set-upstream origin ${branch}`,
          { cwd }
        );
        return;
      }
      throw err;
    }
  }
```

- [ ] **Step 4: 运行测试确认通过**

Run: `yarn compile-tests && npx mocha out/test/GitlabService.commitAndPush.test.js`
Expected: PASS(全部 suite 通过)。

- [ ] **Step 5: 提交**

```bash
rtk git add src/GitlabService.ts src/test/GitlabService.commitAndPush.test.ts
rtk git commit -m "feat: push 无 upstream 时自动 set-upstream"
```

---

## Task 5: CJGitlabView 编排层(InputBox + progress + Toast)

**目的:** View 层负责 UI:干净工作区提前提示、弹 InputBox、进度包裹、成功/失败 Toast。此层依赖 VS Code runtime,不写单测,靠 Task 7 手动验证。

**Files:**
- Modify: `src/CJGitlabView.ts`(在 `switchBranch` 方法之后新增 `commitAndPush`;`onDidReceiveMessage` 的 switch 内加 case,约第364行 `switchBranch` case 附近)

- [ ] **Step 1: 新增 commitAndPush 编排方法**

在 `src/CJGitlabView.ts` 的 `public async switchBranch()` 方法结束(第317行 `}` )之后新增:

```typescript
  /**
   * 一键提交并推送:干净工作区直接提示;否则弹 InputBox 填 message,
   * add -A → commit → push 全程进度提示
   */
  public async commitAndPush() {
    try {
      const files = await this._gitlabService.getNoCommitFiles();
      if (files.length === 0) {
        Toast.info("无待提交改动");
        return;
      }

      const message = await vscode.window.showInputBox({
        title: "一键提交并推送",
        prompt: `暂存 ${files.length} 个改动,输入 commit message`,
        placeHolder: "例如:feat: 新增xxx功能",
      });
      if (!message || !message.trim()) {
        return;
      }

      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: "一键提交并推送",
          cancellable: false,
        },
        async (progress) => {
          progress.report({ message: "提交并推送中..." });
          await this._gitlabService.commitAndPush(message);
        }
      );

      Toast.info("提交并推送成功");
      await this.refresh();
    } catch (error: any) {
      Toast.error(error.message || "提交并推送失败");
    }
  }
```

- [ ] **Step 2: 消息分支接入**

在 `onDidReceiveMessage` 的 switch 中,`case "switchBranch":`(第364行)之后新增:

```typescript
        case "commitAndPush":
          this.commitAndPush();
          break;
```

- [ ] **Step 3: 编译确认无类型错误**

Run: `rtk tsc --noEmit -p .`
Expected: 无错误输出(退出码 0)。

- [ ] **Step 4: 提交**

```bash
rtk git add src/CJGitlabView.ts
rtk git commit -m "feat: CJGitlabView 一键提交编排(InputBox+进度+Toast)"
```

---

## Task 6: 注册命令 + package.json 声明 + webview 按钮

**Files:**
- Modify: `src/extension.ts:45-49`(命令注册区)
- Modify: `package.json`(`contributes.commands` 数组)
- Modify: `resources/webview/index.html:139-141`(header 图标按钮区)
- Modify: `resources/webview/main.js`(methods)

- [ ] **Step 1: extension.ts 注册命令**

在 `src/extension.ts` 的 `batchMerge` 命令注册块(第45-49行)之后新增:

```typescript
  context.subscriptions.push(
    vscode.commands.registerCommand("cj-gitlab.commitAndPush", () => {
      provider.commitAndPush();
    })
  );
```

- [ ] **Step 2: package.json 声明命令**

在 `contributes.commands` 数组末尾(`batchMerge` 命令对象之后)新增:

```json
      ,{
        "command": "cj-gitlab.commitAndPush",
        "title": "CJ GitLab: 一键提交并推送"
      }
```

(注:确保 JSON 逗号正确——`batchMerge` 对象后加逗号再接新对象;上面写法在数组内 `batchMerge` 项后追加。)

- [ ] **Step 3: webview 加按钮**

在 `resources/webview/index.html` 的一键批量合并按钮(第139-141行)之后新增一个 header 图标按钮,复用 `i-git-pr` 图标:

```html
      <!-- 一键提交并推送:图标按钮 -->
      <button class="header-icon-btn" @click="commitAndPush" title="一键提交并推送(add -A + commit + push)">
        <svg class="icon" aria-hidden="true"><use href="#i-git-pr"/></svg>
      </button>
```

- [ ] **Step 4: main.js 加方法**

在 `resources/webview/main.js` 的 methods 中,`copyBranch()` 方法(第68-73行)之后新增:

```javascript
    /** 一键提交并推送 */
    commitAndPush() {
      this.vsPostMsg({ command: 'commitAndPush' });
    },
```

- [ ] **Step 5: 编译确认通过**

Run: `rtk tsc --noEmit -p . && node -e "JSON.parse(require('fs').readFileSync('package.json','utf8')); console.log('package.json OK')"`
Expected: 无 TS 错误 + 打印 `package.json OK`。

- [ ] **Step 6: 提交**

```bash
rtk git add src/extension.ts package.json resources/webview/index.html resources/webview/main.js
rtk git commit -m "feat: 注册一键提交命令并接入 webview 按钮"
```

---

## Task 7: 端到端手动验证 + 打包

**Files:** 无(验证任务)

- [ ] **Step 1: 编译打包**

Run: `rtk npm run compile`
Expected: webpack 构建成功,`dist/extension.js` 更新。

- [ ] **Step 2: 全量单测回归**

Run: `yarn compile-tests && npx mocha out/test/GitlabService.commitAndPush.test.js`
Expected: 全部 PASS。

- [ ] **Step 3: 真实环境手动验证(F5 启动扩展开发宿主)**

在一个真实 CJ 项目里:
1. 改动一个文件不提交。
2. 点 webview header 的「一键提交并推送」按钮(或命令面板执行 `CJ GitLab: 一键提交并推送`)。
3. 填 message 回车 → 观察进度提示 → 成功 Toast。
4. 确认 Git 面板改动被提交、远程分支收到 push。
5. 干净工作区再点一次 → 应提示「无待提交改动」,不弹框。
6. (可选)删除本地分支 upstream 后新建分支改动提交 → 验证 set-upstream 降级成功推送。

- [ ] **Step 4: 版本号 + 最终提交**

将 `package.json` 的 `version` 由 `0.1.32` 升到 `0.1.33`:

```bash
rtk git add package.json dist
rtk git commit -m "chore: 一键提交并推送功能,版本号升至 0.1.33"
```

---

## 备注

- 后端项目禁止自动 commit/push,本仓库为前端扩展项目、当前分支非 master/release/dev 时可按全局规则自动 push;若当前在 master 分支,提交前需先切分支或征询。
- Task 1b 为条件性任务:仅当纯 mocha 无法加载 `GitlabService`(vscode 模块缺失)时执行。先跑 Task 1 Step 4 判定。
