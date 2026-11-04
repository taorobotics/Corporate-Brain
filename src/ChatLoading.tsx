import { useEffect, useId, useState } from "react";
import {
  CaretDown,
  MagnifyingGlass,
  Wrench,
  Check,
  WarningCircle,
} from "@phosphor-icons/react";
import type { ChatTrace, TraceItem } from "../shared/chat-progress";
import GrokBall from "./GrokBall";
import MessageContent from "./MessageContent";
import { useChatScroll } from "./useChatScroll";
import "./chat-loading.css";

export type PendingReply = {
  conversationId: string;
  phase: "preparing" | "waiting";
  kind: "chat" | "image";
  modelName: string;
  startedAt: number;
  items: TraceItem[];
  content: string;
};

export function ThinkingProcess({
  items,
  status,
  elapsed,
  label,
  answerStarted = false,
}: {
  items: TraceItem[];
  status: ChatTrace["status"] | "running";
  elapsed: number;
  label?: string;
  answerStarted?: boolean;
}) {
  const [open, setOpen] = useState(status === "running" && !answerStarted);
  const id = useId();
  const { containerRef, contentRef, showLatest, jumpToLatest } = useChatScroll(
    open ? id : null,
    24,
  );
  // Collapse only at the answer handoff, so reopening during later chunks is respected.
  useEffect(() => {
    if (answerStarted) setOpen(false);
  }, [answerStarted]);
  const hasReasoning = items.some(
    (item) => item.type === "reasoning" && item.text,
  );
  const activeTool = items.findLast(
    (item) => item.type === "tool" && item.status === "running",
  );
  const title =
    label ??
    (status === "running"
      ? activeTool
        ? "正在使用工具"
        : hasReasoning
          ? "正在思考"
          : "正在等待模型响应"
      : status === "stopped"
        ? "已停止"
        : status === "error"
          ? "响应中断"
          : hasReasoning
            ? "思考完成"
            : "响应完成");
  return (
    <section className="thinking-process" data-status={status}>
      <div className="thinking-heading">
        <span
          className={
            status === "running" ? "thinking-title is-active" : "thinking-title"
          }
        >
          {title}
        </span>
        <span className="thinking-elapsed" aria-live="off">
          {elapsed} 秒
        </span>
      </div>
      <button
        className="thinking-toggle"
        type="button"
        aria-expanded={open}
        aria-controls={id}
        aria-label={open ? "收起处理过程" : "展开处理过程"}
        onClick={() => setOpen(!open)}
      >
        <CaretDown size={15} className={open ? "is-open" : ""} />
        <span>处理过程</span>
      </button>
      <div id={id} className="thinking-details" hidden={!open}>
        <div
          className="thinking-scroll"
          data-chat-scroll="process"
          ref={containerRef}
          role="region"
          aria-label="处理过程内容"
          aria-live="off"
          tabIndex={0}
        >
          <div
            className="thinking-entries"
            ref={contentRef}
            data-streaming={status === "running" && !answerStarted}
          >
            {items.map((item) =>
              item.type === "reasoning" ? (
                item.text && (
                  <div className="thinking-entry reasoning-entry" key={item.id}>
                    <div className="reasoning-text">{item.text}</div>
                  </div>
                )
              ) : (
                <div
                  className="thinking-entry tool-entry"
                  key={item.id}
                  data-tool-status={item.status}
                >
                  <span className="thinking-tool-icon">
                    {/search|web/i.test(item.name) ? (
                      <MagnifyingGlass size={17} />
                    ) : (
                      <Wrench size={17} />
                    )}
                  </span>
                  <div>
                    <div className="thinking-tool-title">
                      <span>
                        {item.sources?.length
                          ? `找到 ${item.sources.length} 个来源`
                          : toolLabel(item.name)}
                      </span>
                      <span className="thinking-tool-state">
                        {item.status === "running" ? (
                          "进行中"
                        ) : item.status === "done" ? (
                          <Check size={14} aria-label="完成" />
                        ) : item.status === "error" ? (
                          <WarningCircle size={14} aria-label="失败" />
                        ) : (
                          "已停止"
                        )}
                      </span>
                    </div>
                    {item.detail && (
                      <details className="thinking-tool-detail">
                        <summary>查看内容</summary>
                        <p>{item.detail}</p>
                      </details>
                    )}
                    {!!item.sources?.length && (
                      <div className="thinking-sources">
                        {item.sources.map((source) => (
                          <a
                            key={source.url}
                            href={source.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            title={source.url}
                          >
                            {source.title || new URL(source.url).hostname}
                          </a>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              ),
            )}
            {!hasReasoning && (
              <p className="thinking-note">
                {status === "running"
                  ? "等待模型返回内容；思考文字会在模型提供时显示。"
                  : "此轮模型未提供可显示的思考内容。"}
              </p>
            )}
          </div>
        </div>
        {showLatest && (
          <button
            className="thinking-follow"
            type="button"
            onClick={jumpToLatest}
          >
            ↓ 跟随最新内容
          </button>
        )}
      </div>
    </section>
  );
}

function toolLabel(name: string) {
  if (/search/i.test(name)) return "搜索网页";
  if (/fetch|browse/i.test(name)) return "读取网页";
  if (/read.*file|file.*read/i.test(name)) return "读取文件";
  return `工具 · ${name}`;
}

export default function ChatLoading({
  request,
  stop,
}: {
  request: PendingReply;
  stop: () => void;
}) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [request.startedAt]);
  const seconds = Math.max(0, Math.floor((now - request.startedAt) / 1000));
  return (
    <div
      className="message assistant chat-loading"
      data-phase={request.phase}
      aria-busy="true"
    >
      <span className="message-avatar chat-loading-avatar">
        <GrokBall emotion="16" size={40} />
      </span>
      <div className="message-body chat-loading-body">
        <span className="chat-loading-model">{request.modelName}</span>
        <ThinkingProcess
          items={request.items}
          status="running"
          elapsed={seconds}
          answerStarted={!!request.content.trim()}
          label={
            request.phase === "preparing"
              ? "正在准备上下文"
              : request.kind === "image"
                ? "正在生成图片"
                : request.content
                  ? "正在回答"
                  : undefined
          }
        />
        {request.content && (
          <div className="streaming-answer">
            <MessageContent content={request.content} />
          </div>
        )}
        {request.kind === "chat" && (
          <button className="thinking-stop" onClick={stop}>
            停止生成
          </button>
        )}
      </div>
    </div>
  );
}
