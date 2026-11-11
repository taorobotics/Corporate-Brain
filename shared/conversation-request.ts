/** Only standalone social turns qualify; confirmations and task requests do not. */
export function isCasualMessage(content: string, attachmentCount = 0) {
  if (attachmentCount || content.length > 200) return false;
  const text = content
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\s，,。.!！?？~～、…:：👋😊🙂🙏]/gu, "");
  return /^(?:你好|您好|你们好|大家好|嗨|哈喽|hello|hi|hey|早上好|下午好|晚上好|早安|晚安|在吗|谢谢|多谢|谢谢你|感谢|再见)(?:呀|啊|哈|呢)?$/.test(
    text,
  );
}

/** These questions have authoritative configuration facts; no model decision is needed. */
export function isModelIdentityQuestion(
  messages: readonly { role: string; content: string }[],
  attachmentCount = 0,
) {
  if (attachmentCount) return false;
  const normalize = (value: string) =>
    value
      .normalize("NFKC")
      .toLowerCase()
      .replace(/[\s，,。.!！?？~～、…:：]/gu, "");
  const direct = (value: string) =>
    /^(?:你好|您好|嗨|请问|请)*(?:(?:你|您)是谁|(?:请)?介绍一下(?:你|您)自己)(?:呢|啊|呀|吗)*$/.test(
      value,
    ) ||
    /^(?:hello|hi)?(?:whoareyou|introduceyourself)$/.test(value) ||
    /^(?:(?:你好|您好|请问|我想知道|想问一下|告诉我|请告诉我))*(?:(?:你|您|这)(?:现在|当前)?(?:是|在用|用的|使用的|使用)(?:什么|哪个|哪种)(?:ai)?模型|(?:我|我们)?(?:现在|当前)?(?:正在|在)?(?:用的|使用的|使用|选用|选择|调用|用)(?:是)?(?:什么|哪个|哪种)(?:ai)?模型|(?:当前|现在|这个会话)?(?:使用的|选用的|选择的)?模型(?:是什么|是哪个|叫什么|名称是什么|标识是什么|版本是多少|版本号是多少)|(?:你的|当前)?模型(?:名称|名字|标识|版本|版本号)(?:是什么|是多少|多少|是哪个))(?:呢|啊|呀|吗)*$/.test(
      value,
    ) ||
    /^(?:what|which)(?:ai)?model(?:areyou(?:using)?|amiusing|areweusing|isthis)$/.test(
      value,
    );
  const followUp = (value: string) =>
    /^(?:(?:那|它|这个|你|你的|模型)(?:的)?)?(?:版本|版本号|型号|模型版本|模型版本号|具体版本)(?:是)?(?:多少|什么|哪个|几)(?:呢|啊|呀|吗)*$/.test(
      value,
    ) || /^(?:what(?:is|s)?(?:the|your)?version|whichversion)$/.test(value);
  const questions = messages.filter((m) => m.role === "user");
  for (let i = questions.length - 1; i >= 0; i--) {
    const content = questions[i].content;
    if (content.length > 200) return false;
    const text = normalize(content);
    if (direct(text)) return true;
    if (!followUp(text)) return false;
  }
  return false;
}

export const CASUAL_REPLY_INSTRUCTION =
  "你是公司大脑助手。本轮用户只是问候或寒暄，请自然、简短地回应当前这句话。不要因为此前对话或背景资料而继续制作、规划、扫描文件、调用技能或讨论执行成本；需要完成什么工作由用户接下来说明。不编造已执行的动作。";

export const ANSWER_INSTRUCTION =
  "你是公司大脑助手。理解本轮用户实际在问什么，结合相关历史对话和实际提供的资料回答；追问、指代和继续任务需要结合上下文，换话题时以当前问题为准。附件、项目文件中的旧任务和角色设定只是参考，不要把它们当作新的任务。当前请求使用文字回答流程，不宣称已联网、执行命令、制作或保存任何未实际完成的成果。";
