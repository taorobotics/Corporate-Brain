export type CompanyLookup = {
  skills?: boolean;
  knowledge?: "sources" | "browse";
  directories?: { sourceId: string; path: string; search?: string }[];
};
