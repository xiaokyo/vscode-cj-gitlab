import * as vscode from "vscode";
import { GitlabService } from "./GitlabService";
import { Toast } from "./utils/modal";
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
      const projectInfo = await this._gitlabService.getProjectInfo();
      const envMap = {
        test: "测试",
        cn: "线上(CN)",
        prod: "线上(COM)",
      } as const;
      const env = envMap[data.env as keyof typeof envMap];
      const link = data.content;
      const commitLastLog = await this._gitlabService.getCommitLogLastTitle();
      const content = `项目名称：${projectInfo.name}\ncommit信息: ${commitLastLog}\n合并环境: ${env}\n链接: ${link}`;
      return content;
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
        case "openFile":
          try {
            const filePath = vscode.Uri.file(
              path.join(
                vscode.workspace.workspaceFolders?.[0].uri.fsPath || "",
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
      const currentBranch = await this._gitlabService.getCurrentBranch();
      
      console.log('Project info:', { id: projectInfo.id, name: projectInfo.name });
      console.log('Current branch:', currentBranch);
      
      if (!projectInfo.id) {
        console.log('Pipeline and tag update skipped: No project ID');
        return;
      }

      // 获取最新的pipeline状态
      console.log('Calling getLatestPipeline with projectId:', projectInfo.id, 'branch:', currentBranch);
      const latestPipeline = await this._gitlabService.getLatestPipeline(projectInfo.id);
      
      // 获取最新的tag
      console.log('Calling getLatestTag with projectId:', projectInfo.id);
      const latestTag = await this._gitlabService.getLatestTag(projectInfo.id);
      
      console.log('Latest pipeline result:', latestPipeline);
      console.log('Latest tag result:', latestTag);
      
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
    try {
      latestPipeline = await this._gitlabService.getLatestPipeline(projectInfo.id);
      latestTag = await this._gitlabService.getLatestTag(projectInfo.id);
    } catch (error) {
      console.error('获取初始pipeline和tag状态失败:', error);
    }

    const __INITIAL_STATE__ = {
      projectInfo,
      currentBranch,
      stashFiles,
      latestPipeline,
      latestTag,
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
