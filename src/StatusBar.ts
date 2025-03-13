import * as vscode from "vscode";
import { GitlabService } from "./GitlabService";

export default class StatusBar {
  private _statusBarItem: vscode.StatusBarItem;
  private _gitlabService: GitlabService;

  constructor(gitlabService: GitlabService) {
    this._statusBarItem = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Right,
      100
    );
    this._gitlabService = gitlabService;
    this.refreshBranch();
    this.listenGitBranchChange();
  }

  private listenGitBranchChange() {
    // 监听 git 仓库变化
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration("git")) {
        this.refreshBranch();
      }
    });

    // 监听工作区文件变化
    const watcher = vscode.workspace.createFileSystemWatcher("**/.git/HEAD");
    watcher.onDidChange(() => {
      this.refreshBranch();
    });
    watcher.onDidCreate(() => {
      this.refreshBranch();
    });
  }

  private refreshBranch() {
    Promise.all([
      this._gitlabService.getCurrentBranch(),
      this._gitlabService.getProjectInfo(),
    ])
      .then(([branch, projectInfo]) => {
        if (projectInfo.id) {
          this._gitlabService
            .findTestBranch(projectInfo.id)
            .then((testBranch) => {
              this.setText(
                `【${projectInfo.name}】${branch} merge ${testBranch}`
              );
              this.show();
            });
        } else {
          this.hide();
        }
      })
      .catch((error) => {
        console.error("Failed to refresh branch information:", error);
      });
  }

  public setText(text: string, tooltip: string | vscode.MarkdownString = "") {
    this._statusBarItem.text = `${text}`;
    this._statusBarItem.tooltip = tooltip || text;
  }

  public setCommand(command: string) {
    this._statusBarItem.command = command;
  }

  public hide() {
    this._statusBarItem.hide();
  }

  public show() {
    this._statusBarItem.show();
  }

  public getStatusBarItem(): vscode.StatusBarItem {
    return this._statusBarItem;
  }
}
