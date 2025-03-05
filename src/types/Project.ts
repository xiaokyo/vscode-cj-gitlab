interface Namespace {
  id: number;
  name: string;
  path: string;
  kind: string;
  full_path: string;
  parent_id: number;
}

interface Links {
  self: string;
  issues: string;
  merge_requests: string;
  repo_branches: string;
  labels: string;
  events: string;
  members: string;
}

interface Permissions {
  project_access: any; // 可以根据需要更具体地定义
  group_access: any; // 可以根据需要更具体地定义
}

export interface Project {
  id: number;
  description: string;
  name: string;
  name_with_namespace: string;
  path: string;
  path_with_namespace: string;
  created_at: string; // ISO 8601 格式的日期字符串
  default_branch: string;
  tag_list: string[];
  ssh_url_to_repo: string;
  http_url_to_repo: string;
  web_url: string;
  readme_url: string;
  avatar_url: string | null;
  star_count: number;
  forks_count: number;
  last_activity_at: string; // ISO 8601 格式的日期字符串
  namespace: Namespace;
  _links: Links;
  archived: boolean;
  visibility: string;
  resolve_outdated_diff_discussions: boolean;
  container_registry_enabled: boolean;
  issues_enabled: boolean;
  merge_requests_enabled: boolean;
  wiki_enabled: boolean;
  jobs_enabled: boolean;
  snippets_enabled: boolean;
  shared_runners_enabled: boolean;
  lfs_enabled: boolean;
  creator_id: number;
  import_status: string;
  open_issues_count: number;
  public_jobs: boolean;
  ci_config_path: string | null;
  shared_with_groups: any[]; // 可以根据需要更具体地定义
  only_allow_merge_if_pipeline_succeeds: boolean;
  request_access_enabled: boolean;
  only_allow_merge_if_all_discussions_are_resolved: boolean;
  printing_merge_request_link_enabled: boolean;
  merge_method: string;
  permissions: Permissions;
}