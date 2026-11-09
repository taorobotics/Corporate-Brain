export type NasSource = {
  id: string;
  name: string;
  departmentIds: string[];
  enabled: boolean;
  revision: number;
  lastChecked: string | null;
  status: "untested" | "connected" | "error";
  statusMessage: string;
};
export type NasAdminSource = NasSource & {
  host: string;
  share: string;
  basePath: string;
  username: string;
  domain: string;
  hasPassword: boolean;
};
export type NasEntry = {
  name: string;
  directory: boolean;
  blocked: boolean;
  bytes: number;
  modified: string | null;
};
export type NasListing = {
  path: string;
  entries: NasEntry[];
  truncated: boolean;
};
export type NasDocument = {
  path: string;
  name: string;
  content: string;
  summary: string;
  warnings: string[];
  offset: number;
  nextOffset: number | null;
  totalCharacters: number;
  bytes: number;
  modified: string | null;
  sha256: string;
  readable: boolean;
};
export const NAS_DOCUMENT_EXTENSIONS =
  /\.(?:docx?|pdf|xlsx|pptx|txt|md|csv|json|log|srt|vtt|js|ts|py|html|css)$/i;
