import { useEffect, useRef, useState } from "react";
import { ArrowClockwise, ChatTeardropText } from "@phosphor-icons/react";
import {
  feedbackRatings,
  feedbackCategories,
  feedbackStatuses,
  type FeedbackList,
  type FeedbackDetail,
  type FeedbackStatus,
} from "../shared/feedback";
import { api } from "./api";
import { Button, Empty, Field, Modal, Search } from "./components";
import { SelectField } from "./Dropdown";

export default function FeedbackAdmin({
  notify,
}: {
  notify: (text: string) => void;
}) {
  const [query, setQuery] = useState({
    search: "",
    status: "",
    rating: "",
    source: "",
    page: 1,
  });
  const [data, setData] = useState<FeedbackList | null>(null),
    [error, setError] = useState("");
  const [loading, setLoading] = useState(true),
    [revision, setRevision] = useState(0);
  const [detail, setDetail] = useState<FeedbackDetail | null>(null),
    [detailError, setDetailError] = useState("");
  const [status, setStatus] = useState<FeedbackStatus>("pending"),
    [note, setNote] = useState(""),
    [saving, setSaving] = useState(false);
  const detailSequence = useRef(0);
  useEffect(() => {
    let current = true;
    setLoading(true);
    setError("");
    const timer = setTimeout(() => {
      const params = new URLSearchParams({
        page: String(query.page),
        ...(query.search ? { search: query.search } : {}),
        ...(query.status ? { status: query.status } : {}),
        ...(query.rating ? { rating: query.rating } : {}),
        ...(query.source ? { source: query.source } : {}),
      });
      void api<FeedbackList>(`/admin/feedback?${params}`)
        .then((value) => {
          if (current) setData(value);
        })
        .catch((e) => {
          if (current) setError(e.message);
        })
        .finally(() => {
          if (current) setLoading(false);
        });
    }, 180);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [query, revision]);
  useEffect(
    () => () => {
      detailSequence.current++;
    },
    [],
  );
  async function open(id: string) {
    const sequence = ++detailSequence.current;
    setDetailError("");
    try {
      const value = await api<FeedbackDetail>(`/admin/feedback/${id}`);
      if (sequence !== detailSequence.current) return;
      setDetail(value);
      setStatus(value.status);
      setNote(value.adminNote);
    } catch (e) {
      if (sequence === detailSequence.current) notify((e as Error).message);
    }
  }
  async function save() {
    if (!detail || saving) return;
    setSaving(true);
    setDetailError("");
    try {
      await api(
        `/admin/feedback/${detail.id}`,
        { status, adminNote: note, updatedAt: detail.updatedAt },
        "PATCH",
        20000,
      );
      setDetail(null);
      setRevision((v) => v + 1);
      notify("反馈处理结果已保存");
    } catch (e) {
      setDetailError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }
  const time = (value: string) =>
    new Date(value).toLocaleString("zh-CN", { hour12: false });
  return (
    <section className="feedback-admin">
      <div className="toolbar">
        <Search
          value={query.search}
          placeholder="姓名、部门、模型或反馈说明"
          onChange={(search) => setQuery((q) => ({ ...q, search, page: 1 }))}
        />
        <SelectField
          label="反馈状态"
          value={query.status}
          onValueChange={(status) =>
            setQuery((q) => ({ ...q, status, page: 1 }))
          }
          options={[
            { value: "", label: "全部状态" },
            ...Object.entries(feedbackStatuses).map(([value, label]) => ({
              value,
              label,
            })),
          ]}
        />
        <SelectField
          label="反馈来源"
          value={query.source}
          onValueChange={(source) =>
            setQuery((q) => ({ ...q, source, page: 1 }))
          }
          options={[
            { value: "", label: "全部来源" },
            { value: "general", label: "整体使用反馈" },
            { value: "answer", label: "回答反馈" },
          ]}
        />
        <SelectField
          label="反馈评价"
          value={query.rating}
          onValueChange={(rating) =>
            setQuery((q) => ({ ...q, rating, page: 1 }))
          }
          options={[
            { value: "", label: "全部评价" },
            ...Object.entries(feedbackRatings).map(([value, label]) => ({
              value,
              label,
            })),
          ]}
        />
        <Button disabled={loading} onClick={() => setRevision((v) => v + 1)}>
          <ArrowClockwise size={17} />
          刷新
        </Button>
      </div>
      {error && (
        <p className="notice error" role="alert">
          {error}
        </p>
      )}
      <div className="table-wrap feedback-table" aria-busy={loading}>
        <table>
          <thead>
            <tr>
              <th>提交人 / 部门</th>
              <th>来源 / 模型</th>
              <th>评价 / 类型</th>
              <th>反馈说明</th>
              <th>状态</th>
              <th>提交时间</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {!loading &&
              !error &&
              data?.rows.map((row) => (
                <tr key={row.id}>
                  <td>
                    <strong>{row.userName}</strong>
                    <small>
                      {row.username} · {row.departmentName}
                    </small>
                  </td>
                  <td>
                    {row.source === "general" ? "整体使用反馈" : "回答反馈"}
                    {row.source !== "general" && <small>{row.modelName}</small>}
                  </td>
                  <td>
                    {feedbackRatings[row.rating]}
                    <small>
                      {row.rating === "helpful"
                        ? "—"
                        : feedbackCategories[row.category]}
                    </small>
                  </td>
                  <td>
                    <span className="feedback-description">
                      {row.description || "未填写补充说明"}
                    </span>
                    <small>
                      {row.hasContext ? "已附当前问答" : "未附问答内容"}
                    </small>
                  </td>
                  <td>
                    <span className={`feedback-status ${row.status}`}>
                      {feedbackStatuses[row.status]}
                    </span>
                  </td>
                  <td>
                    <time dateTime={row.createdAt}>{time(row.createdAt)}</time>
                  </td>
                  <td>
                    <Button onClick={() => void open(row.id)}>查看反馈</Button>
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
        {loading ? (
          <p className="feedback-placeholder" role="status">
            正在读取反馈…
          </p>
        ) : !error && !data?.rows.length ? (
          <Empty
            icon={<ChatTeardropText size={30} />}
            title="暂无符合条件的反馈"
            detail="员工从头像菜单提交使用反馈，或对回答评价后，会显示在这里。"
          />
        ) : null}
      </div>
      <div className="feedback-pagination">
        <span>
          共 {data?.total ?? 0} 条 · 第 {data?.page ?? 1} /{" "}
          {Math.max(1, Math.ceil((data?.total ?? 0) / 20))} 页
        </span>
        <Button
          disabled={loading || !!error || !data || data.page <= 1}
          onClick={() =>
            setQuery((q) => ({ ...q, page: (data?.page ?? 1) - 1 }))
          }
        >
          上一页
        </Button>
        <Button
          disabled={
            loading ||
            !!error ||
            !data ||
            data.page * data.pageSize >= data.total
          }
          onClick={() =>
            setQuery((q) => ({ ...q, page: (data?.page ?? 1) + 1 }))
          }
        >
          下一页
        </Button>
      </div>
      {detail && (
        <Modal
          wide
          title="反馈详情与处理"
          close={() => {
            if (!saving) {
              detailSequence.current++;
              setDetail(null);
            }
          }}
        >
          <form
            className="feedback-form"
            onSubmit={(e) => {
              e.preventDefault();
              void save();
            }}
          >
            <p>
              {detail.userName}（{detail.username}） · {detail.departmentName}
              <br />
              {detail.modelName} · {time(detail.createdAt)}
            </p>
            <p>
              <strong>{feedbackRatings[detail.rating]}</strong> ·{" "}
              {detail.rating === "helpful"
                ? "正向评价"
                : feedbackCategories[detail.category]}
            </p>
            <div className="feedback-context">
              <pre>{detail.description || "未填写补充说明"}</pre>
            </div>
            {detail.context ? (
              <details className="feedback-context">
                <summary>用户主动附上的当前问答</summary>
                <h4>问题</h4>
                <pre>{detail.context.question || "无问题文本"}</pre>
                <h4>回答</h4>
                <pre>{detail.context.answer || "无回答文本"}</pre>
              </details>
            ) : (
              <p className="muted">用户未附上问答内容。</p>
            )}
            <SelectField
              label="处理状态"
              value={status}
              onValueChange={(value) => setStatus(value as FeedbackStatus)}
              options={Object.entries(feedbackStatuses).map(
                ([value, label]) => ({ value, label }),
              )}
            />
            <Field label="内部处理备注">
              <textarea
                aria-label="内部处理备注"
                rows={4}
                maxLength={2000}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="记录排查结果或后续改进安排"
              />
            </Field>
            {detail.handledAt && (
              <p className="muted">
                最近处理：{detail.handledBy} · {time(detail.handledAt)}
              </p>
            )}
            {detailError && (
              <p className="error" role="alert">
                {detailError}
              </p>
            )}
            <div className="dialog-actions">
              <Button disabled={saving} onClick={() => setDetail(null)}>
                关闭
              </Button>
              <Button primary type="submit" disabled={saving}>
                {saving ? "正在保存…" : "保存处理结果"}
              </Button>
            </div>
          </form>
        </Modal>
      )}
    </section>
  );
}
