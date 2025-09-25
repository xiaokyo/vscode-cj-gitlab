export interface Pipeline {
  id: number;
  iid: number;
  project_id: number;
  sha: string;
  ref: string;
  status: 'created' | 'waiting_for_resource' | 'preparing' | 'pending' | 'running' | 'success' | 'failed' | 'canceled' | 'skipped' | 'manual' | 'scheduled';
  source: string;
  created_at: string;
  updated_at: string;
  web_url: string;
  before_sha: string;
  tag: boolean;
  yaml_errors?: string;
  user: {
    id: number;
    username: string;
    name: string;
    state: string;
    avatar_url: string;
    web_url: string;
  };
  started_at?: string;
  finished_at?: string;
  committed_at?: string;
  duration?: number;
  queued_duration?: number;
  coverage?: string;
  detailed_status: {
    icon: string;
    text: string;
    label: string;
    group: string;
    tooltip: string;
    has_details: boolean;
    details_path: string;
    illustration?: any;
    favicon: string;
  };
}