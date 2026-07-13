export interface WorkspaceTab {
  name: string;
  branch: string;
  fsPath: string;
  isActive?: boolean;
  isSubmodule?: boolean;
}

/** 按名称/分支大小写不敏感包含过滤；空关键字返回全部 */
export function filterWorkspaceTabs<T extends { name?: string; branch?: string }>(
  tabs: T[],
  keyword: string
): T[] {
  if (!Array.isArray(tabs)) {
    return [];
  }
  const kw = (keyword || "").trim().toLowerCase();
  if (!kw) {
    return tabs;
  }
  return tabs.filter(
    (t) =>
      (t.name || "").toLowerCase().includes(kw) ||
      (t.branch || "").toLowerCase().includes(kw)
  );
}
