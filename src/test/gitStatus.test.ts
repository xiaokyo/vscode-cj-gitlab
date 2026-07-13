import * as assert from "assert";
import { hasUncommitted } from "../utils/gitStatus";

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
