interface Author {
  id: number;
  name: string;
  username: string;
  state: string;
  avatar_url: string;
  web_url: string;
}

interface TimeStats {
  time_estimate: number;
  total_time_spent: number;
  human_time_estimate: string | null;
  human_total_time_spent: string | null;
}

interface DiffRefs {
  base_sha: string;
  head_sha: string;
  start_sha: string;
}

export interface MergeResponse {
  id: number;
  iid: number;
  project_id: number;
  title: string;
  description: string | null;
  state: string;
  created_at: string; // ISO 8601 格式的日期字符串
  updated_at: string; // ISO 8601 格式的日期字符串
  merged_by: any | null; // 可以根据需要更具体地定义
  merged_at: string | null; // ISO 8601 格式的日期字符串
  closed_by: any | null; // 可以根据需要更具体地定义
  closed_at: string | null; // ISO 8601 格式的日期字符串
  target_branch: string;
  source_branch: string;
  upvotes: number;
  downvotes: number;
  author: Author;
  assignee: any | null; // 可以根据需要更具体地定义
  source_project_id: number;
  target_project_id: number;
  labels: string[];
  work_in_progress: boolean;
  milestone: any | null; // 可以根据需要更具体地定义
  merge_when_pipeline_succeeds: boolean;
  merge_status: string;
  sha: string;
  merge_commit_sha: string | null;
  user_notes_count: number;
  discussion_locked: boolean | null;
  should_remove_source_branch: boolean | null;
  force_remove_source_branch: boolean | null;
  web_url: string;
  time_stats: TimeStats;
  squash: boolean;
  subscribed: boolean;
  changes_count: any | null; // 可以根据需要更具体地定义
  latest_build_started_at: string | null; // ISO 8601 格式的日期字符串
  latest_build_finished_at: string | null; // ISO 8601 格式的日期字符串
  first_deployed_to_production_at: string | null; // ISO 8601 格式的日期字符串
  pipeline: any | null; // 可以根据需要更具体地定义
  diff_refs: DiffRefs;
  merge_error: any | null; // 可以根据需要更具体地定义
}