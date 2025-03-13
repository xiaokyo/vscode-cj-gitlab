import * as vscode from "vscode";
import { CJGitlabView } from "./CJGitlabView";
import StatusBar from "./StatusBar";
import { GitlabService } from "./GitlabService";

export function activate(context: vscode.ExtensionContext) {
  const gitlabService = new GitlabService();
  const statusBar = new StatusBar(gitlabService);
  const provider = new CJGitlabView(context.extensionUri, gitlabService);

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider("cjGitlab", provider, {
      webviewOptions: { retainContextWhenHidden: true },
    })
  );

  // 注册 publishToTest 命令
  context.subscriptions.push(
    vscode.commands.registerCommand("cj-gitlab.publishToTest", () => {
      provider.publishToTest();
    })
  );

  statusBar.setCommand("cj-gitlab.publishToTest");
}

export function deactivate() {}
