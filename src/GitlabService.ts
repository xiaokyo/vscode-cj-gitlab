import * as vscode from "vscode";
import { exec } from "child_process";
import { promisify } from "util";
import { Project } from "./types/Project";
import { MergeResponse } from "./types/MergeRequest";
import { Branch } from "./types/Branch";
import { MergeRequestN } from "./types/mergeRequestN";

const execAsync = promisify(exec);

export class GitlabService {
  private readonly baseUrl: string;
  private readonly token: string;
  private testBranchName: string = "dev";
  public projectInfo: Project | null = null;

  constructor() {
    const config = vscode.workspace.getConfiguration("cj-gitlab");
    this.baseUrl = config.get("apiUrl") || "";
    this.token = config.get("token") || "";
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
      if (isMerged === false) {
        // 再判断是否有合并请求
        const projectInfo = await this.getProjectInfo();
        const mergeRequests = await this.getMergeRequests(projectInfo?.id);
        const isHasRequest = mergeRequests.find(
          (mr) =>
            mr.source_branch === branch && mr.target_branch === targetBranch
        );
        if (isHasRequest) {
          setTimeout(() => {
            vscode.env.openExternal(vscode.Uri.parse(isHasRequest.web_url));
          }, 1000);
          throw new Error(`当前分支有未合并的请求`);
        }
      }

      return isMerged;
    } catch (err: any) {
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

  async createMergeRequest(
    projectId: number,
    sourceBranch: string,
    targetBranch: string = "dev"
  ): Promise<MergeResponse> {
    // Implementation will be added when you provide the curl endpoints
    const apiUrl = `${this.baseUrl}/api/v4/projects/${projectId}/merge_requests?private_token=${this.token}`;
    const commitMessage = await this.execCommand("git log -1 --pretty=%B");
    const title = commitMessage.split("\n")[0];
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

  async applyMergeRequest(targetBranch: string) {
    const currentBranch = await this.getCurrentBranch();
    if (["master", "release", "cn"].includes(currentBranch)) {
      throw new Error("这个分支不能发布到测试环境, 请切换至个人分支");
    }
    if (currentBranch === "unknown") {
      throw new Error("获取当前分支失败");
    }

    const isApply = await vscode.window.showQuickPick(["yes", "no"], {
      placeHolder: `是否将${currentBranch}合并到${targetBranch}?`,
    });
    if (isApply !== "yes") {
      throw new Error("用户取消合并");
    }

    const isMerged = await this.isMerged(targetBranch);
    if (isMerged) {
      throw new Error(
        `当前分支: ${currentBranch}已经合并到目标分支: ${targetBranch}`
      );
    }

    const projectInfo = await this.getProjectInfo();
    if (!projectInfo.id) {
      throw new Error("获取项目信息失败");
    }
    const sourceBranch = currentBranch;
    const projectId = projectInfo.id;

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
    const { projectId, mergeRequestResponse } = await this.applyMergeRequest(
      this.testBranchName
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

  async findTestBranch(projectId: number) {
    if (!projectId) {
      return "dev";
    }
    let branchs = await this.searchBranchs(projectId, "release");
    const isHasRelease =
      branchs.length > 0 && branchs.some((branch) => branch.name === "release");
    if (isHasRelease) {
      this.testBranchName = "master";
      return "master";
    }

    this.testBranchName = "dev";
    return "dev";
  }

  async checkStatusNoCommit() {
    const status = await this.execCommand("git status --porcelain");
    if (status) {
      throw new Error("有未提交的文件, 请先提交, 并推送到远程仓库");
    }
  }
}
