export const feedbackRatings = {
  helpful: "有帮助",
  unhelpful: "没有帮助",
  issue: "问题反馈",
};
export const feedbackCategories = {
  accuracy: "内容不准确",
  incomplete: "内容不完整",
  relevance: "答非所问",
  format: "格式或显示问题",
  other: "其他问题",
};
export const feedbackStatuses = {
  pending: "待处理",
  processing: "处理中",
  resolved: "已处理",
  dismissed: "不予处理",
};
export type FeedbackRating = keyof typeof feedbackRatings;
export type FeedbackStatus = keyof typeof feedbackStatuses;
export type FeedbackCategory = keyof typeof feedbackCategories;
export type FeedbackReceipt = {
  id: string;
  rating: FeedbackRating;
  category: FeedbackCategory;
  description: string;
  hasContext: boolean;
};
export type FeedbackRow = FeedbackReceipt & {
  userName: string;
  username: string;
  departmentName: string;
  modelName: string;
  status: FeedbackStatus;
  createdAt: string;
  updatedAt: string;
};
export type FeedbackDetail = FeedbackRow & {
  context: { question: string; answer: string } | null;
  adminNote: string;
  handledBy: string;
  handledAt: string | null;
};
export type FeedbackList = {
  rows: FeedbackRow[];
  total: number;
  page: number;
  pageSize: number;
};
