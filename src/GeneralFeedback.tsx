import { useRef, useState } from "react";
import { api } from "./api";
import { Button, Field, Modal } from "./components";
import { SelectField } from "./Dropdown";

export default function GeneralFeedback({
  close,
  notify,
}: {
  close: () => void;
  notify: (message: string) => void;
}) {
  const requestId = useRef(crypto.randomUUID());
  const [category, setCategory] = useState("ui");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const submitting = useRef(false);
  async function submit() {
    if (submitting.current || !description.trim()) return;
    submitting.current = true;
    setBusy(true);
    setError("");
    try {
      await api(
        "/feedback/general",
        { requestId: requestId.current, category, description },
        "POST",
        20000,
      );
      notify("反馈已送达公司管理后台，谢谢你的反馈。");
      close();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }
  return (
    <Modal
      title="意见反馈"
      close={() => {
        if (!submitting.current) close();
      }}
    >
      <form
        className="feedback-form"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <p className="muted">
          遇到界面、操作或对话问题，都可以在这里反馈给公司管理员。只提交你填写的内容。
        </p>
        <SelectField
          label="反馈类型"
          value={category}
          onValueChange={setCategory}
          disabled={busy}
          options={[
            { value: "ui", label: "界面与操作" },
            { value: "chat", label: "对话与任务" },
            { value: "other", label: "其他问题" },
          ]}
        />
        <Field label="反馈内容">
          <textarea
            aria-label="反馈内容"
            rows={6}
            maxLength={2000}
            required
            disabled={busy}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="请描述遇到的问题、操作步骤或改进建议"
          />
        </Field>
        <small className="muted">{description.length} / 2000</small>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <div className="dialog-actions">
          <Button disabled={busy} onClick={close}>
            取消
          </Button>
          <Button primary type="submit" disabled={busy || !description.trim()}>
            {busy ? "正在提交…" : "提交反馈"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
