import * as assert from "assert";
import {
  buildHierarchicalQuickPickItems,
  HierarchyProjectInfo,
} from "../utils/projectHierarchy";

const P = (
  name: string,
  fsPath: string,
  opts: Partial<HierarchyProjectInfo> = {}
): HierarchyProjectInfo => ({
  name,
  branch: "main",
  fsPath,
  isActive: false,
  ...opts,
});

suite("buildHierarchicalQuickPickItems", () => {
  test("单父无子 -> 只有父项、无 Separator", () => {
    const items = buildHierarchicalQuickPickItems([P("a", "/a")]);
    assert.strictEqual(items.length, 1);
    assert.strictEqual(items[0].isSeparator, undefined);
    assert.strictEqual(items[0].fsPath, "/a");
    assert.ok(!items[0].isSubmodule);
  });

  test("单父带2子 -> 父项 + Separator + 2缩进子项，顺序正确", () => {
    const items = buildHierarchicalQuickPickItems([
      P("a", "/a"),
      P("s1", "/a/s1", { isSubmodule: true, parentPath: "/a" }),
      P("s2", "/a/s2", { isSubmodule: true, parentPath: "/a" }),
    ]);
    // 父 / Separator / 子1 / 子2
    assert.strictEqual(items.length, 4);
    assert.strictEqual(items[0].fsPath, "/a");
    assert.ok(items[1].isSeparator);
    assert.strictEqual(items[2].fsPath, "/a/s1");
    assert.strictEqual(items[3].fsPath, "/a/s2");
    assert.ok(items[2].isSubmodule && items[3].isSubmodule);
  });

  test("多父各带子 -> 分组不交叉，父顺序保持", () => {
    const items = buildHierarchicalQuickPickItems([
      P("a", "/a"),
      P("as", "/a/s", { isSubmodule: true, parentPath: "/a" }),
      P("b", "/b"),
      P("bs", "/b/s", { isSubmodule: true, parentPath: "/b" }),
    ]);
    const paths = items.filter((i) => !i.isSeparator).map((i) => i.fsPath);
    // a 组全部早于 b 组
    assert.deepStrictEqual(paths, ["/a", "/a/s", "/b", "/b/s"]);
  });

  test("子项 fsPath/isSubmodule/picked 正确透传，label 带缩进前缀", () => {
    const items = buildHierarchicalQuickPickItems([
      P("a", "/a", { picked: true }),
      P("s1", "/a/s1", { isSubmodule: true, parentPath: "/a", picked: true }),
    ]);
    const child = items.find((i) => i.fsPath === "/a/s1")!;
    assert.strictEqual(child.picked, true);
    assert.strictEqual(child.isSubmodule, true);
    assert.notStrictEqual(child.label, "s1"); // 有缩进前缀
    assert.ok(child.label.includes("s1"));
  });

  test("submodule 找不到父项也不丢失（回退为独立项）", () => {
    const items = buildHierarchicalQuickPickItems([
      P("orphan", "/x/s", { isSubmodule: true, parentPath: "/missing" }),
    ]);
    const paths = items.filter((i) => !i.isSeparator).map((i) => i.fsPath);
    assert.ok(paths.includes("/x/s"));
  });

  test("空输入返回空", () => {
    assert.deepStrictEqual(buildHierarchicalQuickPickItems([]), []);
  });
});
