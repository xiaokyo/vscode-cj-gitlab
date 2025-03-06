import * as vscode from "vscode";
import { GitlabService } from "./GitlabService";

export default class StatusBar {
  private _statusBarItem: vscode.StatusBarItem;
  private _gitlabService: GitlabService;

  constructor() {
    this._statusBarItem = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Right,
      100
    );
    this._statusBarItem.show();
    this._gitlabService = new GitlabService();

    this.refreshBranch();
  }

  private refreshBranch() {
    Promise.all([
      this._gitlabService.getCurrentBranch(),
      this._gitlabService.getCurrentProjectName(),
    ])
      .then(([branch, projectName]) => {
        this.setText(`$(git-branch)${projectName}`, "点击发布到测试环境");
      })
      .catch((error) => {
        console.error("Failed to refresh branch information:", error);
      });
  }

  public setText(text: string, tooltip: string = "") {
    this._statusBarItem.text = `${text}`;
    this._statusBarItem.tooltip = tooltip || text;
  }

  public setCommand(command: string) {
    this._statusBarItem.command = command;
  }

  public hide() {
    this._statusBarItem.hide();
  }

  public getStatusBarItem(): vscode.StatusBarItem {
    return this._statusBarItem;
  }
}
