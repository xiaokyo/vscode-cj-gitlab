import { BatchItemResult } from "../types/BatchPublish";

/**
 * 批量合并后，挑出需复制到剪贴板的 MR 信息（含 test/cn/com 全部成功且带 mergeInfo 的项）
 * 抽为纯函数供单测；顺序与 results 一致
 */
export function selectMergeInfosForClipboard(
  results: BatchItemResult[]
): string[] {
  return results
    .filter((r) => r.status === "success" && r.mergeInfo)
    .map((r) => r.mergeInfo!);
}
