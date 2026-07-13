import * as assert from "assert";
import * as fs from "fs";
import * as path from "path";

function findStyles(): string {
  let dir = __dirname;
  for (let i = 0; i < 8; i++) {
    const p = path.join(dir, "resources/webview/styles.css");
    if (fs.existsSync(p)) return p;
    dir = path.dirname(dir);
  }
  throw new Error("styles.css not found");
}
const css = fs.readFileSync(findStyles(), "utf8");

// helper: 取某选择器紧随的规则体
function ruleBody(selector: string): string | null {
  const i = css.indexOf(selector);
  if (i < 0) return null;
  const open = css.indexOf("{", i);
  const close = css.indexOf("}", open);
  return css.slice(open + 1, close);
}

suite("ws-dropdown 选中项悬浮不变色", () => {
  test("hover 规则排除已选中项(:not(-active))", () => {
    // 选中项与普通项共存 base 类,裸 :hover 特异性高于 -active 会覆盖选中态
    assert.ok(
      css.includes(".ws-dropdown-item:hover:not(.ws-dropdown-item-active)"),
      "hover 规则必须用 :not(.ws-dropdown-item-active) 排除选中项"
    );
    assert.ok(
      !/\.ws-dropdown-item:hover\s*\{/.test(css),
      "不得存在无守卫的裸 .ws-dropdown-item:hover 规则"
    );
  });

  test("选中项保留自身高亮背景", () => {
    const body = ruleBody(".ws-dropdown-item-active {");
    assert.ok(body && /background/.test(body), "选中项应有独立背景");
  });
});
