import { useState, type CSSProperties } from "react";
import {
  ArrowLeft,
  Check,
  Moon,
  Sun,
  Palette,
  ArrowUp,
} from "@phosphor-icons/react";
import {
  DEFAULT_SKIN,
  getSkin,
  SKINS,
  skinTokens,
  type Skin,
  type SkinMode,
} from "../shared/skins";
import { Button, Modal } from "./components";

export type SkinSelection = { skin: string; theme: SkinMode };

function SkinPreview({
  skin,
  mode,
  large = false,
}: {
  skin: Skin;
  mode: SkinMode;
  large?: boolean;
}) {
  return (
    <div
      className={`skin-sample ${large ? "large" : ""}`}
      data-variant={skin.variant}
      style={skinTokens(skin, mode) as CSSProperties}
      aria-hidden="true"
    >
      <div className="skin-sample-side">
        <span className="skin-sample-brand">◈</span>
        <i />
        <i />
        <i />
        <span className="skin-sample-avatar" />
      </div>
      <div className="skin-sample-main">
        <span className="skin-sample-caption">公司大脑</span>
        <div className="skin-sample-greeting">
          留一点空间，
          <br />
          给下一个好想法。
        </div>
        <div className="skin-sample-prompt">
          今天，一起完成些什么
          <ArrowUp size={16} />
        </div>
        <div className="skin-sample-chips">
          <i />
          <i />
          <i />
        </div>
      </div>
    </div>
  );
}

export default function SkinCenter({
  current,
  onApply,
  onPreview,
  back,
}: {
  current: SkinSelection;
  onApply: (value: SkinSelection) => void;
  onPreview: (value: SkinSelection) => void;
  back: () => void;
}) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("全部");
  const [mode, setMode] = useState<SkinMode>(current.theme);
  const [detail, setDetail] = useState<Skin | null>(null);
  const selected = getSkin(current.skin);
  const categories = ["全部", "简约", "玻璃", "终端", "风景与插画"];
  const filtered = SKINS.filter(
    (skin) =>
      (category === "全部" || skin.category === category) &&
      `${skin.id} ${skin.name} ${skin.author}`
        .toLowerCase()
        .includes(query.trim().toLowerCase()),
  );
  const modes = (
    <div className="skin-mode-switch" role="group" aria-label="皮肤预览明暗">
      <button aria-pressed={mode === "light"} onClick={() => setMode("light")}>
        <Sun size={17} />
        浅色预览
      </button>
      <button aria-pressed={mode === "dark"} onClick={() => setMode("dark")}>
        <Moon size={17} />
        深色预览
      </button>
    </div>
  );
  return (
    <section className="skin-center">
      <button className="skin-back" onClick={back}>
        <ArrowLeft size={16} />
        返回设置
      </button>
      <header className="skin-heading">
        <div>
          <span className="skin-eyebrow">让工作空间，更像你</span>
          <h1>
            皮肤中心<span>{SKINS.length}</span>
          </h1>
          <p>选一个喜欢的氛围。选择只保存在此设备的当前账号。</p>
        </div>
        <Button
          onClick={() => onApply({ skin: DEFAULT_SKIN, theme: current.theme })}
        >
          恢复默认 {getSkin(DEFAULT_SKIN).name}
        </Button>
      </header>
      <div className="skin-current">
        <Palette size={23} />
        <div>
          <strong>当前 · {selected.name}</strong>
          <span>
            {current.theme === "dark" ? "深色" : "浅色"}外观 ·{" "}
            {selected.edition}
          </span>
        </div>
        <Check size={20} />
      </div>
      <div className="skin-toolbar">
        <label className="skin-search">
          <span className="sr-only">搜索皮肤</span>
          <input
            type="search"
            aria-label="搜索皮肤"
            placeholder="搜索名称、风格或作者…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
        {modes}
      </div>
      <div className="skin-filters" role="group" aria-label="皮肤分类">
        {categories.map((item) => (
          <button
            key={item}
            aria-pressed={category === item}
            onClick={() => setCategory(item)}
          >
            {item}
          </button>
        ))}
        <span role="status">{filtered.length} 款</span>
      </div>
      <div className="skin-grid">
        {filtered.map((skin) => (
          <button
            className="skin-card"
            key={skin.id}
            data-skin-id={skin.id}
            aria-label={`查看 ${skin.name}`}
            onClick={() => setDetail(skin)}
          >
            <SkinPreview skin={skin} mode={mode} />
            <div className="skin-card-info">
              <strong>{skin.name}</strong>
              {selected.id === skin.id && (
                <span className="skin-selected">
                  <Check size={13} />
                  使用中
                </span>
              )}
            </div>
            <div className="skin-card-meta">
              <span>{skin.edition}</span>
              <span>{skin.category}</span>
            </div>
          </button>
        ))}
      </div>
      {!filtered.length && (
        <div className="skin-empty">
          <p>没有找到匹配的皮肤</p>
          <Button
            onClick={() => {
              setQuery("");
              setCategory("全部");
            }}
          >
            显示全部皮肤
          </Button>
        </div>
      )}
      <p className="skin-footnote">
        选款参考 DSH
        皮肤库，界面由公司大脑适配。标注“配色适配”的款式采用独立界面与配色，不包含原作角色、受限插画或专属动画。卡片展示本客户端的实际样式。
      </p>
      {detail && (
        <Modal title={detail.name} close={() => setDetail(null)} wide>
          <div className="skin-detail">
            <SkinPreview skin={detail} mode={mode} large />
            {modes}
            <p>
              <strong>{detail.edition}</strong> · 原作作者 {detail.author}
            </p>
            <p className="muted">
              {detail.id === "claude"
                ? "暖米色、珊瑚橙与衬线正文。深色采用暖黑底色。保留公司大脑的品牌、导航和全部功能。"
                : detail.background
                  ? "已内置原作背景，配合本客户端的面板、按钮与聊天样式。浅色和深色均可使用。"
                  : "这款提供独立制作的配色与控件样式，未内置原作插画。可先预览整个窗口，再决定是否保存。"}
            </p>
            <div className="skin-detail-actions">
              <Button
                onClick={() => {
                  onPreview({ skin: detail.id, theme: mode });
                  setDetail(null);
                }}
              >
                全窗预览
              </Button>
              <Button
                primary
                onClick={() => {
                  onApply({ skin: detail.id, theme: mode });
                  setDetail(null);
                }}
              >
                使用这款
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </section>
  );
}
