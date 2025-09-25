import * as vscode from "vscode";
import { exec } from "child_process";
import { promisify } from "util";
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
  public testBranchName: string = "";
  public projectInfo: Project | null = null;

  constructor() {
    const config = vscode.workspace.getConfiguration("cj-gitlab");
    this.baseUrl = config.get("apiUrl") || "";
    this.token = config.get("token") || "";
  }

  isNotConfig() {
    return !this.baseUrl || !this.token;
  }

  getBaseUrl() {
    return this.baseUrl;
  }

  getToken() {
    return this.token;
  }

  private async execCommand(command: string): Promise<string> {
    try {
      const { stdout } = await execAsync(command, {
        cwd: vscode.workspace.workspaceFolders?.[0].uri.fsPath,
      });
      return stdout.trim();
    } catch (error) {
      console.error(`Failed to execute command: ${command}`, error);
      throw error;
    }
  }

  async getProjectInfo(): Promise<Project> {
    try {
      if (this.projectInfo?.id) {
        return this.projectInfo;
      }
      const projectName = await this.getCurrentProjectName();
      const res: Project[] = await this.getProjectsInfo(projectName);
      if (res.length === 0) {
        throw new Error("未找到相关项目");
      }
      const findProject = res.find((project) => project.name === projectName);
      if (!findProject) {
        throw new Error("未找到相关项目");
      }
      this.projectInfo = findProject;
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
    if (!projectId) {
      return "cn";
    }
    const branchs = await this.searchBranchs(projectId, "master-cn");
    if (branchs.length > 0) {
      return "master-cn";
    }

    return "cn";
  }

  async getTestBranch() {
    const { id: projectId } = await this.getProjectInfo();
    if (this.testBranchName) {
      return this.testBranchName;
    }
    let branchs = await this.searchBranchs(projectId, "release");
    const isHasRelease =
      branchs.length > 0 && branchs.some((branch) => branch.name === "release");
    if (isHasRelease) {
      this.testBranchName = "master";
      return this.testBranchName;
    }

    this.testBranchName = "dev";
    return this.testBranchName;
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
