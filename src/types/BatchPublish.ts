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
}

export interface BatchTarget {
  fsPath: string;
  name: string;
}
