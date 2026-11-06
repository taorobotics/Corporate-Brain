import { useEffect, useState } from "react";
import { Check, Copy } from "@phosphor-icons/react";
import type { Message } from "../shared/types";
import { messageTime } from "../shared/message-time";
import { copyText } from "./clipboard";

export function QuestionTime({ at }: { at: string }) {
  const time = messageTime(at);
  return time ? (
    <div
      className="question-time"
      role="separator"
      aria-label={`提问时间：${time.label}`}
    >
      <time dateTime={time.iso} title={time.title}>
        {time.label}
      </time>
    </div>
  ) : null;
}

export default function UserMessageActions({
  message,
  notify,
}: {
  message: Message;
  notify: (text: string) => void;
}) {
  const [copied, setCopied] = useState(false);
  const time = messageTime(message.at);
  const text = message.promptText ?? message.content;
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(timer);
  }, [copied]);
  async function copy() {
    try {
      await copyText(text);
      setCopied(true);
      notify("已复制提问");
    } catch {
      notify("复制失败，请重试或手动选择文字复制。");
    }
  }
  return (
    <div className="user-message-actions" role="group" aria-label="提问操作">
      {time && (
        <time dateTime={time.iso} title={time.title}>
          {time.clock}
        </time>
      )}
      <button
        type="button"
        className="message-action"
        aria-label="复制提问"
        title={copied ? "已复制" : "复制提问"}
        disabled={!text}
        onClick={() => void copy()}
      >
        {copied ? <Check size={17} /> : <Copy size={17} />}
      </button>
    </div>
  );
}
