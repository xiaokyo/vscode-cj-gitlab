import * as vscode from "vscode";

export default class GitWatch {
  private afterFns: Array<() => void> = [];
  private watchers: vscode.FileSystemWatcher[] = [];
  private debounceTimer: NodeJS.Timeout | undefined;
  private readonly debounceDelay = 300;
  private readonly maxCallbacks = 10; // 限制最大回调数量

  public add(fn: () => void) {
    // 检查是否已存在相同函数，避免重复添加
    if (this.afterFns.includes(fn)) {
      return;
    }

    // 限制最大回调数量，防止内存泄漏
    if (this.afterFns.length >= this.maxCallbacks) {
      console.warn("GitWatch: 已达到最大回调函数数量限制");
      return;
    }

    this.afterFns.push(fn);
  }

  public remove(fn: () => void) {
    const index = this.afterFns.indexOf(fn);
    if (index > -1) {
      this.afterFns.splice(index, 1);
    }
  }

  private runAfterFns() {
    // 清除之前的定时器
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }

    // 设置新的防抖定时器
    this.debounceTimer = setTimeout(() => {
      this.afterFns.forEach((fn) => fn());
    }, this.debounceDelay);
  }

  constructor() {
    // 只监听 git 元数据：分支切换写 .git/HEAD、合并写 MERGE_HEAD、submodule 变更写 .gitmodules
    // 不再监听源码文件，避免普通保存触发 webview 重建 + 多个 API 请求
    const patterns = ["**/.git/HEAD", "**/.git/MERGE_HEAD", "**/.gitmodules"];

    const handleFileChange = () => {
      this.runAfterFns();
    };

    for (const pattern of patterns) {
      const watcher = vscode.workspace.createFileSystemWatcher(
        pattern,
        false,
        false,
        false
      );
      watcher.onDidChange(handleFileChange);
      watcher.onDidCreate(handleFileChange);
      watcher.onDidDelete(handleFileChange);
      this.watchers.push(watcher);
    }
  }

  public dispose() {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }
    for (const watcher of this.watchers) {
      watcher.dispose();
    }
    this.watchers = [];
  }
}
