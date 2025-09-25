export interface Tag {
  name: string;
  message: string;
  target: string;
  commit: {
    id: string;
    short_id: string;
    title: string;
    author_name: string;
    author_email: string;
    authored_date: string;
    committer_name: string;
    committer_email: string;
    committed_date: string;
    created_at: string;
    message: string;
    web_url: string;
  };
  release?: {
    tag_name: string;
    description: string;
  };
  protected: boolean;
}