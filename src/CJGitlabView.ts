import * as vscode from "vscode";
import { GitlabService } from "./GitlabService";
import { PublishEnv, BatchTarget } from "./types/BatchPublish";
import Modal, { Toast } from "./utils/modal";
import * as fs from "fs";
import * as path from "path";
import GitWatch from "./GitWatch";
function debounce<T extends (...args: any[]) => any>(
  fn: T,
  delay: number
): (...args: Parameters<T>) => void {
  let timeoutId: NodeJS.Timeout;
  return function (this: any, ...args: Parameters<T>) {
    clearTimeout(timeoutId);
    timeoutId = setTimeout(() => {
      fn.apply(this, args);
    }, delay);
  };
}

export class CJGitlabView implements vscode.WebviewViewProvider {
  private _view?: vscode.WebviewView;
  private readonly _extensionUri: vscode.Uri;
  private _gitlabService: GitlabService;
  private debouncedUpdateContent: () => void;
  private _gitWatch: GitWatch;
  private _pipelineTimer?: NodeJS.Timeout;
  private _pipelineInitialTimer?: NodeJS.Timeout;
  constructor(
    extensionUri: vscode.Uri,
    gitlabService: GitlabService,
    gitWatch: GitWatch
  ) {
    this._extensionUri = extensionUri;
    this._gitlabService = gitlabService;
    this._gitWatch = gitWatch;
    this.debouncedUpdateContent = debounce(this.updateContent.bind(this), 300);
  }

  public async publishToTest() {
    this.setLoading(true, "test");
    try {
      await this._gitlabService.checkStatusNoCommit();
      await this._gitlabService.publishDevloperEnv({
        mergeCallback: (mergeResponse) => {
          this.setMergeLink(mergeResponse.web_url, "test");
        },
      });
      Toast.info("自动合并测试环境成功");
    } catch (error: any) {
      Toast.error(error.message);
    } finally {
      this.setLoading(false, "test");
    }
  }

  public async publishToProd(userForce = false) {
    this.setLoading(true, "prod");
    try {
      await this._gitlabService.checkStatusNoCommit();
      const projectInfo = await this._gitlabService.getProjectInfo();
      const prodBranchName = await this._gitlabService.findProdBranch(
        projectInfo.id
      );
      const { mergeRequestResponse } =
        await this._gitlabService.applyMergeRequest(prodBranchName, userForce);
      this.setMergeLink(mergeRequestResponse.web_url, "prod");
      return mergeRequestResponse;
    } catch (err: any) {
      Toast.error(`${err.message}`);
      return null;
    } finally {
      this.setLoading(false, "prod");
    }
  }

  public async publishToCn(userForce = false) {
    this.setLoading(true, "cn");
    try {
      await this._gitlabService.checkStatusNoCommit();
      const projectInfo_cn = await this._gitlabService.getProjectInfo();
      const prodBranchName_cn = await this._gitlabService.findCnBranch(
        projectInfo_cn.id
      );
      const { mergeRequestResponse: mergeRes } =
        await this._gitlabService.applyMergeRequest(
          prodBranchName_cn,
          userForce
        );
      this.setMergeLink(mergeRes.web_url, "cn");
      return mergeRes;
    } catch (err: any) {
      Toast.error(`${err.message}`);
      return null;
    } finally {
      this.setLoading(false, "cn");
    }
  }

  public async copyLink(data: { env: string; content: string }) {
    try {
      // prod 是 webview 历史命名，对应 buildMergeInfo 的 com 环境
      const env = (data.env === "prod" ? "com" : data.env) as PublishEnv;
      return await this._gitlabService.buildMergeInfo(env, data.content);
    } catch (error: any) {
      Toast.error(error.message);
      return "";
    }
  }

  public async getProdAndCnInfo() {
    try {
      const cnRes = await this.publishToCn(true);
      const prodRes = await this.publishToProd(true);
      const cnContent = await this.copyLink({
        env: "cn",
        content: cnRes?.web_url || "",
      });
      const prodContent = await this.copyLink({
        env: "prod",
        content: prodRes?.web_url || "",
      });
      let content = "";
      if (cnRes?.web_url) {
        content += cnContent + "\n\n";
      }
      if (prodRes?.web_url) {
        content += prodContent;
      }
      vscode.env.clipboard.writeText(content);
      Toast.info(`已复制到剪贴板`);
    } catch (error: any) {
      Toast.error(error.message);
    }
  }

  /**
   * 一键批量合并：多选项目(默认全选,含submodule) + 多选环境(默认全选 test/cn/com)
   * test 自动合并，cn/com 仅建 MR 并汇总复制 MR 信息；单项目/环境失败跳过不中断
   * 需求来源：6.11调整 第1次提交
   */
  public async batchMerge() {
    const projectInfos =
      await this._gitlabService.getAllWorkspaceProjectInfos();
    if (projectInfos.length === 0) {
      Toast.error("未找到可合并的项目");
      return;
    }

    const projectItems = projectInfos.map((p) => ({
      label: p.name,
      description: `分支: ${p.branch}${p.isSubmodule ? " · submodule" : ""}`,
      picked: true,
      fsPath: p.fsPath,
    }));
    const selectedProjects = await vscode.window.showQuickPick(projectItems, {
      title: "选择要合并的项目（默认全选）",
      placeHolder: "可多选，含 submodule 子项目",
      canPickMany: true,
    });
    if (!selectedProjects || selectedProjects.length === 0) {
      return;
    }

    const envItems: Array<{ label: string; picked: boolean; env: PublishEnv }> =
      [
        { label: "TEST 测试环境（自动合并）", picked: true, env: "test" },
        { label: "CN 国内生产（仅建MR）", picked: true, env: "cn" },
        { label: "COM 国际生产（仅建MR）", picked: true, env: "com" },
      ];
    const selectedEnvs = await vscode.window.showQuickPick(envItems, {
      title: "选择合并环境（默认全选）",
      placeHolder: "可多选",
      canPickMany: true,
    });
    if (!selectedEnvs || selectedEnvs.length === 0) {
      return;
    }

    const targets: BatchTarget[] = selectedProjects.map((p) => ({
      fsPath: p.fsPath,
      name: p.label,
    }));
    const envs = selectedEnvs.map((e) => e.env);

    const results = await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: "一键批量合并",
        cancellable: false,
      },
      (progress) =>
        this._gitlabService.batchPublish(targets, envs, (done, total, label) => {
          progress.report({
            message: `(${done}/${total}) ${label}`,
            increment: total > 0 ? 100 / total : 0,
          });
        })
    );

    // cn/com 成功的 MR 信息汇总复制
    const mergeInfos = results
      .filter((r) => r.status === "success" && r.mergeInfo)
      .map((r) => r.mergeInfo!);
    if (mergeInfos.length > 0) {
      vscode.env.clipboard.writeText(mergeInfos.join("\n\n"));
    }

    await this.refresh();
    this.showBatchSummary(results, mergeInfos.length);
  }

  private showBatchSummary(
    results: Array<{
      projectName: string;
      env: PublishEnv;
      status: string;
      message: string;
    }>,
    copiedCount: number
  ) {
    const envLabel: Record<string, string> = { test: "TEST", cn: "CN", com: "COM" };
    const fmt = (r: (typeof results)[number]) =>
      `${r.projectName} · ${envLabel[r.env]}：${r.message}`;
    const success = results.filter((r) => r.status === "success");
    const skipped = results.filter((r) => r.status === "skipped");
    const failed = results.filter((r) => r.status === "failed");

    const lines: string[] = [
      `成功 ${success.length} · 跳过 ${skipped.length} · 失败 ${failed.length}`,
    ];
    if (copiedCount > 0) {
      lines.push(`已复制 ${copiedCount} 条 MR 信息到剪贴板`);
    }
    if (success.length) {
      lines.push("", "✅ 成功:", ...success.map(fmt));
    }
    if (skipped.length) {
      lines.push("", "⏭️ 跳过:", ...skipped.map(fmt));
    }
    if (failed.length) {
      lines.push("", "❌ 失败:", ...failed.map(fmt));
    }
    const detail = lines.join("\n");

    if (success.length === 0 && failed.length > 0) {
      Modal.warning("一键批量合并：全部失败", { detail });
    } else {
      Modal.info("一键批量合并完成", { detail });
    }
  }

  public async refresh() {
    await this.updateContent();
    this.startPipelineTimer();
  }

  public async selectTargetProject() {
    const selectedFolder = await this._gitlabService.selectTargetProject();
    if (!selectedFolder) {
      return;
    }
    await this.refresh();
    Toast.info(`已切换目标项目: ${selectedFolder.name}`);
  }

  public async resolveWebviewView(
    webviewView: vscode.WebviewView,
    context: vscode.WebviewViewResolveContext,
    token: vscode.CancellationToken
  ): Promise<void> {
    this._view = webviewView;
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this._extensionUri],
    };

    webviewView.webview.onDidReceiveMessage(async (data) => {
      switch (data.command) {
        case "getProdAndCnInfo":
          this.getProdAndCnInfo();
          break;
        case "copyLink":
          try {
            const content = await this.copyLink(data);
            vscode.env.clipboard.writeText(content);
            Toast.info(`已复制到剪贴板`);
          } catch (error: any) {
            Toast.error(error.message);
          }
          break;
        case "showMessage":
          Toast.info(data.content);
          break;
        case "copyText":
          vscode.env.clipboard.writeText(data.content);
          Toast.info(`${data.content}, 已复制到剪贴板`);
          break;
        case "copyBranch":
          vscode.env.clipboard.writeText(data.content);
          Toast.info(`分支名 "${data.content}" 已复制到剪贴板`);
          break;
        case "publishToProd":
          this.publishToProd();
          break;
        case "publishToCn":
          this.publishToCn();
          break;
        case "publishToTest":
          this.publishToTest();
          break;
        case "batchMerge":
          this.batchMerge();
          break;
        case "selectTargetProject":
          try {
            await this.selectTargetProject();
          } catch (error: any) {
            Toast.error(error.message || "切换目标项目失败");
          }
          break;
        case "switchProject":
          try {
            const folder = vscode.workspace.workspaceFolders?.find(
              (f) => f.uri.fsPath === data.fsPath
            );
            if (folder) {
              this._gitlabService.setTargetProjectByWorkspaceFolder(folder);
              await this.refresh();
            } else {
              // 尝试作为 submodule 处理
              this._gitlabService.setTargetProjectByWorkspaceFolder({
                uri: vscode.Uri.file(data.fsPath),
                name: data.fsPath.split("/").pop() || "unknown",
                index: -1,
              } as vscode.WorkspaceFolder);
              await this.refresh();
            }
          } catch (error: any) {
            Toast.error(error.message || "切换项目失败");
          }
          break;
        case "openFile":
          try {
            const workspaceFolder = vscode.workspace.workspaceFolders?.find(
              (folder) =>
                folder.uri.fsPath === this._gitlabService.getCurrentWorkspaceRootPath()
            );
            if (workspaceFolder) {
              this._gitlabService.setTargetProjectByWorkspaceFolder(workspaceFolder);
            }
            const filePath = vscode.Uri.file(
              path.join(
                this._gitlabService.getCurrentWorkspaceRootPath(),
                data.content
              )
            );
            vscode.window.showTextDocument(filePath);
          } catch (error: any) {
            Toast.error(error.message);
          }
          break;
      }
    });

    // Listen for visibility changes to refresh content
    webviewView.onDidChangeVisibility(() => {
      if (webviewView.visible) {
        this.debouncedUpdateContent();
        this.startPipelineTimer();
      } else {
        this.stopPipelineTimer();
      }
    });

    // Listen for dispose event to clean up timer
    webviewView.onDidDispose(() => {
      this.stopPipelineTimer();
    });

    this._gitWatch.add(this.debouncedUpdateContent.bind(this));

    await this.updateContent();
    this.startPipelineTimer();
  }

  private setLoading(loading: boolean, env: "test" | "cn" | "prod" = "test") {
    if (!this._view) {
      return;
    }
    this._view.webview.postMessage({
      type: "setLoading",
      loading,
      env,
    });
  }

  private setMergeLink(link: string, env: "test" | "cn" | "prod") {
    if (!this._view) {
      return;
    }
    this._view.webview.postMessage({ type: "merge_link", link, env });
  }

  private startPipelineTimer() {
    this.stopPipelineTimer(); // 确保不会有重复的定时器
    
    // 稍微延迟一下再开始定时更新，避免与初始加载重复
    // 第一次延迟2秒，然后每5秒更新一次
    this._pipelineInitialTimer = setTimeout(async () => {
      await this.updatePipelineAndTagStatus();
      
      // 设置定时器，每5秒更新一次
      this._pipelineTimer = setInterval(async () => {
        await this.updatePipelineAndTagStatus();
      }, 5000);
    }, 2000);
  }

  private stopPipelineTimer() {
    if (this._pipelineTimer) {
      clearInterval(this._pipelineTimer);
      this._pipelineTimer = undefined;
    }
    if (this._pipelineInitialTimer) {
      clearTimeout(this._pipelineInitialTimer);
      this._pipelineInitialTimer = undefined;
    }
  }

  private async updatePipelineAndTagStatus() {
    if (!this._view) {
      console.log('Pipeline and tag update skipped: No view available');
      return;
    }
    
    try {
      console.log('Starting pipeline and tag status update...');
      const projectInfo = await this._gitlabService.getProjectInfo();
      // const currentBranch = await this._gitlabService.getCurrentBranch();
      
      if (!projectInfo.id) {
        console.log('Pipeline and tag update skipped: No project ID');
        return;
      }

      // 获取最新的pipeline状态
      const latestPipeline = await this._gitlabService.getLatestPipeline(projectInfo.id);
      
      // 获取最新的tag
      const latestTag = await this._gitlabService.getLatestTag(projectInfo.id);

      // 获取活跃的merge requests
      let activeMergeRequests: any[] = [];
      try {
        const allMRs = await this._gitlabService.getMergeRequests(projectInfo.id);
        activeMergeRequests = allMRs.filter((mr) => mr.state === "opened");
      } catch (e) {
        console.error('获取活跃MR失败:', e);
      }

      // 获取已合并到 pipeline ref 的 MR
      let pipelineMergedMRs: any[] = [];
      if (latestPipeline?.ref) {
        try {
          pipelineMergedMRs = await this._gitlabService.getMergedMergeRequests(
            projectInfo.id,
            latestPipeline.ref
          );
        } catch (e) {
          console.error('获取Pipeline已合并MR失败:', e);
        }
      }
      
      // 发送pipeline状态更新
      this._view.webview.postMessage({ 
        type: "pipeline_status", 
        pipeline: latestPipeline 
      });

      // 发送tag状态更新
      this._view.webview.postMessage({ 
        type: "tag_status", 
        tag: latestTag 
      });

      // 发送活跃MR更新
      this._view.webview.postMessage({
        type: "active_merge_requests",
        mergeRequests: activeMergeRequests,
      });

      // 发送Pipeline已合并MR更新
      this._view.webview.postMessage({
        type: "pipeline_merged_mrs",
        mergeRequests: pipelineMergedMRs,
      });
    } catch (error) {
      console.error('更新pipeline和tag状态失败:', error);
    }
  }

  private getScriptUris() {
    const scripts = {
      main: ["webview", "main.js"],
      vue: ["assets", "js", "vue.2.7.16.min.js"],
      // 在这里可以方便地添加更多脚本
    };

    return Object.entries(scripts).reduce((acc, [key, paths]) => {
      acc[key] = this._view!.webview.asWebviewUri(
        vscode.Uri.joinPath(this._extensionUri, "resources", ...paths)
      );
      return acc;
    }, {} as Record<string, vscode.Uri>);
  }

  private async updateContent() {
    if (!this._view) {
      return;
    }

    const projectInfo = await this._gitlabService.getProjectInfo();
    const currentBranch = await this._gitlabService.getCurrentBranch();
    await this._gitlabService.getTestBranch().catch((err) => {});

    if (!projectInfo.id) {
      this._view.webview.html = `
          <!DOCTYPE html>
          <html>
              <body>
                  <h2>当前不是 CJ 的项目</h2>
              </body>
          </html>
        `;
      return;
    }

    const styleUri = this._view.webview.asWebviewUri(
      vscode.Uri.joinPath(
        this._extensionUri,
        "resources",
        "webview",
        "styles.css"
      )
    );

    const scripts = this.getScriptUris();

    const stashFiles = await this._gitlabService.getNoCommitFiles();

    // 获取初始的pipeline和tag状态
    let latestPipeline = null;
    let latestTag = null;
    let activeMergeRequests: any[] = [];
    let pipelineMergedMRs: any[] = [];
    try {
      latestPipeline = await this._gitlabService.getLatestPipeline(projectInfo.id);
      latestTag = await this._gitlabService.getLatestTag(projectInfo.id);
      const allMRs = await this._gitlabService.getMergeRequests(projectInfo.id);
      activeMergeRequests = allMRs.filter((mr) => mr.state === "opened");
      // 获取已合并到 pipeline ref 分支的 MR
      if (latestPipeline?.ref) {
        pipelineMergedMRs = await this._gitlabService.getMergedMergeRequests(
          projectInfo.id,
          latestPipeline.ref
        );
      }
    } catch (error) {
      console.error('获取初始pipeline、tag和MR状态失败:', error);
    }

    // 获取所有工作区项目列表（用于多项目Tab）
    const workspaceTabs = await this._gitlabService.getAllWorkspaceProjectInfos();

    const __INITIAL_STATE__ = {
      projectInfo,
      currentBranch,
      currentWorkspaceName: this._gitlabService.getCurrentWorkspaceName(),
      stashFiles,
      latestPipeline,
      latestTag,
      workspaceTabs,
      activeMergeRequests,
      pipelineMergedMRs,
    };

    const indexTemplate = fs.readFileSync(
      path.join(
        this._extensionUri.fsPath,
        "resources",
        "webview",
        "index.html"
      ),
      "utf-8"
    );

    this._view.webview.html = `
          <!DOCTYPE html>
          <html>
              <head>
                  <link rel="stylesheet" href="${styleUri}" />
                  <script src="${scripts.vue}"></script>
              </head>
              <body>
                  ${indexTemplate}

                  <script>
                     window.__INITIAL_STATE__ = ${JSON.stringify(
                       __INITIAL_STATE__
                     )};
                  </script>
                  <script src="${scripts.main}"></script>
              </body>
          </html>
      `;
  }
}
