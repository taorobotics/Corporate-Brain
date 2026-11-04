import { useState } from "react";
import { Popover } from "@base-ui/react/popover";
import {
  Sparkle,
  MagnifyingGlass,
  Check,
  ArrowUpRight,
} from "@phosphor-icons/react";
import type { Skill } from "../shared/types";
import "./skill-picker.css";

export default function SkillPicker({
  skills,
  mode,
  selected,
  disabled,
  change,
  manage,
}: {
  skills: Skill[];
  mode: "auto" | "manual";
  selected: string[];
  disabled: boolean;
  change: (mode: "auto" | "manual", ids: string[]) => void;
  manage: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const filtered = skills.filter((skill) =>
    `${skill.name} ${skill.description}`
      .toLocaleLowerCase()
      .includes(search.trim().toLocaleLowerCase()),
  );
  return (
    <Popover.Root
      open={open}
      onOpenChange={(value) => {
        setOpen(value);
        if (!value) setSearch("");
      }}
    >
      <Popover.Trigger
        type="button"
        className="text-button composer-skills"
        aria-label="选择技能"
        disabled={disabled}
      >
        <Sparkle size={19} />
        技能
        <span>{mode === "auto" ? "自动" : selected.length || "未选"}</span>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner
          className="dropdown-positioner"
          side="top"
          align="start"
          sideOffset={10}
          collisionPadding={12}
        >
          <Popover.Popup
            className="skill-picker"
            data-overlay-popup=""
            aria-label="已安装技能"
          >
            <div className="skill-picker-heading">
              <strong>已安装技能</strong>
              <span>可同时使用多个</span>
            </div>
            <label className="skill-picker-search">
              <MagnifyingGlass size={16} />
              <input
                autoComplete="off"
                aria-label="搜索已安装技能"
                placeholder="搜索技能名称或用途"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            </label>
            <button
              type="button"
              role="checkbox"
              aria-checked={mode === "auto"}
              className="skill-picker-auto"
              onClick={() => change(mode === "auto" ? "manual" : "auto", [])}
            >
              <span className="skill-picker-check">
                {mode === "auto" && <Check size={13} weight="bold" />}
              </span>
              <span>
                <strong>自动调用已安装技能</strong>
                <small>AI 根据任务选择，也可以组合多个技能</small>
              </span>
            </button>
            <div
              className="skill-picker-list"
              aria-label="当前账号已安装的技能"
            >
              {filtered.map((skill) => {
                const checked =
                  mode === "manual" && selected.includes(skill.id);
                const unavailable = skill.requiredTools.length > 0;
                return (
                  <button
                    type="button"
                    key={skill.id}
                    role="checkbox"
                    aria-checked={checked}
                    disabled={
                      unavailable ||
                      (!checked && mode === "manual" && selected.length >= 16)
                    }
                    className="skill-picker-item"
                    onClick={() =>
                      change(
                        "manual",
                        checked
                          ? selected.filter((id) => id !== skill.id)
                          : [...(mode === "manual" ? selected : []), skill.id],
                      )
                    }
                    onKeyDown={(event) => {
                      if (!["ArrowUp", "ArrowDown"].includes(event.key)) return;
                      event.preventDefault();
                      const items = Array.from(
                        event.currentTarget.parentElement!.querySelectorAll<HTMLButtonElement>(
                          "button:not(:disabled)",
                        ),
                      );
                      items[
                        (items.indexOf(event.currentTarget) +
                          (event.key === "ArrowDown" ? 1 : -1) +
                          items.length) %
                          items.length
                      ]?.focus();
                    }}
                  >
                    <span className="skill-picker-check">
                      {checked && <Check size={13} weight="bold" />}
                    </span>
                    <span className="skill-picker-description">
                      <strong>{skill.name}</strong>
                      <small>
                        {unavailable ? "依赖的工具尚未接通" : skill.description}
                      </small>
                    </span>
                  </button>
                );
              })}
              {!filtered.length && (
                <p className="skill-picker-empty">
                  {skills.length
                    ? "没有匹配的已安装技能"
                    : "当前账号还没有安装技能"}
                </p>
              )}
            </div>
            <footer>
              <span>
                {mode === "auto"
                  ? `${skills.length} 个已安装 · 按需调用`
                  : selected.length
                    ? `已选择 ${selected.length} 个`
                    : "本次不使用技能"}
              </span>
              <button
                type="button"
                onClick={() => {
                  setOpen(false);
                  manage();
                }}
              >
                技能中心
                <ArrowUpRight size={14} />
              </button>
            </footer>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}
