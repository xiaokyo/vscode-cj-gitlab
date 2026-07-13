/** git status --porcelain 输出非空即脏工作区 */
export function hasUncommitted(porcelain: string): boolean {
  return porcelain.trim().length > 0;
}
