import { useEffect, useState } from "react";
import { DSH_FISH_PATH } from "./vendor/dsh-chat-mark";
import "./chat-loading.css";

export type PendingReply = {
  conversationId: string;
  phase: "preparing" | "waiting";
  kind: "chat" | "image";
  modelName: string;
  startedAt: number;
};

/** A live request indicator, scoped to its conversation; never simulated steps. */
export default function ChatLoading({ request }: { request: PendingReply }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [request.startedAt]);
  const seconds = Math.max(0, Math.floor((now - request.startedAt) / 1000));
  const label =
    request.phase === "preparing"
      ? "正在准备上下文"
      : request.kind === "image"
        ? "正在生成图片"
        : "正在思考";
  return (
    <div
      className="message assistant chat-loading"
      data-phase={request.phase}
      aria-busy="true"
    >
      <span className="message-avatar chat-loading-avatar" aria-hidden="true">
        <svg
          viewBox="0 0 23.16 17.04"
          width="30"
          height="23"
          fill="currentColor"
        >
          <path d={DSH_FISH_PATH} />
        </svg>
      </span>
      <div className="message-body chat-loading-body">
        <span className="chat-loading-model">{request.modelName}</span>
        <div className="chat-loading-status">
          <svg
            className="dsh-loading-spinner"
            viewBox="0 0 24 24"
            width="16"
            height="16"
            aria-hidden="true"
          >
            <g className="dsh-loading-spinner-motion">
              <circle
                className="dsh-loading-spinner-track"
                cx="12"
                cy="12"
                r="9"
              />
              <circle
                className="dsh-loading-spinner-arc"
                cx="12"
                cy="12"
                r="9"
              />
            </g>
          </svg>
          <span className="dsh-loading-text" role="status" aria-live="polite">
            <span>{label}</span>
            <span className="dsh-loading-decoration" aria-hidden="true">
              <span className="dsh-loading-sweep">
                <span className="dsh-loading-highlight">{label}</span>
              </span>
            </span>
          </span>
          <span className="chat-loading-elapsed" aria-hidden="true">
            {seconds} 秒
          </span>
        </div>
      </div>
    </div>
  );
}
