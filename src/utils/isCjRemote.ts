/** 从 git remote url 提取 host（小写、去端口）。支持 https/ssh/scp 三种形式 */
function extractHost(url: string): string {
  const u = (url || "").trim();
  if (!u) {
    return "";
  }
  // scp 形式 git@host:path（无 scheme，冒号后非数字）
  const scp = /^[^/]+@([^/:]+):/.exec(u);
  if (scp && !/^[^/]+@[^/:]+:\d+/.test(u)) {
    return scp[1].toLowerCase();
  }
  // 带 scheme：https:// | ssh:// | git://
  const m = /^[a-z]+:\/\/(?:[^/@]+@)?([^/:]+)/i.exec(u);
  if (m) {
    return m[1].toLowerCase();
  }
  return "";
}

/**
 * 判定 remote 是否属于配置的 GitLab（同 host 即 cj 项目）。
 * baseUrl 未配置时返回 true，避免未配置时误杀全部项目。
 */
export function isCjRemote(remoteUrl: string, baseUrl: string): boolean {
  const base = extractHost(baseUrl || "");
  if (!base) {
    return true;
  }
  const host = extractHost(remoteUrl || "");
  return host !== "" && host === base;
}
