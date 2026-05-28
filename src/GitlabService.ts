import * as vscode from "vscode";
import { exec } from "child_process";
import { promisify } from "util";
import * as path from "path";
import { Project } from "./types/Project";
import { MergeResponse } from "./types/MergeRequest";
import { Branch } from "./types/Branch";
import { MergeRequestN } from "./types/mergeRequestN";
import { Pipeline } from "./types/Pipeline";
import { Tag } from "./types/Tag";
import Modal from "./utils/modal";

const execAsync = promisify(exec);

export class GitlabService {
  private readonly baseUrl: string;
  private readonly token: string;
  public testBranchNames = new Map<string, string>();
  public projectInfos = new Map<string, Project>();
  private selectedWorkspaceRootPath: string | null = null;

  constructor() {
    const config = vscode.workspace.getConfiguration("cj-gitlab");
    this.baseUrl = config.get("apiUrl") || "";
    this.token = config.get("token") || "";
  }

  isNotConfig() {
    return !this.baseUrl || !this.token;
  }

  /**
   * 获取项目对应环境的自定义分支名，未配置返回 undefined
   */
  private getBranchFromMapping(env: 'com' | 'cn' | 'test', projectName: string): string | undefined {
    const config = vscode.workspace.getConfiguration('cj-gitlab');
    const mapping: Record<string, Record<string, string>> = config.get('branchMapping') || {};
    return mapping[projectName]?.[env];
  }

  getBaseUrl() {
    return this.baseUrl;
  }

  getToken() {
    return this.token;
  }

  private getCurrentWorkspaceFolder(): vscode.WorkspaceFolder {
    if (this.selectedWorkspaceRootPath) {
      const selectedFolder = vscode.workspace.workspaceFolders?.find(
        (folder) => folder.uri.fsPath === this.selectedWorkspaceRootPath
      );
      if (selectedFolder) {
        return selectedFolder;
      }

      // 检查是否是 submodule 路径（不一定在工作区文件夹中）
      if (this.selectedWorkspaceRootPath.includes("/")) {
        return {
          uri: vscode.Uri.file(this.selectedWorkspaceRootPath),
          name: this.selectedWorkspaceRootPath.split("/").pop() || "unknown",
          index: -1,
        } as vscode.WorkspaceFolder;
      }

      this.selectedWorkspaceRootPath = null;
    }

    const activeUri = vscode.window.activeTextEditor?.document.uri;
    if (activeUri) {
      const activeFolder = vscode.workspace.getWorkspaceFolder(activeUri);
      if (activeFolder) {
        return activeFolder;
      }
    }

    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (workspaceFolders && workspaceFolders.length > 0) {
      return workspaceFolders[0];
    }

    throw new Error("未打开工作区");
  }

  private getCurrentWorkspaceKey(): string {
    return this.getCurrentWorkspaceFolder().uri.fsPath;
  }

  public getCurrentWorkspaceRootPath(): string {
    return this.getCurrentWorkspaceFolder().uri.fsPath;
  }

  public getCurrentWorkspaceName(): string {
    return this.getCurrentWorkspaceFolder().name;
  }

  public setTargetProjectByWorkspaceFolder(
    folder: vscode.WorkspaceFolder
  ): boolean {
    const nextPath = folder.uri.fsPath;
    const changed = this.selectedWorkspaceRootPath !== nextPath;
    this.selectedWorkspaceRootPath = nextPath;
    return changed;
  }

  public syncTargetProjectWithActiveEditor(): boolean {
    const activeUri = vscode.window.activeTextEditor?.document.uri;
    if (!activeUri) {
      return false;
    }

    const activeFolder = vscode.workspace.getWorkspaceFolder(activeUri);
    if (!activeFolder) {
      return false;
    }

    return this.setTargetProjectByWorkspaceFolder(activeFolder);
  }

  public async selectTargetProject(): Promise<vscode.WorkspaceFolder | null> {
    const workspaceFolders = vscode.workspace.workspaceFolders || [];
    if (workspaceFolders.length === 0) {
      throw new Error("未打开工作区");
    }

    if (workspaceFolders.length === 1) {
      this.setTargetProjectByWorkspaceFolder(workspaceFolders[0]);
      return workspaceFolders[0];
    }

    const quickPickItems = workspaceFolders.map((folder) => ({
      label: folder.name,
      description: folder.uri.fsPath,
      folder,
      picked: folder.uri.fsPath === this.getCurrentWorkspaceRootPath(),
    }));

    const selected = await vscode.window.showQuickPick(quickPickItems, {
      title: "选择目标项目",
      placeHolder: "请选择要执行 GitLab/Git 操作的工作区项目",
      canPickMany: false,
    });

    if (!selected) {
      return null;
    }

    this.setTargetProjectByWorkspaceFolder(selected.folder);
    return selected.folder;
  }

  private async execCommand(command: string): Promise<string> {
    try {
      const { stdout } = await execAsync(command, {
        cwd: this.getCurrentWorkspaceRootPath(),
      });
      return stdout.trim();
    } catch (error) {
      console.error(`Failed to execute command: ${command}`, error);
      throw error;
    }
  }

  /**
   * 获取 Git submodule 列表信息
   */
  private async getSubmodules(): Promise<
    Array<{
      name: string;
      path: string;
      branch: string;
      url: string;
    }>
  > {
    try {
      const { stdout } = await execAsync(
        "git config --file .gitmodules --name-only --get-regexp path",
        { cwd: this.getCurrentWorkspaceRootPath() }
      );

      if (!stdout.trim()) {
        return [];
      }

      const submodules: Array<{
        name: string;
        path: string;
        branch: string;
        url: string;
      }> = [];
      const moduleNames = stdout
        .trim()
        .split("\n")
        .map((line) => line.split(".")[1])
        .filter((name, index, arr) => arr.indexOf(name) === index);

      for (const moduleName of moduleNames) {
        try {
          const { stdout: subPath } = await execAsync(
            `git config --file .gitmodules --get submodule.${moduleName}.path`,
            { cwd: this.getCurrentWorkspaceRootPath() }
          );
          const { stdout: subUrl } = await execAsync(
            `git config --file .gitmodules --get submodule.${moduleName}.url`,
            { cwd: this.getCurrentWorkspaceRootPath() }
          );

          const submodulePath = subPath.trim();
          const fullPath = path.join(
            this.getCurrentWorkspaceRootPath(),
            submodulePath
          );

          let branch = "N/A";
          try {
            const { stdout: subBranch } = await execAsync(
              "git rev-parse --abbrev-ref HEAD",
              { cwd: fullPath }
            );
            branch = subBranch.trim();
          } catch {
            // 如果子模块还没有初始化，分支为 N/A
          }

          submodules.push({
            name: moduleName,
            path: submodulePath,
            branch,
            url: subUrl.trim(),
          });
        } catch (err) {
          console.error(`Failed to get submodule info for ${moduleName}:`, err);
        }
      }

      return submodules;
    } catch (err) {
      // 没有 .gitmodules 文件或其他错误
      return [];
    }
  }

  /**
   * 获取所有工作区项目的信息（名称、分支等），用于多项目 Tab 展示
   * 现在包含 submodule 子项目
   */
  async getAllWorkspaceProjectInfos(): Promise<
    Array<{
      name: string;
      branch: string;
      fsPath: string;
      isActive: boolean;
      isSubmodule?: boolean;
    }>
  > {
    const workspaceFolders = vscode.workspace.workspaceFolders || [];
    const currentPath = this.getCurrentWorkspaceRootPath();
    const results: Array<{
      name: string;
      branch: string;
      fsPath: string;
      isActive: boolean;
      isSubmodule?: boolean;
    }> = [];

    // 添加工作区项目
    for (const folder of workspaceFolders) {
      try {
        const { stdout: branch } = await execAsync(
          "git rev-parse --abbrev-ref HEAD",
          { cwd: folder.uri.fsPath }
        );
        results.push({
          name: folder.name,
          branch: branch.trim(),
          fsPath: folder.uri.fsPath,
          isActive: folder.uri.fsPath === currentPath,
        });
      } catch {
        results.push({
          name: folder.name,
          branch: "N/A",
          fsPath: folder.uri.fsPath,
          isActive: folder.uri.fsPath === currentPath,
        });
      }
    }

    // 添加 submodule（仅在工作区项目为当前项目时）
    try {
      const submodules = await this.getSubmodules();
      for (const submodule of submodules) {
        const submodulePath = path.join(
          this.getCurrentWorkspaceRootPath(),
          submodule.path
        );
        results.push({
          name: submodule.name,
          branch: submodule.branch,
          fsPath: submodulePath,
          isActive: submodulePath === currentPath,
          isSubmodule: true,
        });
      }
    } catch (err) {
      console.error("Failed to get submodules:", err);
    }

    return results;
  }

  async getProjectInfo(): Promise<Project> {
    try {
      const workspaceKey = this.getCurrentWorkspaceKey();
      const cachedProjectInfo = this.projectInfos.get(workspaceKey);
      if (cachedProjectInfo?.id) {
        return cachedProjectInfo;
      }
      const projectName = await this.getCurrentProjectName();
      const res: Project[] = await this.getProjectsInfo(projectName);
      if (res.length === 0) {
        throw new Error("未找到相关项目");
      }
      const findProject = res.find((project) => project.name === projectName || project.path === projectName);
      if (!findProject) {
        throw new Error("未找到相关项目");
      }
      this.projectInfos.set(workspaceKey, findProject);
      return findProject;
    } catch (error) {
      console.error("获取项目信息失败:", error);
      return { name: "未知项目" } as unknown as Project;
    }
  }

  async getCurrentProjectName() {
    // 获取远程仓库URL并提取项目名
    const remoteUrl = await this.execCommand(
      "git config --get remote.origin.url"
    );
    const projectName =
      remoteUrl.split("/").pop()?.replace(".git", "") || "Unknown Project";
    return projectName;
  }

  async getCurrentBranch(): Promise<string> {
    try {
      return await this.execCommand("git rev-parse --abbrev-ref HEAD");
    } catch (error) {
      console.error("获取当前分支失败:", error);
      return "未知分支";
    }
  }

  async hasUnMergedRequest(
    targetBranch: string
  ): Promise<MergeRequestN | null> {
    // 再判断是否有合并请求
    const branch = await this.getCurrentBranch();
    const projectInfo = await this.getProjectInfo();
    const mergeRequests = await this.getMergeRequests(projectInfo?.id);
    const isHasRequest = mergeRequests.find(
      (mr) => mr.source_branch === branch && mr.target_branch === targetBranch
    );
    if (isHasRequest) {
      return isHasRequest;
    }
    return null;
  }

  // 检查分支是否已经合并
  async isMerged(targetBranch: string): Promise<boolean> {
    try {
      const branch = await this.getCurrentBranch();
      if (branch === targetBranch) {
        throw new Error("isMerged: 当前分支和目标分支相同");
      }
      await this.execCommand(
        `git fetch origin ${targetBranch}:${targetBranch}`
      );
      const stdout = await this.execCommand(
        `git branch --merged ${targetBranch}`
      );
      const mergedBranches = stdout
        .split("\n")
        .map((b) => b.trim().replace(/\* /i, ""));

      const isMerged = mergedBranches.includes(branch);

      return isMerged;
    } catch (err: any) {
      if (err.message.includes("Command failed: git fetch")) {
        throw new Error(
          `目标分支${targetBranch}不存在, 或无法访问, 或有本地内容没有上传到远程仓库`
        );
      }
      throw new Error(`检查分支合并状态失败: ${err.message}`);
    }
  }

  async getProjectsInfo(projectName: string): Promise<Project[]> {
    const apiUrl = `${this.baseUrl}/api/v4/projects?search=${projectName}&private_token=${this.token}`;
    const response = await fetch(apiUrl, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
      },
    });

    if (!response.ok) {
      throw new Error(`获取项目信息失败: ${response.statusText}`);
    }

    return (await response.json()) as Project[];
  }

  async getCommitLogLastTitle(): Promise<string> {
    const commitMessage = await this.execCommand("git log -1 --pretty=%B");
    const title = commitMessage.split("\n")[0];
    return title || "";
  }

  async createMergeRequest(
    projectId: number,
    sourceBranch: string,
    targetBranch: string = "dev"
  ): Promise<MergeResponse> {
    // Implementation will be added when you provide the curl endpoints
    const apiUrl = `${this.baseUrl}/api/v4/projects/${projectId}/merge_requests?private_token=${this.token}`;
    const title = await this.getCommitLogLastTitle();
    const response = await fetch(apiUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        source_branch: sourceBranch,
        target_branch: targetBranch,
        title: title || `Merge ${sourceBranch} into ${targetBranch}`,
      }),
    });

    if (!response.ok) {
      throw new Error(`创建合并请求失败: ${response.statusText}`);
    }

    return (await response.json()) as MergeResponse;
  }

  async getMergeRequests(projectId: number): Promise<MergeRequestN[]> {
    // /api/v4/projects/1414/merge_requests
    const apiUrl = `${this.baseUrl}/api/v4/projects/${projectId}/merge_requests?private_token=${this.token}&state=opened`;
    const response = await fetch(apiUrl, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
      },
    });

    if (!response.ok) {
      throw new Error(`获取合并请求失败: ${response.statusText}`);
    }
    const mergeRequests = await response.json();
    return mergeRequests as MergeRequestN[];
  }

  /**
   * 获取已合并到指定目标分支的最近 MR 列表
   * 用于展示 Pipeline ref 对应的已合并 MR
   */
  async getMergedMergeRequests(
    projectId: number,
    targetBranch: string
  ): Promise<MergeRequestN[]> {
    const encodedBranch = encodeURIComponent(targetBranch);
    const apiUrl = `${this.baseUrl}/api/v4/projects/${projectId}/merge_requests?private_token=${this.token}&state=merged&target_branch=${encodedBranch}&per_page=10&order_by=updated_at&sort=desc`;
    const response = await fetch(apiUrl, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
      },
    });

    if (!response.ok) {
      throw new Error(`获取已合并MR失败: ${response.statusText}`);
    }
    return (await response.json()) as MergeRequestN[];
  }

  async acceptMergeRequest(projectId: number, mergeRequestId: number) {
    // Implementation will be added when you provide the curl endpoints
    const apiUrl = `${this.baseUrl}/api/v4/projects/${projectId}/merge_requests/${mergeRequestId}/merge`;
    const response = await fetch(apiUrl, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        "Private-Token": this.token,
      },
    });

    if (!response.ok) {
      throw new Error(`同意合并请求失败: ${response.statusText}`);
    }

    return await response.json();
  }

  async searchBranchs(
    projectId: number,
    branchName: string
  ): Promise<Branch[]> {
    const apiUrl = `${this.baseUrl}/api/v4/projects/${projectId}/repository/branches?private_token=${this.token}&search=${branchName}`;
    const response = await fetch(apiUrl, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
      },
    });

    if (!response.ok) {
      throw new Error(`搜索分支失败: ${response.statusText}`);
    }

    return (await response.json()) as Branch[];
  }

  async applyMergeRequest(targetBranch: string, userForce = false) {
    const currentBranch = await this.getCurrentBranch();
    if (["master", "release", "cn"].includes(currentBranch)) {
      throw new Error("这个分支不能发布到测试环境, 请切换至个人分支");
    }
    if (currentBranch === "unknown") {
      throw new Error("获取当前分支失败");
    }

    if (!userForce) {
      const isApply = await Modal.info(
        `是否将${currentBranch}合并到${targetBranch}?`,
        { modal: true },
        "Confirm"
      );
      if (isApply !== "Confirm") {
        throw new Error("用户取消合并");
      }
    }

    const isMerged = await this.isMerged(targetBranch);
    if (isMerged) {
      throw new Error(
        `当前分支: ${currentBranch} 已经合并到目标分支: ${targetBranch}`
      );
    }

    const projectInfo = await this.getProjectInfo();
    if (!projectInfo.id) {
      throw new Error("获取项目信息失败");
    }

    const sourceBranch = currentBranch;
    const projectId = projectInfo.id;

    const hasUnMergedRequest = await this.hasUnMergedRequest(targetBranch);
    if (hasUnMergedRequest) {
      return {
        projectId,
        mergeRequestResponse: hasUnMergedRequest as MergeResponse,
      };
    }

    const mergeRequestResponse = await this.createMergeRequest(
      projectId,
      sourceBranch,
      targetBranch
    );
    if (!mergeRequestResponse?.iid) {
      throw new Error("创建合并请求失败");
    }
    return { projectId, mergeRequestResponse };
  }

  async publishDevloperEnv({
    mergeCallback,
  }: {
    mergeCallback?: (mergeRequest: MergeResponse) => void;
  } = {}): Promise<MergeResponse> {
    const testBranch = await this.getTestBranch();
    const { projectId, mergeRequestResponse } = await this.applyMergeRequest(
      testBranch
    );
    mergeCallback?.(mergeRequestResponse);
    await this.acceptMergeRequest(projectId, mergeRequestResponse.iid);
    return mergeRequestResponse;
  }

  async findProdBranch(projectId: number) {
    const projectName = await this.getCurrentProjectName();
    const customBranch = this.getBranchFromMapping('com', projectName);
    if (customBranch) {
      return customBranch;
    }

    if (!projectId) {
      return "master";
    }
    const branchs = await this.searchBranchs(projectId, "release");
    const isHasRelease =
      branchs.length > 0 && branchs.some((branch) => branch.name === "release");
    if (isHasRelease) {
      return "release";
    }

    return "master";
  }

  async findCnBranch(projectId: number) {
    const projectName = await this.getCurrentProjectName();
    const customBranch = this.getBranchFromMapping('cn', projectName);
    if (customBranch) {
      return customBranch;
    }

    if (!projectId) {
      return "cn";
    }
    const branchs = await this.searchBranchs(projectId, "master-cn");
    if (branchs.length > 0 && branchs.some((branch) => branch.name === "master-cn")) {
      return "master-cn";
    }

    return "cn";
  }

  async getTestBranch() {
    const workspaceKey = this.getCurrentWorkspaceKey();
    const projectName = await this.getCurrentProjectName();
    const customBranch = this.getBranchFromMapping('test', projectName);
    if (customBranch) {
      this.testBranchNames.set(workspaceKey, customBranch);
      return customBranch;
    }

    const { id: projectId } = await this.getProjectInfo();
    const cachedTestBranch = this.testBranchNames.get(workspaceKey);
    if (cachedTestBranch) {
      return cachedTestBranch;
    }
    let branchs = await this.searchBranchs(projectId, "release");
    const isHasRelease =
      branchs.length > 0 && branchs.some((branch) => branch.name === "release");
    if (isHasRelease) {
      this.testBranchNames.set(workspaceKey, "master");
      return "master";
    }

    this.testBranchNames.set(workspaceKey, "dev");
    return "dev";
  }

  async checkStatusNoCommit() {
    const status = await this.execCommand("git status --porcelain");
    if (status) {
      throw new Error("有未提交的文件, 请先提交, 并推送到远程仓库");
    }
  }

  async getNoCommitFiles() {
    const status = await this.execCommand("git status --porcelain");
    const files = status.split("\n").map((line) => line.trim().split(" ")[1]);
    const noCommitFiles = files.filter(
      (name) => Boolean(name) && name !== "undefined"
    );
    return noCommitFiles;
  }

  async getPipelines(projectId: number, ref?: string): Promise<Pipeline[]> {
    let apiUrl = `${this.baseUrl}/api/v4/projects/${projectId}/pipelines?private_token=${this.token}&per_page=10&sort=desc`;
    if (ref) {
      // URL编码分支名称，处理特殊字符如 '/'
      const encodedRef = encodeURIComponent(ref);
      apiUrl += `&ref=${encodedRef}`;
    }
    
    const response = await fetch(apiUrl, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Pipeline API Error Response:', errorText);
      throw new Error(`获取pipelines失败: ${response.status} ${response.statusText} - ${errorText}`);
    }

    const data = await response.json();
    return data as Pipeline[];
  }

  async getLatestPipeline(projectId: number, ref?: string): Promise<Pipeline | null> {
    try {
      
      // 验证输入参数
      if (!projectId) {
        return null;
      }
      
      if (!this.baseUrl || !this.token) {
        return null;
      }
      
      const pipelines = await this.getPipelines(projectId, ref);
      return pipelines.length > 0 ? pipelines[0] : null;
    } catch (error) {
      console.error('获取最新pipeline失败:', error);
      return null;
    }
  }

  async getTags(projectId: number): Promise<Tag[]> {
    const apiUrl = `${this.baseUrl}/api/v4/projects/${projectId}/repository/tags?private_token=${this.token}&per_page=10&sort=desc`;    
    const response = await fetch(apiUrl, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
      },
    });

    console.log('Tags API Response Status:', response.status);

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Tags API Error Response:', errorText);
      throw new Error(`获取tags失败: ${response.status} ${response.statusText} - ${errorText}`);
    }

    const data = await response.json();
    return data as Tag[];
  }

  async getLatestTag(projectId: number): Promise<Tag | null> {
    try {

      if (!projectId) {
        console.error('Project ID is missing or invalid:', projectId);
        return null;
      }
      
      if (!this.baseUrl || !this.token) {
        console.error('GitLab configuration is missing. BaseURL:', this.baseUrl, 'Token:', this.token ? '[SET]' : '[NOT SET]');
        return null;
      }
      
      const tags = await this.getTags(projectId);
      return tags.length > 0 ? tags[0] : null;
    } catch (error) {
      console.error('获取最新tag失败:', error);
      return null;
    }
  }
}
