export type PublishEnv = "test" | "cn" | "com";

export type BatchItemStatus = "success" | "skipped" | "failed";

export interface BatchItemResult {
  projectName: string;
  fsPath: string;
  env: PublishEnv;
  status: BatchItemStatus;
  message: string;
  mergeInfo?: string;
  webUrl?: string;
  /** 有未提交改动时的非阻塞提示，合并照常进行 */
  warning?: string;
}

export interface BatchTarget {
  fsPath: string;
  name: string;
}
