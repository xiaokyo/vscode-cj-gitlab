import * as vscode from "vscode";
import { GitlabService } from "./GitlabService";
import { PublishEnv, BatchTarget } from "./types/BatchPublish";
import { Pipeline } from "./types/Pipeline";
import { Project } from "./types/Project";
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
  // 缓存上次推送数据的序列化结果，未变化则跳过 postMessage 避免 webview 重渲染
  private _lastPostHash: Record<string, string> = {};
  // 跟踪 pipeline 真实状态，仅在翻转为 failed 时通知一次（不随 webview 重建重置）
  private _lastPipelineStatus?: string;
  // 按工作区缓存上次的 __INITIAL_STATE__，切换项目时秒开占位，后台再刷新覆盖
  private _stateCache = new Map<string, any>();
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

  /** 发布前非阻塞提示：有未提交改动仅警告，不拦截流程 */
  private async warnIfUncommitted() {
    if (await this._gitlabService.hasUncommitted()) {
      Toast.warning("有未提交的文件，发布不会包含这些改动");
    }
  }

  public async publishToTest() {
    this.setLoading(true, "test");
    try {
      void this.warnIfUncommitted();
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

  public async publishToProd(userForce = false, skipWarn = false) {
    this.setLoading(true, "prod");
    try {
      if (!skipWarn) {
        void this.warnIfUncommitted();
      }
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

  public async publishToCn(userForce = false, skipWarn = false) {
    this.setLoading(true, "cn");
    try {
      if (!skipWarn) {
        void this.warnIfUncommitted();
      }
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
      void this.warnIfUncommitted();
      const cnRes = await this.publishToCn(true, true);
      const prodRes = await this.publishToProd(true, true);
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
      warning?: string;
    }>,
    copiedCount: number
  ) {
    const envLabel: Record<string, string> = { test: "TEST", cn: "CN", com: "COM" };
    const fmt = (r: (typeof results)[number]) =>
      `${r.projectName} · ${envLabel[r.env]}：${r.message}${
        r.warning ? `（⚠️ ${r.warning}）` : ""
      }`;
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

  /**
   * 一键提交并推送：干净工作区仅提示不弹框；填 message 后 add -A → commit → push
   */
  public async commitAndPush() {
    // 用 hasUncommitted 判定（与 Service 一致，getNoCommitFiles 会漏 staged-only/rename）
    if (!(await this._gitlabService.hasUncommitted())) {
      Toast.info("无待提交改动");
      return;
    }
    const message = await vscode.window.showInputBox({
      prompt: "输入 commit message",
      placeHolder: "将提交(add -A)并推送全部改动",
    });
    if (!message || !message.trim()) {
      return;
    }
    try {
      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: "一键提交并推送",
          cancellable: false,
        },
        () => this._gitlabService.commitAndPush(message)
      );
      Toast.info("提交并推送成功");
      await this.refresh();
    } catch (err: any) {
      Toast.error(err?.message || "提交失败");
    }
  }

  /**
   * 切分支：QuickPick 列出本地+远程分支，首项可复制当前分支名
   * 选中非当前分支则 checkout（未提交改动会被拦截）
   */
  public async switchBranch() {
    try {
      const currentBranch = await this._gitlabService.getCurrentBranch();
      const branches = await this._gitlabService.getLocalAndRemoteBranches();

      type Item = vscode.QuickPickItem & {
        action?: "copy";
        branch?: string;
        isRemote?: boolean;
      };
      const items: Item[] = [
        { label: "$(copy) 复制当前分支名", action: "copy" },
        { label: "", kind: vscode.QuickPickItemKind.Separator },
        ...branches.map(
          (b): Item => ({
            label: b.isCurrent ? `$(check) ${b.name}` : b.name,
            description: b.isCurrent ? "当前" : b.isRemote ? "远程" : "",
            branch: b.name,
            isRemote: b.isRemote,
          })
        ),
      ];

      const selected = await vscode.window.showQuickPick(items, {
        title: "切换分支",
        placeHolder: `当前分支: ${currentBranch}`,
      });
      if (!selected) {
        return;
      }

      if (selected.action === "copy") {
        vscode.env.clipboard.writeText(currentBranch);
        Toast.info(`分支名 "${currentBranch}" 已复制到剪贴板`);
        return;
      }

      if (!selected.branch || selected.branch === currentBranch) {
        return;
      }

      await this._gitlabService.checkoutBranch(
        selected.branch,
        Boolean(selected.isRemote)
      );
      Toast.info(`已切换到分支: ${selected.branch}`);
      await this.refresh();
    } catch (error: any) {
      Toast.error(error.message || "切换分支失败");
    }
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
        case "switchBranch":
          this.switchBranch();
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
        case "commitAndPush":
          this.commitAndPush();
          break;
        case "retryPipeline":
          this.retryPipeline(data.pipelineId);
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

      // 设置定时器，每15秒更新一次（原5秒过于激进，每分钟约48个API请求）
      this._pipelineTimer = setInterval(async () => {
        await this.updatePipelineAndTagStatus();
      }, 15000);
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

  /**
   * 数据相比上次未变化则跳过 postMessage，减少 webview 无谓重渲染
   */
  private postIfChanged(key: string, message: Record<string, any>) {
    if (!this._view) {
      return;
    }
    const hash = JSON.stringify(message);
    if (this._lastPostHash[key] === hash) {
      return;
    }
    this._lastPostHash[key] = hash;
    this._view.webview.postMessage(message);
  }

  private async updatePipelineAndTagStatus() {
    if (!this._view) {
      return;
    }

    // 调用时刻锁定 cacheKey，避免异步 resolve 时工作区已切换导致数据串到别的项目缓存
    const cacheKey = this._gitlabService.getCurrentWorkspaceRootPath();

    try {
      const projectInfo = await this._gitlabService.getProjectInfo();

      if (!projectInfo.id) {
        return;
      }

      // pipeline / tag / 活跃MR 互不依赖，并行请求（原串行每次4个await）
      const [latestPipeline, latestTag, activeMergeRequests] = await Promise.all([
        this._gitlabService.getLatestPipeline(projectInfo.id),
        this._gitlabService.getLatestTag(projectInfo.id),
        this._gitlabService
          .getMergeRequests(projectInfo.id)
          .then((allMRs) => allMRs.filter((mr) => mr.state === "opened"))
          .catch((e) => {
            console.error("获取活跃MR失败:", e);
            return [] as any[];
          }),
      ]);

      // 已合并MR依赖 pipeline.ref，需在 pipeline resolve 后请求
      let pipelineMergedMRs: any[] = [];
      if (latestPipeline?.ref) {
        try {
          pipelineMergedMRs = await this._gitlabService.getMergedMergeRequests(
            projectInfo.id,
            latestPipeline.ref
          );
        } catch (e) {
          console.error("获取Pipeline已合并MR失败:", e);
        }
      }

      // 状态翻转为 failed 时通知一次（同一失败 pipeline 不重复骚扰）
      if (
        latestPipeline?.status === "failed" &&
        this._lastPipelineStatus !== "failed"
      ) {
        void this.notifyPipelineFailed(latestPipeline);
      }
      this._lastPipelineStatus = latestPipeline?.status;

      // 异步期间已切换到别的工作区则丢弃，避免数据串到别的项目缓存/webview
      if (this._gitlabService.getCurrentWorkspaceRootPath() !== cacheKey) {
        return;
      }

      // 回写缓存，下次切回该工作区可秒开最新数据
      const cached = this._stateCache.get(cacheKey) || {};
      this._stateCache.set(cacheKey, {
        ...cached,
        latestPipeline,
        latestTag,
        activeMergeRequests,
        pipelineMergedMRs,
      });

      this.postIfChanged("pipeline_status", {
        type: "pipeline_status",
        pipeline: latestPipeline,
      });
      this.postIfChanged("tag_status", { type: "tag_status", tag: latestTag });
      this.postIfChanged("active_merge_requests", {
        type: "active_merge_requests",
        mergeRequests: activeMergeRequests,
      });
      this.postIfChanged("pipeline_merged_mrs", {
        type: "pipeline_merged_mrs",
        mergeRequests: pipelineMergedMRs,
      });
    } catch (error) {
      console.error("更新pipeline和tag状态失败:", error);
    }
  }

  /**
   * Pipeline 失败通知：提供重跑失败 Job / 查看详情两个操作
   */
  private async notifyPipelineFailed(pipeline: Pipeline) {
    const action = await Toast.error(
      `Pipeline 失败: ${pipeline.ref}`,
      "重跑失败Job",
      "查看详情"
    );
    if (action === "重跑失败Job") {
      await this.retryPipeline(pipeline.id);
    } else if (action === "查看详情" && pipeline.web_url) {
      vscode.env.openExternal(vscode.Uri.parse(pipeline.web_url));
    }
  }

  /**
   * 重跑指定 pipeline 的失败 Job，并立即刷新状态
   */
  public async retryPipeline(pipelineId: number) {
    try {
      const projectInfo = await this._gitlabService.getProjectInfo();
      if (!projectInfo.id) {
        throw new Error("获取项目信息失败");
      }
      await this._gitlabService.retryPipeline(projectInfo.id, pipelineId);
      Toast.info("已触发重跑");
      await this.updatePipelineAndTagStatus();
    } catch (error: any) {
      Toast.error(error.message || "重跑 pipeline 失败");
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

    // 重建 webview HTML 会重置其内部状态，清空缓存以便定时器能重新推送数据
    this._lastPostHash = {};

    const projectInfo = await this._gitlabService.getProjectInfo();
    const currentBranch = await this._gitlabService.getCurrentBranch();

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

    const cacheKey = this._gitlabService.getCurrentWorkspaceRootPath();
    const cached = this._stateCache.get(cacheKey);

    // 命中缓存：用旧数据秒开，projectInfo/currentBranch 用最新，后台异步刷新覆盖
    if (cached) {
      const initialState = {
        ...cached,
        projectInfo,
        currentBranch,
        currentWorkspaceName: this._gitlabService.getCurrentWorkspaceName(),
      };
      this.renderWebviewHtml(initialState);
      void this.updatePipelineAndTagStatus();
      void this.refreshWorkspaceMeta(cacheKey);
      return;
    }

    // 未命中缓存：首次串行拉取完整数据
    const initialState = await this.buildInitialState(projectInfo, currentBranch);
    this._stateCache.set(cacheKey, initialState);
    this.renderWebviewHtml(initialState);
  }

  /** 首次拉取完整 __INITIAL_STATE__（stash / pipeline / tag / MR / 各环境分支） */
  private async buildInitialState(projectInfo: Project, currentBranch: string) {
    const stashFiles = await this._gitlabService.getNoCommitFiles();

    let latestPipeline = null;
    let latestTag = null;
    let activeMergeRequests: any[] = [];
    let pipelineMergedMRs: any[] = [];
    try {
      latestPipeline = await this._gitlabService.getLatestPipeline(projectInfo.id);
      latestTag = await this._gitlabService.getLatestTag(projectInfo.id);
      const allMRs = await this._gitlabService.getMergeRequests(projectInfo.id);
      activeMergeRequests = allMRs.filter((mr) => mr.state === "opened");
      if (latestPipeline?.ref) {
        pipelineMergedMRs = await this._gitlabService.getMergedMergeRequests(
          projectInfo.id,
          latestPipeline.ref
        );
      }
    } catch (error) {
      console.error("获取初始pipeline、tag和MR状态失败:", error);
    }

    const workspaceTabs = await this._gitlabService.getAllWorkspaceProjectInfos();

    const [testBranch, cnBranch, comBranch] = await Promise.all([
      this._gitlabService.getTestBranch().catch(() => ""),
      this._gitlabService.findCnBranch(projectInfo.id).catch(() => ""),
      this._gitlabService.findProdBranch(projectInfo.id).catch(() => ""),
    ]);

    return {
      projectInfo,
      currentBranch,
      currentWorkspaceName: this._gitlabService.getCurrentWorkspaceName(),
      stashFiles,
      latestPipeline,
      latestTag,
      workspaceTabs,
      activeMergeRequests,
      pipelineMergedMRs,
      envBranches: { test: testBranch, cn: cnBranch, com: comBranch },
    };
  }

  /** 后台刷新工作区列表 / stash / 环境分支，变化则 postMessage，并回写缓存 */
  private async refreshWorkspaceMeta(cacheKey: string) {
    try {
      const projectInfo = await this._gitlabService.getProjectInfo();
      if (!projectInfo.id) {
        return;
      }
      const [stashFiles, workspaceTabs, testBranch, cnBranch, comBranch] =
        await Promise.all([
          this._gitlabService.getNoCommitFiles().catch(() => []),
          this._gitlabService.getAllWorkspaceProjectInfos().catch(() => []),
          this._gitlabService.getTestBranch().catch(() => ""),
          this._gitlabService.findCnBranch(projectInfo.id).catch(() => ""),
          this._gitlabService.findProdBranch(projectInfo.id).catch(() => ""),
        ]);
      // 异步期间已切换到别的工作区则丢弃，避免把本项目数据写进/推送到别的项目
      if (this._gitlabService.getCurrentWorkspaceRootPath() !== cacheKey) {
        return;
      }
      const cached = this._stateCache.get(cacheKey) || {};
      this._stateCache.set(cacheKey, {
        ...cached,
        stashFiles,
        workspaceTabs,
        envBranches: { test: testBranch, cn: cnBranch, com: comBranch },
      });
      this.postIfChanged("stash_files", {
        type: "stash_files",
        stashFiles,
      });
      this.postIfChanged("workspace_tabs", {
        type: "workspace_tabs",
        workspaceTabs,
      });
      this.postIfChanged("env_branches", {
        type: "env_branches",
        envBranches: { test: testBranch, cn: cnBranch, com: comBranch },
      });
    } catch (error) {
      console.error("后台刷新工作区元信息失败:", error);
    }
  }

  private renderWebviewHtml(initialState: any) {
    if (!this._view) {
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
    const indexTemplate = fs.readFileSync(
      path.join(this._extensionUri.fsPath, "resources", "webview", "index.html"),
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
                     window.__INITIAL_STATE__ = ${JSON.stringify(initialState)};
                  </script>
                  <script src="${scripts.main}"></script>
              </body>
          </html>
      `;
  }
}
