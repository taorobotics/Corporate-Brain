import { useState, useRef } from "react";
import {
  GithubLogo,
  UploadSimple,
  ArrowLeft,
  CheckCircle,
  CircleNotch,
} from "@phosphor-icons/react";
import { api } from "./api";
import { Button, Field, Modal } from "./components";
import type { WorkspaceProps } from "./App";
import type { Skill } from "../shared/types";
import type { SkillImportPreview } from "../shared/skill-import";
import "./skill-import.css";

const samples = [
  ["Lemo-Opuscar", "lemomo-ai/lemo-opuscar"],
  ["MG Styles 15", "Vincentwei1021/mg-styles-15"],
  ["花叔 Design", "alchaincyf/huashu-design"],
];
export default function SkillImport({
  user,
  departments,
  onImported,
  close,
}: Pick<WorkspaceProps, "user" | "departments"> & {
  onImported: (skill: Skill) => Promise<void>;
  close: () => void;
}) {
  const [tab, setTab] = useState<"github" | "zip">("github"),
    [url, setUrl] = useState("");
  const [file, setFile] = useState<File | null>(null),
    [preview, setPreview] = useState<SkillImportPreview | null>(null);
  const [entry, setEntry] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [audience, setAudience] = useState<
      "department" | "departments" | "company"
    >("department"),
    [targets, setTargets] = useState<string[]>([]);
  const [acknowledge, setAcknowledge] = useState(false),
    [publish, setPublish] = useState(user.role === "company_admin");
  const [resource, setResource] = useState<{
    path: string;
    content: string;
  } | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const candidate = preview?.candidates.find((c) => c.entry === entry);
  async function cancel() {
    if (busy) return;
    if (preview)
      try {
        await api(`/skill-imports/${preview.id}`, {}, "DELETE");
      } catch {}
    close();
  }
  async function analyze() {
    setBusy(true);
    setError("");
    try {
      let result: SkillImportPreview;
      if (tab === "github")
        result = await api("/skill-imports/github", { url }, "POST", 260_000);
      else {
        if (!file || !/\.zip$/i.test(file.name) || file.size > 32 * 1024 * 1024)
          throw new Error("请选择 32MB 以内的 ZIP 技能包。");
        const response = await fetch(
          `/api/skill-imports/zip?name=${encodeURIComponent(file.name)}`,
          {
            method: "POST",
            credentials: "include",
            headers: { "Content-Type": "application/zip" },
            body: file,
            signal: AbortSignal.timeout(260_000),
          },
        );
        const data = await response.json();
        if (!response.ok) throw new Error(data.error ?? "上传失败");
        result = data;
      }
      setPreview(result);
      setEntry(result.candidates[0].entry);
      setAcknowledge(false);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function commit() {
    if (!preview) return;
    setBusy(true);
    setError("");
    try {
      const skill = await api<Skill>(`/skill-imports/${preview.id}/commit`, {
        entry,
        audience,
        targetDepartments: targets,
        publish,
        acknowledge,
      });
      // Once committed, refresh errors must not encourage submitting the same package twice.
      setPreview(null);
      await onImported(skill);
      close();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function readResource(path: string) {
    if (!preview || !path) {
      setResource(null);
      return;
    }
    try {
      setResource(
        await api(
          `/skill-imports/${preview.id}/file?path=${encodeURIComponent(path)}`,
        ),
      );
    } catch (e) {
      setResource(null);
      setError((e as Error).message);
    }
  }
  return (
    <Modal wide title="导入技能" close={() => void cancel()}>
      <div className="skill-import">
        <p className="muted">
          从公开 GitHub 仓库或 ZIP
          导入技能、引用资料与许可，确认后按公司权限发布。
        </p>
        {!preview ? (
          <>
            <div className="tabs" aria-label="技能导入方式">
              <button
                disabled={busy}
                className={tab === "github" ? "active" : ""}
                onClick={() => setTab("github")}
              >
                <GithubLogo size={18} /> GitHub 链接
              </button>
              <button
                disabled={busy}
                className={tab === "zip" ? "active" : ""}
                onClick={() => setTab("zip")}
              >
                <UploadSimple size={18} /> 上传 ZIP
              </button>
            </div>
            {tab === "github" ? (
              <>
                <Field label="GitHub 仓库或技能目录">
                  <input
                    aria-label="GitHub 技能链接"
                    placeholder="https://github.com/作者/仓库"
                    value={url}
                    disabled={busy}
                    onChange={(e) => setUrl(e.target.value)}
                  />
                </Field>
                <div className="skill-import-examples">
                  <span className="muted">试试这些项目</span>
                  {samples.map(([name, repo]) => (
                    <button
                      key={repo}
                      disabled={busy}
                      onClick={() => setUrl(`https://github.com/${repo}`)}
                    >
                      {name}
                    </button>
                  ))}
                </div>
              </>
            ) : (
              <div className="skill-upload">
                <UploadSimple size={28} />
                <strong>{file?.name ?? "选择技能 ZIP 压缩包"}</strong>
                <span className="muted">
                  支持根目录或子目录内的 SKILL.md，保留配套文件。压缩包最大
                  32MB。
                </span>
                <Button disabled={busy} onClick={() => input.current?.click()}>
                  选择 ZIP 文件
                </Button>
                <input
                  ref={input}
                  type="file"
                  accept=".zip,application/zip"
                  aria-label="技能 ZIP 文件"
                  hidden
                  onChange={(e) => {
                    setFile(e.target.files?.[0] ?? null);
                    setError("");
                  }}
                />
              </div>
            )}
            <p className="muted">
              导入只下载和检查文件，不运行仓库脚本、不自动安装依赖。
            </p>
          </>
        ) : (
          <>
            <div className="skill-import-summary">
              <CheckCircle size={24} />
              <div>
                <strong>
                  解析完成 · {preview.candidates.length} 个技能入口
                </strong>
                <p>
                  {preview.source.fileCount} 个文件 ·{" "}
                  {(preview.source.bytes / 1024 / 1024).toFixed(1)} MB ·{" "}
                  {preview.source.kind === "github"
                    ? "GitHub 固定版本"
                    : "本地压缩包"}
                </p>
              </div>
            </div>
            <Field label="选择技能入口">
              <select
                aria-label="技能入口"
                value={entry}
                disabled={busy}
                onChange={(e) => setEntry(e.target.value)}
              >
                {preview.candidates.map((c) => (
                  <option key={c.entry} value={c.entry}>
                    {c.name} · {c.entry}
                  </option>
                ))}
              </select>
            </Field>
            <p>{candidate?.description}</p>
            <dl className="skill-source-grid">
              <dt>来源</dt>
              <dd>
                {preview.source.url ? (
                  <a href={preview.source.url} target="_blank" rel="noreferrer">
                    {preview.source.label}
                  </a>
                ) : (
                  preview.source.label
                )}
              </dd>
              <dt>许可</dt>
              <dd>{preview.source.license}</dd>
              {preview.source.commit && (
                <>
                  <dt>提交版本</dt>
                  <dd>
                    <code>{preview.source.commit}</code>
                  </dd>
                </>
              )}
            </dl>
            {preview.source.notes.map((note) => (
              <p className="skill-import-note" key={note}>
                {note}
              </p>
            ))}
            <details>
              <summary>查看技能正文</summary>
              <pre className="skill-resource-preview">
                {candidate?.instructions}
              </pre>
            </details>
            <details>
              <summary>查看文件与许可（{preview.files.length}）</summary>
              <select
                aria-label="预览技能文件"
                defaultValue=""
                onChange={(e) => void readResource(e.target.value)}
              >
                <option value="">选择文本文件预览</option>
                {preview.files.map((path) => (
                  <option key={path}>{path}</option>
                ))}
              </select>
              {resource && (
                <pre className="skill-resource-preview">{resource.content}</pre>
              )}
            </details>
            <Field label="发布范围">
              <select
                aria-label="导入技能发布范围"
                value={audience}
                disabled={busy}
                onChange={(e) => setAudience(e.target.value as typeof audience)}
              >
                <option value="department">本部门</option>
                <option value="departments">指定部门</option>
                <option value="company">全公司</option>
              </select>
            </Field>
            {audience === "departments" && (
              <div className="skill-targets">
                {departments
                  .filter((d) => d.enabled)
                  .map((d) => (
                    <label key={d.id}>
                      <input
                        type="checkbox"
                        disabled={busy}
                        checked={targets.includes(d.id)}
                        onChange={(e) =>
                          setTargets(
                            e.target.checked
                              ? [...targets, d.id]
                              : targets.filter((id) => id !== d.id),
                          )
                        }
                      />
                      {d.name}
                    </label>
                  ))}
              </div>
            )}
            {user.role === "company_admin" && (
              <label className="skill-import-consent">
                <input
                  type="checkbox"
                  checked={publish}
                  disabled={busy}
                  onChange={(e) => setPublish(e.target.checked)}
                />
                确认后直接上架到选定范围
              </label>
            )}
            <label className="skill-import-consent">
              <input
                type="checkbox"
                aria-label="确认技能来源与授权"
                checked={acknowledge}
                disabled={busy}
                onChange={(e) => setAcknowledge(e.target.checked)}
              />
              我已查看来源、许可及技能内容，确认有权在所选范围共享。脚本和渲染依赖仍需核对。
            </label>
            {!publish && (
              <p className="muted">
                导入后进入现有审核队列，批准后员工才能安装使用。
              </p>
            )}
          </>
        )}
        {error && (
          <p className="skill-import-error" role="alert">
            {error}
          </p>
        )}
        {busy && (
          <p className="skill-import-progress" role="status">
            <CircleNotch size={18} className="spin" />
            {preview
              ? "正在保存技能和配套资料…"
              : "正在下载、检查文件并解析技能，较大项目需要一些时间…"}
          </p>
        )}
        <footer>
          {preview && (
            <Button
              disabled={busy}
              onClick={() => {
                void api(`/skill-imports/${preview.id}`, {}, "DELETE")
                  .then(() => {
                    setPreview(null);
                    setResource(null);
                    setError("");
                  })
                  .catch((e) => setError(e.message));
              }}
            >
              <ArrowLeft size={16} />
              重新选择
            </Button>
          )}
          <Button disabled={busy} onClick={() => void cancel()}>
            取消
          </Button>
          <Button
            primary
            disabled={
              busy ||
              (preview
                ? !acknowledge ||
                  (audience === "departments" && !targets.length)
                : tab === "github"
                  ? !url.trim()
                  : !file)
            }
            onClick={() => void (preview ? commit() : analyze())}
          >
            {preview
              ? publish
                ? "导入并上架"
                : "导入并提交审核"
              : "解析并预览"}
          </Button>
        </footer>
      </div>
    </Modal>
  );
}

export function SkillSourceDetails({ skill }: { skill: Skill }) {
  const source = skill.imported,
    [content, setContent] = useState(""),
    [error, setError] = useState("");
  if (!source) return null;
  async function license(path: string) {
    try {
      setError("");
      setContent(
        (
          await api(
            `/skills/${skill.id}/resources?path=${encodeURIComponent(path)}`,
          )
        ).content,
      );
    } catch (e) {
      setError((e as Error).message);
    }
  }
  return (
    <div className="skill-source-details">
      <h3>来源与运行条件</h3>
      <p>
        {source.url ? (
          <a href={source.url} target="_blank" rel="noreferrer">
            {source.label}
          </a>
        ) : (
          source.label
        )}{" "}
        · {source.fileCount} 个配套文件
      </p>
      <p>
        {source.license}
        {source.commit && ` · 提交 ${source.commit.slice(0, 12)}`}
      </p>
      {source.notes.map((note) => (
        <p className="muted" key={note}>
          {note}
        </p>
      ))}
      <p className="muted">
        配套资源由公司服务器保存，使用时放入当前员工的独立任务工作区。
      </p>
      <div className="inline-actions">
        {source.licenseFiles.slice(0, 8).map((path) => (
          <Button key={path} onClick={() => void license(path)}>
            查看 {path}
          </Button>
        ))}
      </div>
      {error && <p role="alert">{error}</p>}
      {content && <pre className="skill-resource-preview">{content}</pre>}
    </div>
  );
}
