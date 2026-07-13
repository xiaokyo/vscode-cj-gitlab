import * as assert from "assert";
import { filterWorkspaceTabs, WorkspaceTab } from "../utils/tabFilter";

const tabs: WorkspaceTab[] = [
  { name: "cj-web-egg", branch: "master", fsPath: "/a" },
  { name: "mycj-react", branch: "feature/wallet", fsPath: "/b" },
  { name: "cj-payment-service", branch: "dev", fsPath: "/c" },
];

suite("filterWorkspaceTabs", () => {
  test("空关键字返回全部", () => {
    assert.strictEqual(filterWorkspaceTabs(tabs, "").length, 3);
    assert.strictEqual(filterWorkspaceTabs(tabs, "   ").length, 3);
  });

  test("按名称大小写不敏感匹配", () => {
    const r = filterWorkspaceTabs(tabs, "REACT");
    assert.strictEqual(r.length, 1);
    assert.strictEqual(r[0].name, "mycj-react");
  });

  test("按分支匹配", () => {
    const r = filterWorkspaceTabs(tabs, "wallet");
    assert.strictEqual(r.length, 1);
    assert.strictEqual(r[0].name, "mycj-react");
  });

  test("部分匹配命中多项", () => {
    assert.strictEqual(filterWorkspaceTabs(tabs, "cj").length, 3);
  });

  test("无匹配返回空", () => {
    assert.strictEqual(filterWorkspaceTabs(tabs, "zzz").length, 0);
  });

  test("tabs 为空/非数组不抛错", () => {
    assert.strictEqual(filterWorkspaceTabs([], "cj").length, 0);
    assert.strictEqual(filterWorkspaceTabs(undefined as any, "cj").length, 0);
  });
});
