/** git status --porcelain 输出非空即脏工作区 */
export function hasUncommitted(porcelain: string): boolean {
  return porcelain.trim().length > 0;
}

/**
 * 解析 git status --porcelain 输出为文件路径列表。
 * 格式为 `XY<space>path`（两列状态码 + 空格 + 路径）。
 * 用正则剥离状态码前缀而非固定 slice(3)——因为调用方对整段输出做过 trim()，
 * 首行前导空格会被吞掉（` M f`→`M f`），固定偏移会把首个文件名截掉一位。
 * 重命名 `R  old -> new` 取箭头后新路径；路径含空格完整保留。
 */
export function parsePorcelainFiles(porcelain: string): string[] {
  return porcelain
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => {
      // 状态码由 porcelain 字符集组成(2 列，各可为空格)，后跟 1 个空格分隔符再接路径。
      // 用字符集匹配剥离前缀，天然兼容整段被 trim() 削掉首行前导空格(2 列→1 列)的情况。
      const path = line.replace(/^[ !?ACDMRTU]{1,2} /, "");
      const arrow = path.indexOf(" -> ");
      return arrow > -1 ? path.slice(arrow + 4) : path;
    })
    .filter((p) => p.length > 0);
}
