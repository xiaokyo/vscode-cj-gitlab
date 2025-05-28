import * as vscode from "vscode";

export default class GitWatch {
  private afterFns: Array<() => void> = [];
  private watcher: vscode.FileSystemWatcher | undefined;
  private debounceTimer: NodeJS.Timeout | undefined;
  private readonly debounceDelay = 300;
  private readonly maxCallbacks = 10; // 限制最大回调数量
  private readonly ignoredPathRegex =
    /\.(git|node_modules|dist|build)[\\/]|[\\/]\.(git|node_modules|dist|build)[\\/]/;

  private isIgnoredPath(uri: vscode.Uri): boolean {
    return this.ignoredPathRegex.test(uri.fsPath);
  }

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
    // 只监听特定文件类型，减少内存占用
    this.watcher = vscode.workspace.createFileSystemWatcher(
      "**/*.{ts,js,json,md,yml,yaml,tsx,jsx,css,less,html,vue}",
      false, // 不忽略创建事件
      false, // 不忽略修改事件
      false // 不忽略删除事件
    );

    const handleFileChange = (uri: vscode.Uri) => {
      if (this.isIgnoredPath(uri)) {
        return;
      }
      this.runAfterFns();
    };

    this.watcher.onDidChange(handleFileChange);
    this.watcher.onDidCreate(handleFileChange);
    this.watcher.onDidDelete(handleFileChange);
  }

  public dispose() {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }
    if (this.watcher) {
      this.watcher.dispose();
    }
  }
}
