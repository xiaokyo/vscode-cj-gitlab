import * as vscode from "vscode";
import { exec } from "child_process";
import { promisify } from "util";
import { Project } from "./types/Project";
import { MergeResponse } from "./types/MergeRequest";
import { Branch } from "./types/Branch";

const execAsync = promisify(exec);

export class GitlabService {
  private readonly baseUrl: string;
  private readonly token: string;
  private testBranchName: string = "dev";

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
      // 获取远程仓库URL并提取项目名
      const remoteUrl = await this.execCommand(
        "git config --get remote.origin.url"
      );
      const projectName =
        remoteUrl.split("/").pop()?.replace(".git", "") || "Unknown Project";
      const res: Project[] = await this.getProjectsInfo(projectName);
      if (res.length === 0) {
        throw new Error("No projects found for the given name.");
      }
      const findProject = res.find((project) => project.name === projectName);
      if (!findProject) {
        throw new Error("No projects found for the given name.");
      }
      return findProject;
    } catch (error) {
      console.error("Failed to get project info:", error);
      return { name: "Unknown Project" } as unknown as Project;
    }
  }

  async getCurrentBranch(): Promise<string> {
    try {
      return await this.execCommand("git rev-parse --abbrev-ref HEAD");
    } catch (error) {
      console.error("Failed to get current branch:", error);
      return "unknown";
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
      throw new Error(`Failed to get projects info: ${response.statusText}`);
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
      throw new Error(`Failed to create merge request: ${response.statusText}`);
    }

    return (await response.json()) as MergeResponse;
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
      throw new Error(`Failed to accept merge request: ${response.statusText}`);
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
      throw new Error(`Failed to search branches: ${response.statusText}`);
    }

    return (await response.json()) as Branch[];
  }

  async applyMergeRequest(targetBranch: string) {
    const currentBranch = await this.getCurrentBranch();
    if (["master", "release", "cn"].includes(currentBranch)) {
      throw new Error("这个分支不能发布到测试环境, 请切换至个人分支");
    }
    if (currentBranch === "unknown") {
      throw new Error("Failed to get current branch");
    }

    const projectInfo = await this.getProjectInfo();
    if (!projectInfo.id) {
      throw new Error("Failed to get project info");
    }
    const sourceBranch = currentBranch;
    // const targetBranch = this.testBranchName;
    const projectId = projectInfo.id;

    const mergeRequestResponse = await this.createMergeRequest(
      projectId,
      sourceBranch,
      targetBranch
    );
    if (!mergeRequestResponse?.iid) {
      throw new Error("Failed to create merge request.");
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
    if (branchs.length > 0) {
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
    if (branchs.length > 0) {
      this.testBranchName = "master";
      return "master";
    }

    branchs = await this.searchBranchs(projectId, "master-cn");
    if (branchs.length > 0) {
      this.testBranchName = "master-cn";
      return "master-cn";
    }

    this.testBranchName = "dev";
    return "dev";
  }
}
