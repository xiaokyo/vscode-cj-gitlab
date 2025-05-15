import * as vscode from "vscode";
import { GitlabService } from "./GitlabService";
import GitWatch from "./GitWatch";

export default class StatusBar {
  private _statusBarItem: vscode.StatusBarItem;
  private _gitlabService: GitlabService;
  private _gitWatch: GitWatch;

  constructor(gitlabService: GitlabService, gitWatch: GitWatch) {
    this._statusBarItem = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Right,
      100
    );
    this._gitlabService = gitlabService;
    this._gitWatch = gitWatch;  
    this.refreshBranch();
    this.listenGitBranchChange();
  }

  private listenGitBranchChange() {
    this._gitWatch.add(this.refreshBranch.bind(this));
  }

  private refreshBranch() {
    Promise.all([
      this._gitlabService.getCurrentBranch(),
      this._gitlabService.getProjectInfo(),
    ])
      .then(([branch, projectInfo]) => {
        if (projectInfo.id) {
          this._gitlabService
            .getTestBranch()
            .then((testBranch) => {
              this.setText(
                `$(git-merge)`,
                `Merge ${branch} into ${testBranch}`
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
