/** 项目/子模块扁平信息（来自 getAllWorkspaceProjectInfos） */
export interface HierarchyProjectInfo {
  name: string;
  branch: string;
  fsPath: string;
  isActive: boolean;
  isSubmodule?: boolean;
  parentPath?: string;
  picked?: boolean;
}

/** QuickPick 层级项：Separator 无 fsPath，普通项带 fsPath 可映射回项目 */
export interface HierarchyQuickPickItem {
  label: string;
  description?: string;
  picked?: boolean;
  fsPath?: string;
  isSubmodule?: boolean;
  isSeparator?: boolean;
}

const CHILD_PREFIX = "$(arrow-small-right) ";

function describe(p: HierarchyProjectInfo): string {
  const active = p.isActive ? "当前 · " : "";
  return `${active}分支: ${p.branch}`;
}

/**
 * 扁平项目列表 -> 有序 QuickPick 层级项。
 * 父项目按原顺序；其 submodule 紧跟父项，用 Separator(父名) 分组 + 子项缩进前缀。
 * 无 submodule 的父项目不加 Separator；找不到父项的 submodule 回退为独立顶层项。
 */
export function buildHierarchicalQuickPickItems(
  infos: HierarchyProjectInfo[]
): HierarchyQuickPickItem[] {
  const parents = infos.filter((p) => !p.isSubmodule);
  const parentPaths = new Set(parents.map((p) => p.fsPath));

  // 按 parentPath 归拢 submodule，保留原顺序
  const childrenOf = new Map<string, HierarchyProjectInfo[]>();
  const orphans: HierarchyProjectInfo[] = [];
  for (const p of infos) {
    if (!p.isSubmodule) {
      continue;
    }
    if (p.parentPath && parentPaths.has(p.parentPath)) {
      if (!childrenOf.has(p.parentPath)) {
        childrenOf.set(p.parentPath, []);
      }
      childrenOf.get(p.parentPath)!.push(p);
    } else {
      orphans.push(p);
    }
  }

  const items: HierarchyQuickPickItem[] = [];
  const pushParent = (p: HierarchyProjectInfo) => {
    items.push({
      label: p.name,
      description: describe(p),
      picked: p.picked,
      fsPath: p.fsPath,
    });
  };
  const pushChild = (p: HierarchyProjectInfo) => {
    items.push({
      label: `${CHILD_PREFIX}${p.name}`,
      description: `${describe(p)} · submodule`,
      picked: p.picked,
      fsPath: p.fsPath,
      isSubmodule: true,
    });
  };

  for (const parent of parents) {
    pushParent(parent);
    const kids = childrenOf.get(parent.fsPath);
    if (kids && kids.length > 0) {
      items.push({ label: `${parent.name} 的子模块`, isSeparator: true });
      kids.forEach(pushChild);
    }
  }

  // 找不到父项的 submodule 作为独立顶层项，避免丢失
  orphans.forEach((p) =>
    items.push({
      label: `${CHILD_PREFIX}${p.name}`,
      description: `${describe(p)} · submodule`,
      picked: p.picked,
      fsPath: p.fsPath,
      isSubmodule: true,
    })
  );

  return items;
}
