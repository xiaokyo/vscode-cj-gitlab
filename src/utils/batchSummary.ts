import { PublishEnv } from "../types/BatchPublish";

export interface BatchSummaryResult {
  projectName: string;
  env: PublishEnv;
  status: string;
  message: string;
  warning?: string;
}

const ENV_LABEL: Record<string, string> = { test: "TEST", cn: "CN", com: "COM" };
const STATUS_ICON: Record<string, string> = {
  success: "✅",
  skipped: "⏭️",
  failed: "❌",
};

/** 一键批量合并结果格式化：按项目分组，每项目下列出各环境结果 */
export function formatBatchSummary(
  results: BatchSummaryResult[],
  copiedCount: number
): { title: string; detail: string; level: "info" | "warning" } {
  const success = results.filter((r) => r.status === "success");
  const skipped = results.filter((r) => r.status === "skipped");
  const failed = results.filter((r) => r.status === "failed");

  const lines: string[] = [
    `成功 ${success.length} · 跳过 ${skipped.length} · 失败 ${failed.length}`,
  ];
  if (copiedCount > 0) {
    lines.push(`已复制 ${copiedCount} 条 MR 信息到剪贴板`);
  }

  // 按项目分组，保留首次出现顺序
  const groups = new Map<string, BatchSummaryResult[]>();
  for (const r of results) {
    if (!groups.has(r.projectName)) {
      groups.set(r.projectName, []);
    }
    groups.get(r.projectName)!.push(r);
  }
  for (const [name, items] of groups) {
    lines.push("", `📦 ${name}`);
    for (const r of items) {
      const icon = STATUS_ICON[r.status] ?? "•";
      const warn = r.warning ? `（⚠️ ${r.warning}）` : "";
      lines.push(`  ${icon} ${ENV_LABEL[r.env] ?? r.env}：${r.message}${warn}`);
    }
  }

  const allFailed = success.length === 0 && failed.length > 0;
  return {
    title: allFailed ? "一键批量合并：全部失败" : "一键批量合并完成",
    detail: lines.join("\n"),
    level: allFailed ? "warning" : "info",
  };
}
