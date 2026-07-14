import * as assert from "assert";
import { safeJsonForScript } from "../utils/safeJson";

const LS = String.fromCharCode(0x2028); // U+2028 行分隔符
const PS = String.fromCharCode(0x2029); // U+2029 段分隔符

suite("safeJsonForScript", () => {
  test("普通对象与 JSON.stringify 语义等价（解析回来相等）", () => {
    const obj = { a: 1, b: "hello", c: [1, 2] };
    assert.deepStrictEqual(JSON.parse(safeJsonForScript(obj)), obj);
  });

  test("</script> 被转义，不含裸 < >", () => {
    const payload = "</script><img src=x onerror=alert(1)>";
    const out = safeJsonForScript({ title: payload });
    assert.ok(!out.includes("<"), "不应含裸 <");
    assert.ok(!out.includes(">"), "不应含裸 >");
    assert.ok(out.includes("\\u003c"), "应含 \\u003c");
    assert.strictEqual(JSON.parse(out).title, payload);
  });

  test("行分隔符 U+2028/U+2029 被转义", () => {
    const s = "a" + LS + "b" + PS + "c";
    const out = safeJsonForScript({ s });
    assert.ok(!out.includes(LS), "不应含裸 U+2028");
    assert.ok(!out.includes(PS), "不应含裸 U+2029");
    assert.strictEqual(JSON.parse(out).s, s);
  });
});
