interface User {
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

export interface MergeRequestN {
  id: number;
  iid: number;
  project_id: number;
  title: string;
  description: string | null;
  state: string;
  created_at: string;
  updated_at: string;
  merged_by: User | null;
  merged_at: string | null;
  closed_by: User | null;
  closed_at: string | null;
  target_branch: string;
  source_branch: string;
  upvotes: number;
  downvotes: number;
  author: User;
  assignee: User | null;
  source_project_id: number;
  target_project_id: number;
  labels: string[];
  work_in_progress: boolean;
  milestone: string | null;
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
}