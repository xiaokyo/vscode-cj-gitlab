import * as vscode from "vscode";
import { GitlabService } from "./GitlabService";
import Modal, { Toast } from "./utils/modal";

export class CJGitlabView implements vscode.WebviewViewProvider {
  private _view?: vscode.WebviewView;
  private readonly _extensionUri: vscode.Uri;
  private _gitlabService: GitlabService;

  constructor(extensionUri: vscode.Uri) {
    this._extensionUri = extensionUri;
    this._gitlabService = new GitlabService();
  }

  public async publishToTest() {
    this.setLoading(true, "test");
    try {
      await this._gitlabService.publishDevloperEnv({
        mergeCallback: (mergeResponse) => {
          this.setMergeLink(mergeResponse.web_url, "test");
        },
      });
      Toast.info("自动合并测试环境成功");
    } catch (error: any) {
      Modal.error(error.message);
    } finally {
      this.setLoading(false, "test");
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
        case "publishToProd":
          this.setLoading(true, "prod");
          try {
            const projectInfo = await this._gitlabService.getProjectInfo();
            const prodBranchName = await this._gitlabService.findProdBranch(
              projectInfo.id
            );
            const { mergeRequestResponse } =
              await this._gitlabService.applyMergeRequest(prodBranchName);
            this.setMergeLink(mergeRequestResponse.web_url, "prod");
          } catch (err: any) {
            Modal.error(`${err.message}`);
          } finally {
            this.setLoading(false, "prod");
          }
          break;
        case "publishToCn":
          this.setLoading(true, "cn");
          try {
            const projectInfo_cn = await this._gitlabService.getProjectInfo();
            const prodBranchName_cn = await this._gitlabService.findCnBranch(
              projectInfo_cn.id
            );
            const { mergeRequestResponse: mergeRes } =
              await this._gitlabService.applyMergeRequest(prodBranchName_cn);
            this.setMergeLink(mergeRes.web_url, "cn");
          } catch (err: any) {
            Modal.error(`Error: ${err.message}`);
          } finally {
            this.setLoading(false, "cn");
          }
          break;
        case "publishToTest":
          this.publishToTest();
          break;
      }
    });

    // Listen for visibility changes to refresh content
    webviewView.onDidChangeVisibility(() => {
      if (webviewView.visible) {
        this.updateContent();
      }
    });

    await this.updateContent();
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

  private async updateContent() {
    if (!this._view) {
      return;
    }

    const projectInfo = await this._gitlabService.getProjectInfo();
    const currentBranch = await this._gitlabService.getCurrentBranch();
    await this._gitlabService.findTestBranch(projectInfo?.id);

    this._gitlabService.getMergeRequests(projectInfo?.id);

    if (!projectInfo.id) {
      this._view.webview.html = `
          <!DOCTYPE html>
          <html>
              <body>
                  <h2>这个项目不是CJ的项目</h2>
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
    const scriptUri = this._view.webview.asWebviewUri(
      vscode.Uri.joinPath(
        this._extensionUri,
        "resources",
        "webview",
        "webview.js"
      )
    );

    this._view.webview.html = `
          <!DOCTYPE html>
          <html>
              <head>
                  <link rel="stylesheet" href="${styleUri}">
              </head>
              <body>
                  <div class="project-card">
                      <div class="info-item">
                          <span class="info-label">项目名称</span>
                          <span class="info-value">${projectInfo.name}</span>
                      </div>
                      <div class="info-item">
                          <span class="info-label">当前分支</span>
                          <span class="info-value">${currentBranch}</span>
                      </div>
                      ${
                        projectInfo.description
                          ? `
                      <div class="info-item">
                          <span class="info-label">描述</span>
                          <span class="info-value">${projectInfo.description}</span>
                      </div>`
                          : ""
                      }
                      ${
                        projectInfo.web_url
                          ? `
                      <div class="info-item">
                          <span class="info-label">URL</span>
                          <span class="info-value"><a href="${projectInfo.web_url}">${projectInfo.web_url}</a></span>
                      </div>`
                          : ""
                      }
                      
                      <div class="info-item" id="merge-link-test" style="display:none;">
                          <span class="info-label">合并链接(test)</span>
                          <span class="info-value"></span>
                      </div>

                      <div class="info-item" id="merge-link-cn" style="display:none;">
                          <span class="info-label">合并链接(cn)</span>
                          <span class="info-value"></span>
                      </div>

                      <div class="info-item" id="merge-link-prod" style="display:none;">
                          <span class="info-label">合并链接(prod)</span>
                          <span class="info-value"></span>
                      </div>
                  </div>
                  <button id="publishBtnTest" class="btn" onclick="publishToTest()">发布到测试环境</button>
                  <button id="publishBtnCn" class="btn" onclick="publishToCn()">申请合并线上(Cn)</button>
                  <button id="publishBtnProd" class="btn" onclick="publishToProd()">申请合并线上(Prod)</button>
                  <script src="${scriptUri}"></script>
              </body>
          </html>
      `;
  }
}
