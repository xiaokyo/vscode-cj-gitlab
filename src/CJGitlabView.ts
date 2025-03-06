import * as vscode from "vscode";
import { GitlabService } from "./GitlabService";

export class CJGitlabView implements vscode.WebviewViewProvider {
  private _view?: vscode.WebviewView;
  private readonly _extensionUri: vscode.Uri;
  private _gitlabService: GitlabService;

  constructor(extensionUri: vscode.Uri) {
    this._extensionUri = extensionUri;
    this._gitlabService = new GitlabService();
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
            this.setMergeLinkProd(mergeRequestResponse.web_url);
          } catch (err: any) {
            vscode.window.showErrorMessage(`Error: ${err.message}`);
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
            this.setMergeLinkCn(mergeRes.web_url);
          } catch (err: any) {
            vscode.window.showErrorMessage(`Error: ${err.message}`);
          } finally {
            this.setLoading(false, "cn");
          }
          break;
        case "publishToTest":
          this.setLoading(true, "test");
          try {
            await this._gitlabService.publishDevloperEnv({
              mergeCallback: (mergeResponse) => {
                this.setMergeLink(mergeResponse.web_url);
              },
            });
            vscode.window.showInformationMessage(
              "Merge request accepted successfully."
            );
          } catch (error: any) {
            vscode.window.showErrorMessage(`Error: ${error.message}`);
          } finally {
            this.setLoading(false, "test");
          }
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

  private setLoading(
    loading: boolean,
    loadingType: "test" | "cn" | "prod" = "test"
  ) {
    if (!this._view) return;
    this._view.webview.postMessage({
      type: "setLoading",
      loading,
      loadingType,
    });
  }

  private setMergeLink(link: string) {
    if (!this._view) return;
    this._view.webview.postMessage({ type: "merge_link", link });
  }

  private setMergeLinkCn(link: string) {
    if (!this._view) return;
    this._view.webview.postMessage({ type: "merge_link_cn", link });
  }

  private setMergeLinkProd(link: string) {
    if (!this._view) return;
    this._view.webview.postMessage({ type: "merge_link_prod", link });
  }

  private async updateContent() {
    if (!this._view) {
      return;
    }

    const projectInfo = await this._gitlabService.getProjectInfo();
    const currentBranch = await this._gitlabService.getCurrentBranch();
    await this._gitlabService.findTestBranch(projectInfo?.id);

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
      vscode.Uri.joinPath(this._extensionUri, "src", "webview", "styles.css")
    );
    const scriptUri = this._view.webview.asWebviewUri(
      vscode.Uri.joinPath(this._extensionUri, "src", "webview", "webview.js")
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
                      
                      <div class="info-item" id="merge-link" style="display:none;">
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
                  <button id="publishBtn" class="btn" onclick="publishToTest()">发布到测试环境</button>
                  <button id="publishBtnCn" class="btn" onclick="publishToCn()">申请合并线上(Cn)</button>
                  <button id="publishBtnProd" class="btn" onclick="publishToProd()">申请合并线上(Prod)</button>
                  <script src="${scriptUri}"></script>
              </body>
          </html>
      `;
  }
}
