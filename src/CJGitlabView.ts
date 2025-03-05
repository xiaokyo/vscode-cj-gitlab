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
          const projectInfo = await this._gitlabService.getProjectInfo();
          const prodBranchName = await this._gitlabService.findProdBranch(
            projectInfo.id
          );
          const { mergeRequestResponse } =
            await this._gitlabService.applyMergeRequest(prodBranchName);
          this.setMergeLinkProd(mergeRequestResponse.web_url);
          break;
        case "publishToCn":
          const projectInfo_cn = await this._gitlabService.getProjectInfo();
          const prodBranchName_cn = await this._gitlabService.findProdBranch(
            projectInfo_cn.id
          );
          const { mergeRequestResponse: mergeRes } =
            await this._gitlabService.applyMergeRequest(prodBranchName_cn);
          this.setMergeLinkProd(mergeRes.web_url);
          break;
        case "publishToTest":
          this.setLoading(true);
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
            this.setLoading(false);
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

  private setLoading(loading: boolean) {
    if (!this._view) return;
    this._view.webview.postMessage({ type: "setLoading", loading });
  }

  private setMergeLink(link: string) {
    if (!this._view) return;
    this._view.webview.postMessage({ type: "merge_link", link });
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

    this._view.webview.html = `
          <!DOCTYPE html>
          <html>
              <head>
                  <style>
                      body {
                          padding: 12px;
                          font-family: -apple-system, system-ui, sans-serif;
                          color: var(--vscode-foreground);
                      }
                      .project-card {
                          background: var(--vscode-editor-background);
                          border: 1px solid var(--vscode-widget-border);
                          border-radius: 6px;
                          padding: 12px;
                          margin-bottom: 16px;
                      }
                      .info-item {
                          display: flex;
                          padding: 4px 0;
                          font-size: 12px;
                      }
                      .info-label {
                          color: var(--vscode-descriptionForeground);
                          width: 80px;
                      }
                      .info-value {
                          flex: 1;
                      }
                      .btn {
                          background: var(--vscode-button-background);
                          color: var(--vscode-button-foreground);
                          border: none;
                          padding: 6px 12px;
                          border-radius: 4px;
                          cursor: pointer;
                          font-size: 12px;
                          width: 100%;
                          margin-bottom: 15px;
                      }
                      .btn:hover {
                          background: var(--vscode-button-hoverBackground);
                      }
                      .btn:disabled {
                          opacity: 0.6;
                          cursor: not-allowed;
                      }
                      .btn.loading {
                          position: relative;
                          color: transparent !important;
                      }
                      .btn.loading::after {
                          content: '';
                          position: absolute;
                          left: 50%;
                          top: 50%;
                          width: 16px;
                          height: 16px;
                          margin-left: -8px;
                          margin-top: -8px;
                          border: 2px solid var(--vscode-button-foreground);
                          border-radius: 50%;
                          border-right-color: transparent;
                          animation: spin 1s linear infinite;
                      }
                      @keyframes spin {
                          to { transform: rotate(360deg); }
                      }
                  </style>
              </head>
              <body>
                  <div class="project-card">
                      <div class="info-item">
                          <span class="info-label">Project</span>
                          <span class="info-value">${projectInfo.name}</span>
                      </div>
                      <div class="info-item">
                          <span class="info-label">Branch</span>
                          <span class="info-value">${currentBranch}</span>
                      </div>
                      ${
                        projectInfo.description
                          ? `
                      <div class="info-item">
                          <span class="info-label">About</span>
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
                      
                      <!-- Add merge link test -->
                      <div class="info-item" id="merge-link" style="display:none;">
                          <span class="info-label">Merge Link(test)</span>
                          <span class="info-value"></span>
                      </div>

                      <!-- Add merge link cn -->
                      <div class="info-item" id="merge-link-cn" style="display:none;">
                          <span class="info-label">Merge Link(cn)</span>
                          <span class="info-value"></span>
                      </div>

                      <!-- Add merge link prod -->
                      <div class="info-item" id="merge-link-prod" style="display:none;">
                          <span class="info-label">Merge Link(prod)</span>
                          <span class="info-value"></span>
                      </div>
                  </div>
                  <button id="publishBtn" class="btn" onclick="publishToTest()">发布到测试环境</button>

                  <button class="btn" onclick="publishToCn()">申请合并线上(Cn)</button>

                  <button class="btn" onclick="publishToProd()">申请合并线上(Prod)</button>
                  <script>
                      const vscode = acquireVsCodeApi();
                      const publishBtn = document.getElementById('publishBtn');

                      function publishToTest() {
                        vscode.postMessage({ command: 'publishToTest' });
                      }

                      function publishToCn() {
                        vscode.postMessage({ command: 'publishToCn' });
                      }

                      function publishToProd() {
                        vscode.postMessage({ command: 'publishToProd' });
                      }

                      window.addEventListener('message', event => {
                          const message = event.data;
                          if (message.type === 'setLoading') {
                              if (message.loading) {
                                  publishBtn.classList.add('loading');
                                  publishBtn.disabled = true;
                              } else {
                                  publishBtn.classList.remove('loading');
                                  publishBtn.disabled = false;
                              }
                          }

                          // merge_link
                          if (message.type === 'merge_link') {
                              const mergeLink = document.getElementById('merge-link');
                              mergeLink.style.display = 'block';
                              mergeLink.querySelector('.info-value').innerHTML = '<a href="' + message.link + '">' + message.link + '</a>';
                          }

                          // merge_link_cn
                          if (message.type === 'merge_link_cn') {
                              const mergeLink = document.getElementById('merge-link-cn');
                              mergeLink.style.display = 'block';
                              mergeLink.querySelector('.info-value').innerHTML = '<a href="' + message.link + '">' + message.link + '</a>';
                          }

                          // merge_link_prod
                          if (message.type === 'merge_link_prod') {
                              const mergeLink = document.getElementById('merge-link-prod');
                              mergeLink.style.display = 'block';
                              mergeLink.querySelector('.info-value').innerHTML = '<a href="' + message.link + '">' + message.link + '</a>';
                          }
                      });
                  </script>
              </body>
          </html>
      `;
  }
}
