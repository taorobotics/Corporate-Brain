import { useState } from "react";
import {
  Copy,
  Check,
  ThumbsUp,
  ThumbsDown,
  ShareNetwork,
  ChatTeardropText,
  Database,
  DownloadSimple,
} from "@phosphor-icons/react";
import type { Conversation, Message } from "../shared/types";
import {
  feedbackCategories,
  feedbackRatings,
  type FeedbackRating,
  type FeedbackCategory,
  type FeedbackReceipt,
} from "../shared/feedback";
import { api, download } from "./api";
import { copyText } from "./clipboard";
import { Button, Field, Modal } from "./components";
import { SelectField } from "./Dropdown";

export default function MessageActions({
  message,
  conversation,
  save,
  notify,
}: {
  message: Message;
  conversation: Conversation;
  save: (receipt: FeedbackReceipt) => void;
  notify: (text: string) => void;
}) {
  const [dialog, setDialog] = useState<"feedback" | "share" | null>(null);
  const [rating, setRating] = useState<FeedbackRating>(
    message.feedback?.rating ?? "issue",
  );
  const [category, setCategory] = useState<FeedbackCategory>(
    message.feedback?.category ?? "other",
  );
  const [description, setDescription] = useState(
    message.feedback?.description ?? "",
  );
  const [includeContext, setIncludeContext] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const previous = conversation.messages
    .slice(
      0,
      conversation.messages.findIndex((item) => item.id === message.id),
    )
    .findLast((item) => item.role === "user");
  // Older messages embed attachment text in content. Never include that field when attachments exist.
  const question =
    previous?.promptText ??
    (previous?.attachments?.length
      ? "（旧对话含附件，未附上问题）"
      : (previous?.content ?? ""));
  const context = {
    question: question.slice(0, 20000),
    answer: message.content.slice(0, 50000),
  };
  const truncated = question.length > 20000 || message.content.length > 50000;
  async function copy(value: string) {
    try {
      await copyText(value);
      setCopied(true);
      notify("已复制");
    } catch {
      notify("复制失败，请重试，或使用保存 Markdown。");
    }
  }
  async function submit(value: FeedbackRating, withContext = includeContext) {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const receipt = await api<FeedbackReceipt>(
        "/feedback",
        {
          conversationId: conversation.id,
          messageId: message.id,
          connectionId: message.connectionId ?? null,
          rating: value,
          category: value === "helpful" ? "other" : category,
          description:
            value === "helpful" && dialog !== "feedback" ? "" : description,
          includeContext: withContext,
          ...(withContext ? { context } : {}),
        },
        "PUT",
        20000,
      );
      save(receipt);
      setDialog(null);
      notify("反馈已送达公司管理后台，谢谢你的反馈。");
    } catch (error) {
      setError((error as Error).message);
      notify((error as Error).message);
    } finally {
      setBusy(false);
    }
  }
  function openFeedback(value: FeedbackRating) {
    setRating(value);
    setCategory(message.feedback?.category ?? "other");
    setDescription(message.feedback?.description ?? "");
    setIncludeContext(false);
    setError("");
    setDialog("feedback");
  }
  const time = new Date(message.at);
  const total =
    message.usage?.totalTokens ??
    (message.usage?.inputTokens !== undefined &&
    message.usage?.outputTokens !== undefined
      ? message.usage.inputTokens + message.usage.outputTokens
      : undefined);
  const action = (
    label: string,
    children: React.ReactNode,
    onClick: () => void,
    selected?: boolean,
    disabled = false,
  ) => (
    <button
      type="button"
      className="message-action"
      title={label}
      aria-label={label}
      aria-pressed={selected}
      disabled={disabled}
      onClick={onClick}
    >
      {children}
    </button>
  );
  return (
    <>
      <div className="message-actions" role="group" aria-label="回答操作">
        {action(
          copied ? "再次复制回答" : "复制回答",
          copied ? <Check size={17} /> : <Copy size={17} />,
          () => void copy(message.content),
          undefined,
          !message.content,
        )}
        {action(
          "有帮助",
          <ThumbsUp
            size={17}
            weight={message.feedback?.rating === "helpful" ? "fill" : "regular"}
          />,
          () =>
            message.feedback
              ? openFeedback("helpful")
              : void submit("helpful", false),
          message.feedback?.rating === "helpful",
          busy,
        )}
        {action(
          "没有帮助",
          <ThumbsDown
            size={17}
            weight={
              message.feedback?.rating === "unhelpful" ? "fill" : "regular"
            }
          />,
          () => openFeedback("unhelpful"),
          message.feedback?.rating === "unhelpful",
          busy,
        )}
        {action(
          "反馈问题",
          <ChatTeardropText size={17} />,
          () => openFeedback(message.feedback?.rating ?? "issue"),
          message.feedback?.rating === "issue",
          busy,
        )}
        {action(
          "分享回答",
          <ShareNetwork size={17} />,
          () => setDialog("share"),
          undefined,
          !message.content,
        )}
        <span
          className="message-meta"
          title={
            message.usage
              ? `输入 ${message.usage.inputTokens ?? "未返回"} / 输出 ${message.usage.outputTokens ?? "未返回"} tokens`
              : "模型未返回本条回答的 Token 用量"
          }
        >
          <Database size={14} />
          {total === undefined
            ? "用量未返回"
            : `${total.toLocaleString()} tokens`}
        </span>
        {message.modelName && (
          <span className="message-model" title={message.modelName}>
            {message.modelName}
          </span>
        )}
        {!Number.isNaN(time.getTime()) && (
          <time dateTime={message.at} title={time.toLocaleString("zh-CN")}>
            {time.toLocaleString("zh-CN", {
              month: "2-digit",
              day: "2-digit",
              hour: "2-digit",
              minute: "2-digit",
              hour12: false,
            })}
          </time>
        )}
      </div>
      {dialog === "feedback" && (
        <Modal
          title="反馈这条回答"
          close={() => {
            if (!busy) setDialog(null);
          }}
        >
          <form
            className="feedback-form"
            onSubmit={(event) => {
              event.preventDefault();
              void submit(rating);
            }}
          >
            <p className="muted">反馈发送给公司管理员，用于改进回答质量。</p>
            <SelectField
              label="评价"
              value={rating}
              onValueChange={(value) => setRating(value as FeedbackRating)}
              options={Object.entries(feedbackRatings).map(
                ([value, label]) => ({ value, label }),
              )}
            />
            {rating !== "helpful" && (
              <SelectField
                label="问题类型"
                value={category}
                onValueChange={(value) =>
                  setCategory(value as FeedbackCategory)
                }
                options={Object.entries(feedbackCategories).map(
                  ([value, label]) => ({ value, label }),
                )}
              />
            )}
            <Field label="补充说明（选填）">
              <textarea
                aria-label="反馈说明"
                maxLength={2000}
                rows={4}
                value={description}
                placeholder="哪里不符合预期？你希望怎样改进？"
                onChange={(e) => setDescription(e.target.value)}
              />
            </Field>
            <label className="feedback-consent">
              <input
                type="checkbox"
                checked={includeContext}
                onChange={(e) => setIncludeContext(e.target.checked)}
              />
              附上当前问题与回答，方便管理员定位
            </label>
            <p className="muted">
              不包含其他轮对话、思考过程或附件文件。回答正文中引用的资料会包含在所选文本中，请先检查。
            </p>
            {message.feedback?.hasContext && !includeContext && (
              <p className="muted">重新提交后，将移除之前附上的问答文本。</p>
            )}
            {includeContext && (
              <details className="feedback-context" open>
                <summary>
                  将提交的文本{truncated ? "（超长内容已截取）" : ""}
                </summary>
                <h4>问题</h4>
                <pre>{context.question || "无问题文本"}</pre>
                <h4>回答</h4>
                <pre>{context.answer || "无回答文本"}</pre>
              </details>
            )}
            {error && (
              <p className="error" role="alert">
                {error}
              </p>
            )}
            <div className="dialog-actions">
              <Button disabled={busy} onClick={() => setDialog(null)}>
                取消
              </Button>
              <Button primary type="submit" disabled={busy}>
                {busy ? "正在提交…" : "提交反馈"}
              </Button>
            </div>
          </form>
        </Modal>
      )}
      {dialog === "share" && (
        <Modal title="分享回答" close={() => setDialog(null)}>
          <div className="feedback-form">
            <p>
              复制这条回答发送给他人，或保存为 Markdown
              文件。仅包含回答正文，不生成公开链接。
            </p>
            <div className="feedback-context">
              <pre>{message.content}</pre>
            </div>
            <div className="dialog-actions">
              <Button
                onClick={() =>
                  download(
                    `公司大脑-回答-${message.id.slice(0, 8)}.md`,
                    message.content,
                    "text/markdown;charset=utf-8",
                  )
                }
              >
                <DownloadSimple size={17} />
                保存 Markdown
              </Button>
              <Button primary onClick={() => void copy(message.content)}>
                <Copy size={17} />
                复制分享内容
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}
