interface Commit {
  id: string;
  short_id: string;
  title: string;
  created_at: string; // ISO 8601 格式的日期字符串
  parent_ids: string[] | null; // 如果有多个父提交，使用字符串数组
  message: string;
  author_name: string;
  author_email: string;
  authored_date: string; // ISO 8601 格式的日期字符串
  committer_name: string;
  committer_email: string;
  committed_date: string; // ISO 8601 格式的日期字符串
}

export interface Branch {
  name: string;
  commit: Commit;
  merged: boolean;
  protected: boolean;
  developers_can_push: boolean;
  developers_can_merge: boolean;
  can_push: boolean;
  default: boolean;
}