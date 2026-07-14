import * as assert from "assert";
import { hasUncommitted, parsePorcelainFiles } from "../utils/gitStatus";

suite("hasUncommitted", () => {
  test("空输出=干净", () => {
    assert.strictEqual(hasUncommitted(""), false);
    assert.strictEqual(hasUncommitted("   \n  "), false);
  });

  test("有改动=脏", () => {
    assert.strictEqual(hasUncommitted(" M src/a.ts"), true);
    assert.strictEqual(hasUncommitted("?? new.ts\n M b.ts"), true);
  });
});

suite("parsePorcelainFiles", () => {
  test("空输出=空列表", () => {
    assert.deepStrictEqual(parsePorcelainFiles(""), []);
    assert.deepStrictEqual(parsePorcelainFiles("  \n "), []);
  });

  test("常规状态码取完整路径", () => {
    assert.deepStrictEqual(parsePorcelainFiles(" M src/a.ts"), ["src/a.ts"]);
    assert.deepStrictEqual(parsePorcelainFiles("?? new.ts"), ["new.ts"]);
  });

  test("暂存 add (双空格) 不丢文件", () => {
    assert.deepStrictEqual(parsePorcelainFiles("A  foo.ts"), ["foo.ts"]);
  });

  test("重命名取箭头后新路径", () => {
    assert.deepStrictEqual(parsePorcelainFiles("R  old.ts -> new.ts"), [
      "new.ts",
    ]);
  });

  test("路径含空格完整保留", () => {
    assert.deepStrictEqual(parsePorcelainFiles(" M my file.ts"), [
      "my file.ts",
    ]);
  });

  test("多行混合", () => {
    const out = "A  a.ts\n M b c.ts\nR  x.ts -> y.ts\n?? z.ts";
    assert.deepStrictEqual(parsePorcelainFiles(out), [
      "a.ts",
      "b c.ts",
      "y.ts",
      "z.ts",
    ]);
  });

  test("整段被 trim 后首行前导空格丢失也不截断文件名", () => {
    // execCommand 返回 stdout.trim()：首行 ' M tracked.ts' 被削成 'M tracked.ts'
    const trimmed = "M tracked.ts\n M second.ts";
    assert.deepStrictEqual(parsePorcelainFiles(trimmed), [
      "tracked.ts",
      "second.ts",
    ]);
  });

  test("首行为单列状态(D/??)去 trim 后仍完整", () => {
    assert.deepStrictEqual(parsePorcelainFiles("D deleted.ts"), ["deleted.ts"]);
    assert.deepStrictEqual(parsePorcelainFiles("?? new.ts\n M b.ts"), [
      "new.ts",
      "b.ts",
    ]);
  });
});
