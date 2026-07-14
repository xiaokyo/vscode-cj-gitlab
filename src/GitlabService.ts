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
import { BatchItemResult, BatchTarget, PublishEnv } from "./types/BatchPublish";
import Modal from "./utils/modal";
import { hasUncommitted, parsePorcelainFiles } from "./utils/gitStatus";
import { isCjRemote } from "./utils/isCjRemote";

const execAsync = promisify(exec);

/** 命令 runner：支持 stdin（git commit -F - 需从 stdin 读 message）；出错时 err.stderr 携带 stderr */
type CmdRunner = (
  command: string,
  opts: { cwd: string; input?: string }
) => Promise<{ stdout: string; stderr: string }>;

/** 默认 runner：手动包装 exec 以拿到子进程句柄写 stdin（promisify(exec) 拿不到句柄，无法传 input） */
const defaultRunner: CmdRunner = (command, { cwd, input }) =>
  new Promise((resolve, reject) => {
    const child = exec(command, { cwd }, (err, stdout, stderr) => {
      if (err) {
        (err as any).stderr = stderr;
        return reject(err);
      }
      resolve({ stdout, stderr });
    });
    if (input !== undefined && child.stdin) {
      // 防止子进程提前关闭 stdin 导致 EPIPE 未捕获崩溃扩展宿主
      child.stdin.on("error", () => {});
      child.stdin.end(input);
    }
  });

export class GitlabService {
  private readonly baseUrl: string;
  private readonly token: string;
  public testBranchNames = new Map<string, string>();
  public projectInfos = new Map<string, Project>();
  private projectNames = new Map<string, string>();
  private selectedWorkspaceRootPath: string | null = null;
  // 命令 runner，默认走 defaultRunner；测试可覆写此字段注入替身
  private run: CmdRunner = defaultRunner;

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
      const { stdout } = await this.run(command, {
        cwd: this.getCurrentWorkspaceRootPath(),
      });
      return stdout.trim();
    } catch (error) {
      console.error(`Failed to execute command: ${command}`, error);
      throw error;
    }
  }

  /**
   * 获取 Git submodule 列表信息（从指定工作区读取）
   */
  private async getSubmodulesForWorkspace(
    workspacePath: string
  ): Promise<
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
        { cwd: workspacePath }
      );

      if (!stdout.trim()) {
        return [];
      }

      const moduleNames = stdout
        .trim()
        .split("\n")
        .map((line) => line.split(".")[1])
        .filter((name, index, arr) => arr.indexOf(name) === index);

      // 各 submodule 的 path/url/branch 查询并行，减少串行子进程开销
      const submodules = await Promise.all(
        moduleNames.map(async (moduleName) => {
          try {
            const [{ stdout: subPath }, { stdout: subUrl }] = await Promise.all([
              execAsync(
                `git config --file .gitmodules --get submodule.${moduleName}.path`,
                { cwd: workspacePath }
              ),
              execAsync(
                `git config --file .gitmodules --get submodule.${moduleName}.url`,
                { cwd: workspacePath }
              ),
            ]);

            const submodulePath = subPath.trim();
            const fullPath = path.join(workspacePath, submodulePath);

            let branch = "N/A";
            try {
              const { stdout: subBranch } = await execAsync(
                "git rev-parse --abbrev-ref HEAD",
                { cwd: fullPath }
              );
              branch = subBranch.trim();
            } catch {
              // submodule 未初始化
            }

            return {
              name: moduleName,
              path: submodulePath,
              branch,
              url: subUrl.trim(),
            };
          } catch (err) {
            console.error(`Failed to get submodule info for ${moduleName}:`, err);
            return null;
          }
        })
      );

      return submodules.filter(
        (s): s is { name: string; path: string; branch: string; url: string } =>
          s !== null
      );
    } catch (err) {
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
    type Info = {
      name: string;
      branch: string;
      fsPath: string;
      isActive: boolean;
      isSubmodule?: boolean;
    };

    // 工作区分支查询与 submodule 读取按 folder 并行，避免串行 spawn 进程线性叠加
    const perFolder = await Promise.all(
      workspaceFolders.map(async (folder): Promise<Info[]> => {
        const folderResults: Info[] = [];

        // 非 cj 项目（remote host 不匹配配置的 GitLab）不纳入列表
        try {
          const { stdout: remoteUrl } = await execAsync(
            "git config --get remote.origin.url",
            { cwd: folder.uri.fsPath }
          );
          if (!isCjRemote(remoteUrl.trim(), this.baseUrl)) {
            return folderResults;
          }
        } catch {
          return folderResults;
        }

        try {
          const { stdout: branch } = await execAsync(
            "git rev-parse --abbrev-ref HEAD",
            { cwd: folder.uri.fsPath }
          );
          folderResults.push({
            name: folder.name,
            branch: branch.trim(),
            fsPath: folder.uri.fsPath,
            isActive: folder.uri.fsPath === currentPath,
          });
        } catch {
          folderResults.push({
            name: folder.name,
            branch: "N/A",
            fsPath: folder.uri.fsPath,
            isActive: folder.uri.fsPath === currentPath,
          });
        }

        try {
          const submodules = await this.getSubmodulesForWorkspace(
            folder.uri.fsPath
          );
          for (const submodule of submodules) {
            const submodulePath = path.join(folder.uri.fsPath, submodule.path);
            folderResults.push({
              name: submodule.name,
              branch: submodule.branch,
              fsPath: submodulePath,
              isActive: submodulePath === currentPath,
              isSubmodule: true,
            });
          }
        } catch (err) {
          console.error(`Failed to get submodules for ${folder.name}:`, err);
        }

        return folderResults;
      })
    );

    return perFolder.flat();
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
    // 项目名在同一工作区内基本不变，缓存避免反复 spawn git 子进程
    const workspaceKey = this.getCurrentWorkspaceKey();
    const cached = this.projectNames.get(workspaceKey);
    if (cached) {
      return cached;
    }
    // 获取远程仓库URL并提取项目名
    const remoteUrl = await this.execCommand(
      "git config --get remote.origin.url"
    );
    const projectName =
      remoteUrl.split("/").pop()?.replace(".git", "") || "Unknown Project";
    this.projectNames.set(workspaceKey, projectName);
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

  /**
   * 解析 reflog 的 checkout 记录，返回分支名按最近切换顺序排列（最近在前，去重）
   */
  private async getRecentCheckoutBranches(): Promise<string[]> {
    try {
      // %gs = reflog 主题，形如 "checkout: moving from A to B"，B 为切换目标
      const stdout = await this.execCommand("git reflog --format='%gs'");
      const order: string[] = [];
      const seen = new Set<string>();
      const re = /^checkout: moving from .+ to (.+)$/;
      for (const raw of stdout.split("\n")) {
        const m = raw.trim().replace(/^'|'$/g, "").match(re);
        if (!m) {
          continue;
        }
        const name = m[1].trim();
        if (!name || seen.has(name)) {
          continue;
        }
        seen.add(name);
        order.push(name);
      }
      return order;
    } catch {
      return [];
    }
  }

  /**
   * 获取本地 + 远程分支列表，远程同名已存在本地的去重，过滤 origin/HEAD
   * 排序：当前分支最前 -> 按 reflog 最近切换顺序 -> 其余保持原顺序
   */
  async getLocalAndRemoteBranches(): Promise<
    Array<{ name: string; isRemote: boolean; isCurrent: boolean }>
  > {
    const current = await this.getCurrentBranch();
    const stdout = await this.execCommand(
      "git branch -a --format='%(refname:short)'"
    );
    const seen = new Set<string>();
    const result: Array<{
      name: string;
      isRemote: boolean;
      isCurrent: boolean;
    }> = [];

    for (const raw of stdout.split("\n")) {
      const line = raw.trim().replace(/^'|'$/g, "");
      if (!line || line.includes("HEAD")) {
        continue;
      }
      const isRemote = line.startsWith("origin/");
      const name = isRemote ? line.slice("origin/".length) : line;
      if (!name || seen.has(name)) {
        continue;
      }
      seen.add(name);
      result.push({ name, isRemote, isCurrent: name === current });
    }

    // 按 reflog 最近切换顺序排序：当前分支恒最前；命中 reflog 的按其顺序；其余保持原相对顺序
    const recent = await this.getRecentCheckoutBranches();
    const rank = new Map<string, number>();
    recent.forEach((name, i) => rank.set(name, i));
    return result
      .map((b, idx) => ({ b, idx }))
      .sort((a, b) => {
        if (a.b.isCurrent !== b.b.isCurrent) {
          return a.b.isCurrent ? -1 : 1;
        }
        const ra = rank.has(a.b.name) ? rank.get(a.b.name)! : Infinity;
        const rb = rank.has(b.b.name) ? rank.get(b.b.name)! : Infinity;
        return ra !== rb ? ra - rb : a.idx - b.idx;
      })
      .map((x) => x.b);
  }

  /**
   * 切换分支：切换前拦截未提交改动；远程分支自动建本地跟踪分支
   */
  async checkoutBranch(branch: string, isRemote: boolean): Promise<void> {
    await this.checkStatusNoCommit();
    if (isRemote) {
      try {
        await this.execCommand(`git checkout ${branch}`);
        return;
      } catch {
        await this.execCommand(`git checkout -b ${branch} origin/${branch}`);
        return;
      }
    }
    await this.execCommand(`git checkout ${branch}`);
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
    if (currentBranch === "未知分支") {
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
    // userForce=true 跳过合并确认弹窗（测试环境无需二次确认）
    const { projectId, mergeRequestResponse } = await this.applyMergeRequest(
      testBranch,
      true
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

  /** 非阻塞脏检查：出错按干净处理，不影响发布流程 */
  async hasUncommitted(): Promise<boolean> {
    try {
      return hasUncommitted(await this.execCommand("git status --porcelain"));
    } catch {
      return false;
    }
  }

  /**
   * 一键提交并推送：add -A → commit(message 经 stdin，防注入) → push(无 upstream 自动降级)
   * 干净工作区抛「无待提交改动」，由 View 层转友好提示
   */
  async commitAndPush(message: string): Promise<void> {
    if (!message.trim()) {
      throw new Error("commit message 不能为空");
    }
    const cwd = this.getCurrentWorkspaceRootPath();
    const status = await this.run("git status --porcelain", { cwd });
    if (!hasUncommitted(status.stdout)) {
      throw new Error("无待提交改动");
    }
    await this.run("git add -A", { cwd });

    // add -A 后确认确有暂存内容（porcelain 脏但 add 无果，如 dirty submodule 指针）
    let staged = false;
    try {
      await this.run("git diff --cached --quiet", { cwd });
    } catch (err: any) {
      if (err?.code !== 1) {
        throw err; // exit≥2 是真错误，非“有暂存差异”
      }
      staged = true; // exit 1 = 有暂存差异
    }
    if (!staged) {
      throw new Error("无待提交改动");
    }

    await this.run("git commit -F -", { cwd, input: message });

    // 先探测 upstream（exit code 判定，不依赖本地化文案）；无则带 --set-upstream 推
    if (await this.hasUpstream(cwd)) {
      await this.run("git push", { cwd });
      return;
    }
    // 分支名对同一 cwd 现取，避免异步期间工作区切换取到别的仓库分支
    const branch = (
      await this.run("git rev-parse --abbrev-ref HEAD", { cwd })
    ).stdout.trim();
    if (!branch || branch === "HEAD") {
      throw new Error("无法确定当前分支，无法设置 upstream");
    }
    await this.run(`git push --set-upstream origin ${branch}`, { cwd });
  }

  /** 当前分支是否已配置 upstream；@{u} 解析成功即有（与 git 语言无关） */
  private async hasUpstream(cwd: string): Promise<boolean> {
    try {
      await this.run("git rev-parse --abbrev-ref --symbolic-full-name @{u}", {
        cwd,
      });
      return true;
    } catch {
      return false;
    }
  }

  async getNoCommitFiles() {
    const status = await this.execCommand("git status --porcelain");
    return parsePorcelainFiles(status);
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

  /**
   * 重跑 pipeline：仅重跑失败/取消的 job，复用已成功阶段
   * 参照 acceptMergeRequest 的 Private-Token 写法
   */
  async retryPipeline(
    projectId: number,
    pipelineId: number
  ): Promise<Pipeline> {
    const apiUrl = `${this.baseUrl}/api/v4/projects/${projectId}/pipelines/${pipelineId}/retry`;
    const response = await fetch(apiUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Private-Token": this.token,
      },
    });

    if (!response.ok) {
      throw new Error(`重跑pipeline失败: ${response.statusText}`);
    }

    return (await response.json()) as Pipeline;
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

  /**
   * 拼装合并请求复制文案（项目名/commit/环境/链接）
   * 注意：原文案逻辑在 CJGitlabView.copyLink，下沉至此供单项目与批量合并复用
   * 需求来源：6.11调整 第1次提交 — cn/com 需复制 MR 信息
   */
  async buildMergeInfo(env: PublishEnv, webUrl: string): Promise<string> {
    const projectInfo = await this.getProjectInfo();
    const envMap: Record<PublishEnv, string> = {
      test: "测试",
      cn: "线上(CN)",
      com: "线上(COM)",
    };
    const commitLastLog = await this.getCommitLogLastTitle();
    return `项目名称：${projectInfo.name}\ncommit信息: ${commitLastLog}\n合并环境: ${envMap[env]}\n链接: ${webUrl}`;
  }

  /**
   * 单环境合并：test 自动 accept，cn/com 仅创建 MR
   * 复用 publishDevloperEnv / applyMergeRequest，不重写合并逻辑
   */
  private async publishEnv(env: PublishEnv) {
    if (env === "test") {
      return this.publishDevloperEnv();
    }
    const { id } = await this.getProjectInfo();
    const branch =
      env === "cn" ? await this.findCnBranch(id) : await this.findProdBranch(id);
    const { mergeRequestResponse } = await this.applyMergeRequest(branch, true);
    return mergeRequestResponse;
  }

  /**
   * 一键批量合并：对一组项目 × 一组环境循环执行
   * 单项目/单环境失败不中断整体，跳过并记录，全部跑完返回汇总明细
   * 需求来源：6.11调整 第1次提交
   */
  async batchPublish(
    targets: BatchTarget[],
    envs: PublishEnv[],
    onProgress?: (done: number, total: number, label: string) => void
  ): Promise<BatchItemResult[]> {
    const results: BatchItemResult[] = [];
    const total = targets.length * envs.length;
    let done = 0;

    for (const target of targets) {
      this.setTargetProjectByWorkspaceFolder({
        uri: vscode.Uri.file(target.fsPath),
        name: target.name,
        index: -1,
      } as vscode.WorkspaceFolder);

      // 非阻塞提示：脏工作区仅标注，合并照常进行
      const dirty = await this.hasUncommitted();

      for (const env of envs) {
        onProgress?.(done, total, `${target.name} · ${env.toUpperCase()}`);
        try {
          const mr = await this.publishEnv(env);
          const item: BatchItemResult = {
            projectName: target.name,
            fsPath: target.fsPath,
            env,
            status: "success",
            message: env === "test" ? "已自动合并" : "已创建合并请求",
            webUrl: mr.web_url,
            warning: dirty ? "有未提交改动，未包含在本次合并" : undefined,
          };
          if (env !== "test") {
            item.mergeInfo = await this.buildMergeInfo(env, mr.web_url);
          }
          results.push(item);
        } catch (err: any) {
          const message = err?.message || "未知错误";
          const skipped = message.includes("已经合并");
          results.push({
            projectName: target.name,
            fsPath: target.fsPath,
            env,
            status: skipped ? "skipped" : "failed",
            message,
          });
        }
        done++;
      }
    }

    onProgress?.(done, total, "完成");
    return results;
  }
}
