import * as vscode from "vscode";

export default class GitWatch {
  private afterFns: Array<() => void> = [];

  private isIgnoredPath(uri: vscode.Uri): boolean {
    return (
      uri.fsPath.includes(".git") ||
      uri.fsPath.includes("node_modules") ||
      uri.fsPath.includes("dist") ||
      uri.fsPath.includes("build")
    );
  }

  public add(fn: () => void) {
    this.afterFns.push(fn);
  }

  private runAfterFns() {
    this.afterFns.forEach((fn) => fn());
  }

  constructor() {
    const _watcher = vscode.workspace.createFileSystemWatcher("**/*");
    _watcher.onDidChange((uri) => {
      if (this.isIgnoredPath(uri)) {
        return;
      }
      this.runAfterFns();
    });
    _watcher.onDidCreate((uri) => {
      if (this.isIgnoredPath(uri)) {
        return;
      }
      this.runAfterFns();
    });
    _watcher.onDidDelete((uri) => {
      if (this.isIgnoredPath(uri)) {
        return;
      }
      this.runAfterFns();
    });
  }
}
