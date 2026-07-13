import * as assert from "assert";
import { formatBatchSummary, BatchSummaryResult } from "../utils/batchSummary";

const R = (
  projectName: string,
  env: BatchSummaryResult["env"],
  status: string,
  message: string,
  warning?: string
): BatchSummaryResult => ({ projectName, env, status, message, warning });

suite("formatBatchSummary", () => {
  test("按项目分组，同项目多环境聚在一起", () => {
    const r = formatBatchSummary(
      [
        R("cj-web", "test", "success", "已合并"),
        R("cj-web", "cn", "success", "已建MR"),
        R("mycj", "test", "failed", "冲突"),
      ],
      0
    );
    const idxWebTest = r.detail.indexOf("已合并");
    const idxWebCn = r.detail.indexOf("已建MR");
    const idxMycj = r.detail.indexOf("冲突");
    // cj-web 两行相邻，早于 mycj
    assert.ok(idxWebTest < idxWebCn && idxWebCn < idxMycj);
    // 项目名各出现一次作为分组标题
    assert.strictEqual((r.detail.match(/cj-web/g) || []).length, 1);
    assert.strictEqual((r.detail.match(/mycj/g) || []).length, 1);
  });

  test("统计头部含成功/跳过/失败数", () => {
    const r = formatBatchSummary(
      [
        R("a", "test", "success", "ok"),
        R("a", "cn", "skipped", "无改动"),
        R("b", "com", "failed", "err"),
      ],
      0
    );
    assert.ok(r.detail.includes("成功 1"));
    assert.ok(r.detail.includes("跳过 1"));
    assert.ok(r.detail.includes("失败 1"));
  });

  test("每环境行带状态图标与环境标签", () => {
    const r = formatBatchSummary(
      [
        R("a", "test", "success", "ok"),
        R("a", "cn", "skipped", "skip"),
        R("a", "com", "failed", "boom"),
      ],
      0
    );
    assert.ok(r.detail.includes("✅"));
    assert.ok(r.detail.includes("⏭️"));
    assert.ok(r.detail.includes("❌"));
    assert.ok(r.detail.includes("TEST"));
    assert.ok(r.detail.includes("CN"));
    assert.ok(r.detail.includes("COM"));
  });

  test("warning 展示在对应行", () => {
    const r = formatBatchSummary(
      [R("a", "cn", "success", "已建MR", "分支未推送")],
      0
    );
    assert.ok(r.detail.includes("分支未推送"));
  });

  test("copiedCount>0 提示剪贴板", () => {
    const r = formatBatchSummary([R("a", "cn", "success", "ok")], 2);
    assert.ok(r.detail.includes("已复制 2"));
  });

  test("copiedCount=0 不提示剪贴板", () => {
    const r = formatBatchSummary([R("a", "cn", "success", "ok")], 0);
    assert.ok(!r.detail.includes("已复制"));
  });

  test("全失败 -> warning 级别与全失败标题", () => {
    const r = formatBatchSummary(
      [R("a", "test", "failed", "x"), R("b", "cn", "failed", "y")],
      0
    );
    assert.strictEqual(r.level, "warning");
    assert.ok(r.title.includes("全部失败"));
  });

  test("有成功 -> info 级别与完成标题", () => {
    const r = formatBatchSummary(
      [R("a", "test", "success", "ok"), R("b", "cn", "failed", "y")],
      0
    );
    assert.strictEqual(r.level, "info");
    assert.ok(r.title.includes("完成"));
  });

  test("空结果不抛错", () => {
    const r = formatBatchSummary([], 0);
    assert.strictEqual(r.level, "info");
  });
});
