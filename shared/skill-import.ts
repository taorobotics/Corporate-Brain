export type ImportedSkillSource = {
  kind: "github" | "zip" | "url";
  label: string;
  url?: string;
  commit?: string;
  digest: string;
  entry: string;
  fileCount: number;
  bytes: number;
  license: string;
  licenseFiles: string[];
  hasScripts: boolean;
  notes: string[];
};

export type SkillImportCandidate = {
  entry: string;
  name: string;
  description: string;
  version: string;
  instructions: string;
};

export type SkillImportPreview = {
  id: string;
  expiresAt: string;
  source: Omit<ImportedSkillSource, "entry">;
  candidates: SkillImportCandidate[];
  files: string[];
};
