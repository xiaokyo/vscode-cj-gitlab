import * as vscode from "vscode";
import { CJGitlabView } from "./CJGitlabView";
import StatusBar from "./StatusBar";
import { GitlabService } from "./GitlabService";
import GitWatch from "./GitWatch";

export function activate(context: vscode.ExtensionContext) {
  const gitWatch = new GitWatch();
  const gitlabService = new GitlabService();
  const statusBar = new StatusBar(gitlabService, gitWatch);
  const provider = new CJGitlabView(context.extensionUri, gitlabService, gitWatch);

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
