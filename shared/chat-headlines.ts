export const CHAT_HEADLINES = [
  "今天想完成什么？",
  "有什么需要我处理？",
  "这次从哪里开始？",
  "现在想做些什么？",
  "今天有什么新想法？",
  "有什么问题想解决？",
  "想先聊聊什么？",
  "想把哪个想法做出来？",
  "接下来有什么安排？",
  "准备好开始了吗？",
] as const;

export function pickChatHeadline(
  previous?: string | null,
  random = Math.random,
) {
  const choices = CHAT_HEADLINES.filter((text) => text !== previous);
  return choices[Math.floor(random() * choices.length)];
}
