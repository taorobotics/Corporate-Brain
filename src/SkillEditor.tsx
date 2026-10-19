import { useState } from "react";
import {
  Sparkle,
  FloppyDisk,
  PaperPlaneTilt,
  Play,
  CheckCircle,
} from "@phosphor-icons/react";
import type { WorkspaceProps } from "./App";
import type { Draft } from "../shared/types";
import { api } from "./api";
import { Button, Modal, Field, Busy } from "./components";
export default function SkillEditor({
  initial,
  close,
  ...props
}: WorkspaceProps & { initial: Draft; close: () => void }) {
  const { state, setState, user, departments, connections, notify } = props;
  const [draft, setDraft] = useState(initial),
    [busy, setBusy] = useState(false),
    [tab, setTab] = useState("edit"),
    [testInput, setTestInput] = useState(""),
    [testOutput, setTestOutput] = useState(""),
    [includeExamples, setIncludeExamples] = useState(!!initial.examples),
    [error, setError] = useState("");
  const selected = state.conversations.filter((c) =>
    draft.sourceIds.includes(c.id),
  );
  const model =
    connections.find(
      (c) => c.kind === "chat" && c.id === state.settings.model,
    ) ?? connections.find((c) => c.kind === "chat");
  function patch(value: Partial<Draft>) {
    setDraft((d) => ({ ...d, ...value }));
  }
  function save() {
    setState((s) => ({
      ...s,
      drafts: s.drafts.some((d) => d.id === draft.id)
        ? s.drafts.map((d) => (d.id === draft.id ? draft : d))
        : [draft, ...s.drafts],
    }));
  }
  async function extract() {
    if (!model || !selected.length) return;
    setBusy(true);
    setError("");
    try {
      const result = await api("/generate/chat", {
        connectionId: model.id,
        messages: [
          {
            role: "system",
            content:
              "将用户选定的任务记录整理为可复用 Skill 的 Markdown 操作说明。提取目标、输入参数、步骤、质量检查和失败处理。用参数代替个人路径与素材名。只输出说明正文，不编造成功步骤，不包含密钥或完整原始对话。",
          },
          {
            role: "user",
            content: selected
              .map(
                (c) =>
                  `${c.title}\n${c.messages.map((m) => `${m.role}: ${m.content}`).join("\n")}`,
              )
              .join("\n\n")
              .slice(0, 75000),
          },
        ],
      });
      patch({ instructions: result.content });
      notify("已提炼为可编辑草稿，请检查参数与流程后试运行。");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function test() {
    if (!model || !testInput.trim()) return;
    setBusy(true);
    setError("");
    setTestOutput("");
    try {
      const result = await api("/generate/chat", {
        connectionId: model.id,
        messages: [
          { role: "system", content: draft.instructions },
          { role: "user", content: testInput },
        ],
      });
      setTestOutput(result.content);
      const at = new Date().toISOString();
      setState((s) => ({
        ...s,
        conversations: [
          {
            id: crypto.randomUUID(),
            title: `试运行 · ${draft.name || "技能草稿"}`,
            createdAt: at,
            messages: [
              { id: crypto.randomUUID(), role: "user", content: testInput, at },
              {
                id: crypto.randomUUID(),
                role: "assistant",
                content: result.content,
                at,
              },
            ],
          },
          ...s.conversations,
        ],
      }));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function submit() {
    setBusy(true);
    setError("");
    try {
      if (!draft.testSummary.trim())
        throw new Error("请先填写真实试运行的测试摘要");
      await api("/skills", {
        name: draft.name,
        description: draft.description,
        version: draft.version,
        instructions: draft.instructions,
        examples: includeExamples ? draft.examples : "",
        testSummary: draft.testSummary,
        requiredTools: draft.requiredTools,
        audience: draft.audience,
        targetDepartments: draft.targetDepartments,
      });
      save();
      await props.refresh();
      notify("技能包已提交审核，完整来源对话仍保存在本机。");
      close();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal wide title="制作成技能" close={close}>
      <div className="editor-tabs tabs">
        {[
          ["edit", "来源与流程"],
          ["test", "试运行"],
          ["publish", "提交预览"],
        ].map(([id, label]) => (
          <button
            key={id}
            className={tab === id ? "active" : ""}
            onClick={() => setTab(id)}
          >
            {label}
          </button>
        ))}
        <span className="tab-note">个人草稿 · 仅本机</span>
      </div>
      <div className="skill-editor">
        {tab === "edit" && (
          <>
            <div className="form-grid">
              <Field label="技能名称">
                <input
                  value={draft.name}
                  maxLength={100}
                  onChange={(e) => patch({ name: e.target.value })}
                />
              </Field>
              <Field label="版本">
                <input
                  value={draft.version}
                  onChange={(e) => patch({ version: e.target.value })}
                />
              </Field>
            </div>
            <Field label="适用场景与说明">
              <textarea
                rows={2}
                value={draft.description}
                onChange={(e) => patch({ description: e.target.value })}
              />
            </Field>
            <Field label="选择本机来源对话（用于提炼）">
              <div className="source-list">
                {state.conversations.length ? (
                  state.conversations.map((c) => (
                    <label className="checkbox-row" key={c.id}>
                      <input
                        type="checkbox"
                        checked={draft.sourceIds.includes(c.id)}
                        onChange={(e) =>
                          patch({
                            sourceIds: e.target.checked
                              ? [...draft.sourceIds, c.id]
                              : draft.sourceIds.filter((id) => id !== c.id),
                          })
                        }
                      />
                      {c.title}
                      <small>{c.messages.length} 条消息</small>
                    </label>
                  ))
                ) : (
                  <p className="muted">暂无本机对话，也可以手动编写技能。</p>
                )}
              </div>
            </Field>
            <p className="muted small">
              点击 AI 提炼会将选定对话内容发送给 {model?.name ?? "所选模型"}
              ；最终发布的示例摘录另行选择。
            </p>
            <Button
              onClick={() => void extract()}
              disabled={!model || !selected.length || busy}
            >
              <Sparkle size={17} />
              AI 提炼流程
            </Button>
            <Field label="可复用流程（Markdown，可编辑）">
              <textarea
                rows={10}
                value={draft.instructions}
                placeholder="描述输入参数、执行步骤、输出要求与质量检查…"
                onChange={(e) => patch({ instructions: e.target.value })}
              />
            </Field>
          </>
        )}
        {tab === "test" && (
          <>
            <p className="muted">
              换一套新素材或参数测试流程。当前试运行接通文本模型，不执行本地文件或媒体工具。
            </p>
            <Field label="新测试输入">
              <textarea
                rows={4}
                value={testInput}
                onChange={(e) => setTestInput(e.target.value)}
                placeholder="使用不同于原始对话的内容测试…"
              />
            </Field>
            <Button
              onClick={() => void test()}
              disabled={
                busy ||
                !model ||
                !draft.instructions.trim() ||
                !testInput.trim()
              }
            >
              <Play size={16} />
              运行测试
            </Button>
            {testOutput && (
              <div className="test-output">
                <h3>实际模型输出</h3>
                <pre>{testOutput}</pre>
              </div>
            )}
            <Field label="测试摘要（说明真实测试输入、结果与局限）">
              <textarea
                rows={4}
                value={draft.testSummary}
                onChange={(e) => patch({ testSummary: e.target.value })}
                placeholder="记录实际验证结果；请勿将未执行的测试写为通过。"
              />
            </Field>
          </>
        )}
        {tab === "publish" && (
          <>
            <div className="notice">
              <CheckCircle size={22} />
              <div>
                <strong>确认这次提交的内容</strong>
                <p>完整聊天、未选附件、个人密钥和本机来源索引不会打包上传。</p>
              </div>
            </div>
            <div className="form-grid">
              <Field label="归属部门">
                <input value={user.departmentName} readOnly />
              </Field>
              <Field label="发布范围">
                <select
                  value={draft.audience}
                  onChange={(e) =>
                    patch({ audience: e.target.value as Draft["audience"] })
                  }
                >
                  <option value="department">本部门</option>
                  <option value="departments">指定多个部门</option>
                  <option value="company">全公司</option>
                </select>
              </Field>
            </div>
            {draft.audience === "departments" && (
              <Field label="允许使用的部门">
                <div className="source-list">
                  {departments
                    .filter((d) => d.enabled)
                    .map((d) => (
                      <label className="checkbox-row" key={d.id}>
                        <input
                          type="checkbox"
                          checked={draft.targetDepartments.includes(d.id)}
                          onChange={(e) =>
                            patch({
                              targetDepartments: e.target.checked
                                ? [...draft.targetDepartments, d.id]
                                : draft.targetDepartments.filter(
                                    (id) => id !== d.id,
                                  ),
                            })
                          }
                        />
                        {d.name}
                      </label>
                    ))}
                </div>
              </Field>
            )}
            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={includeExamples}
                onChange={(e) => setIncludeExamples(e.target.checked)}
              />
              附上我主动选取的示例摘录（可选）
            </label>
            {includeExamples && (
              <Field label="实际发布的示例摘录">
                <textarea
                  rows={4}
                  value={draft.examples}
                  onChange={(e) => patch({ examples: e.target.value })}
                  placeholder="手动粘贴希望审核员和同事看到的必要摘录。"
                />
              </Field>
            )}
            <div className="upload-manifest">
              <h3>上传清单</h3>
              <p>SKILL.md：名称、说明、版本与可复用流程</p>
              <p>发布元数据：作者、归属部门、受众、工具依赖</p>
              <p>测试摘要：{draft.testSummary || "尚未填写，请先完成试运行"}</p>
              {includeExamples && (
                <p>references/examples.md：上方确认的示例摘录</p>
              )}
            </div>
            <p className="muted small">
              {draft.audience === "department"
                ? "由本部门获授权审核员审核。"
                : "需要具有对应公司发布权限的审核员批准。"}
            </p>
          </>
        )}
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
      </div>
      <footer>
        <Button
          onClick={() => {
            save();
            notify("草稿已保存在本机。");
          }}
          disabled={busy}
        >
          <FloppyDisk size={17} />
          保存草稿
        </Button>
        <span className="bar-spacer" />
        {tab !== "publish" ? (
          <Button
            primary
            onClick={() => {
              save();
              setTab(tab === "edit" ? "test" : "publish");
            }}
          >
            下一步
          </Button>
        ) : (
          <Button
            primary
            disabled={
              busy ||
              !draft.name ||
              !draft.instructions ||
              !draft.description ||
              !draft.testSummary
            }
            onClick={() => void submit()}
          >
            {busy ? <Busy /> : <PaperPlaneTilt size={17} />}提交审核
          </Button>
        )}
      </footer>
    </Modal>
  );
}
