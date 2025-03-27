import * as vscode from "vscode";
import { CJGitlabView } from "./CJGitlabView";
import StatusBar from "./StatusBar";
import { GitlabService } from "./GitlabService";
import GitWatch from "./GitWatch";
import { Toast } from "./utils/modal";

export function activate(context: vscode.ExtensionContext) {
  const gitWatch = new GitWatch();
  const gitlabService = new GitlabService();
  const statusBar = new StatusBar(gitlabService, gitWatch);
  const provider = new CJGitlabView(
    context.extensionUri,
    gitlabService,
    gitWatch
  );

  if (gitlabService.isNotConfig()) {
    Toast.info("请先配置 Gitlab 的 API URL 和 Token", "打开设置").then(
      (selection) => {
        if (selection === "打开设置") {
          vscode.commands.executeCommand(
            "workbench.action.openSettings",
            "cj-gitlab"
          );
        }
      }
    );
    return;
  }

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
