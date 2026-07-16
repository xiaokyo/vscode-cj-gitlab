import * as assert from "assert";
import { selectMergeInfosForClipboard } from "../utils/clipboardMergeInfos";
import { BatchItemResult } from "../types/BatchPublish";

const R = (
  env: BatchItemResult["env"],
  status: BatchItemResult["status"],
  mergeInfo?: string
): BatchItemResult => ({
  projectName: "p",
  fsPath: "/p",
  env,
  status,
  message: "m",
  mergeInfo,
});

suite("selectMergeInfosForClipboard", () => {
  test("test/cn/com 三环境成功且有 mergeInfo 都复制", () => {
    const out = selectMergeInfosForClipboard([
      R("test", "success", "MR-test"),
      R("cn", "success", "MR-cn"),
      R("com", "success", "MR-com"),
    ]);
    assert.deepStrictEqual(out, ["MR-test", "MR-cn", "MR-com"]);
  });

  test("失败/跳过项不复制", () => {
    const out = selectMergeInfosForClipboard([
      R("test", "success", "MR-test"),
      R("cn", "failed"),
      R("com", "skipped", "MR-com"),
    ]);
    assert.deepStrictEqual(out, ["MR-test"]);
  });

  test("成功但无 mergeInfo 不复制", () => {
    const out = selectMergeInfosForClipboard([R("test", "success", undefined)]);
    assert.deepStrictEqual(out, []);
  });

  test("顺序按 results 稳定", () => {
    const out = selectMergeInfosForClipboard([
      R("com", "success", "1"),
      R("test", "success", "2"),
      R("cn", "success", "3"),
    ]);
    assert.deepStrictEqual(out, ["1", "2", "3"]);
  });

  test("空数组返回空", () => {
    assert.deepStrictEqual(selectMergeInfosForClipboard([]), []);
  });
});
