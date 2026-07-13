import * as assert from "assert";
import { GitlabService } from "../GitlabService";

type Call = { command: string; input?: string };

/** 装配一个被测 service：注入 mock runner + 打桩 workspace/branch */
function makeService(opts: {
  statusOutput?: string; // git status --porcelain 输出
  staged?: boolean; // add -A 后是否有已暂存内容（默认 true）
  hasUpstream?: boolean; // 当前分支是否已配置 upstream（默认 true）
  branch?: string;
}) {
  const calls: Call[] = [];
  const svc = new GitlabService() as any;
  const staged = opts.staged ?? true;
  const hasUpstream = opts.hasUpstream ?? true;

  svc.getCurrentWorkspaceRootPath = () => "/repo";

  svc.run = async (command: string, o: { cwd: string; input?: string }) => {
    calls.push({ command, input: o.input });
    if (command.includes("status --porcelain")) {
      return { stdout: opts.statusOutput ?? "", stderr: "" };
    }
    // git diff --cached --quiet：exit 0=无暂存内容(resolve)，exit 1=有(throw code=1)
    if (command.includes("diff --cached --quiet")) {
      if (staged) {
        throw Object.assign(new Error("staged"), { code: 1 });
      }
      return { stdout: "", stderr: "" };
    }
    // upstream 探测：有则 resolve，无则 throw
    if (command.includes("@{u}")) {
      if (hasUpstream) {
        return { stdout: "origin/feature/x", stderr: "" };
      }
      throw new Error("no upstream (localized text irrelevant)");
    }
    // 当前分支：set-upstream 路径现取
    if (command.includes("rev-parse --abbrev-ref HEAD")) {
      return { stdout: opts.branch ?? "feature/x", stderr: "" };
    }
    return { stdout: "", stderr: "" };
  };

  return { svc, calls };
}

suite("GitlabService.commitAndPush", () => {
  test("1. 空 message → 抛错，runner 零调用", async () => {
    const { svc, calls } = makeService({ statusOutput: " M a.ts" });
    await assert.rejects(() => svc.commitAndPush("   "), /commit message 不能为空/);
    assert.strictEqual(calls.length, 0);
  });

  test("2. 干净工作区 → 抛无待提交改动，仅 status 一次", async () => {
    const { svc, calls } = makeService({ statusOutput: "" });
    await assert.rejects(() => svc.commitAndPush("msg"), /无待提交改动/);
    assert.strictEqual(calls.length, 1);
    assert.ok(calls[0].command.includes("status --porcelain"));
  });

  test("3. 正常路径 → status/add/diff/commit/upstream/push 顺序，commit input=message", async () => {
    const { svc, calls } = makeService({ statusOutput: " M a.ts" });
    await svc.commitAndPush("hello");
    const cmds = calls.map((c) => c.command);
    assert.deepStrictEqual(cmds, [
      "git status --porcelain",
      "git add -A",
      "git diff --cached --quiet",
      "git commit -F -",
      "git rev-parse --abbrev-ref --symbolic-full-name @{u}",
      "git push",
    ]);
    const commitCall = calls.find((c) => c.command === "git commit -F -");
    assert.strictEqual(commitCall!.input, "hello");
  });

  test("4. 无 upstream（探测失败）→ 降级 set-upstream 当前分支", async () => {
    const { svc, calls } = makeService({
      statusOutput: " M a.ts",
      hasUpstream: false,
    });
    await svc.commitAndPush("msg");
    const last = calls[calls.length - 1];
    assert.strictEqual(last.command, "git push --set-upstream origin feature/x");
    // 探测本地化文案无关：mock 抛的错误不含 "no upstream" 也能降级
    assert.ok(!calls.some((c) => c.command === "git push"));
  });

  test("5. 特殊字符 message 仅经 stdin，无命令拼接注入", async () => {
    const evil = 'a" $x `whoami` \n b';
    const { svc, calls } = makeService({ statusOutput: " M a.ts" });
    await svc.commitAndPush(evil);
    for (const c of calls) {
      assert.ok(!c.command.includes(evil), `命令不应含 message: ${c.command}`);
    }
    const commitCall = calls.find((c) => c.command === "git commit -F -");
    assert.strictEqual(commitCall!.input, evil);
  });

  test("6. set-upstream 遇 detached(HEAD)/空分支 → 抛错，不发坏命令", async () => {
    for (const branch of ["HEAD", ""]) {
      const { svc, calls } = makeService({
        statusOutput: " M a.ts",
        hasUpstream: false,
        branch,
      });
      await assert.rejects(() => svc.commitAndPush("msg"), /无法确定当前分支/);
      assert.ok(!calls.some((c) => c.command.includes("--set-upstream")));
    }
  });

  test("7. porcelain 脏但 add 后无暂存内容 → 抛无待提交改动，不 commit/push", async () => {
    const { svc, calls } = makeService({
      statusOutput: " M sub", // 如 dirty submodule 指针，add -A 不产生暂存
      staged: false,
    });
    await assert.rejects(() => svc.commitAndPush("msg"), /无待提交改动/);
    assert.ok(!calls.some((c) => c.command.includes("commit")));
    assert.ok(!calls.some((c) => c.command.includes("push")));
  });

  test("8. diff --cached 真错误(exit≥2) → 向上抛，不误判为有暂存", async () => {
    const svc = new GitlabService() as any;
    svc.getCurrentWorkspaceRootPath = () => "/repo";
    const calls: Call[] = [];
    svc.run = async (command: string, o: { input?: string }) => {
      calls.push({ command, input: o.input });
      if (command.includes("status --porcelain")) {
        return { stdout: " M a.ts", stderr: "" };
      }
      if (command.includes("diff --cached --quiet")) {
        throw Object.assign(new Error("fatal: not a git repository"), { code: 128 });
      }
      return { stdout: "", stderr: "" };
    };
    await assert.rejects(() => svc.commitAndPush("msg"), /not a git repository/);
    assert.ok(!calls.some((c) => c.command.includes("commit")));
  });
});
