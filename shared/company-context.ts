export type CompanyLookup = {
  skills?: boolean;
  knowledge?: "sources" | "browse" | "read";
  directories?: {
    sourceId: string;
    path: string;
    search?: string;
    recursive?: boolean;
    directoryOnly?: boolean;
  }[];
  documents?: {
    sourceId: string;
    path: string;
    offset?: number;
    nextOffset?: number | null;
  }[];
  edit?: boolean;
};
