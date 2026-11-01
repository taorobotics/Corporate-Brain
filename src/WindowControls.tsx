import { useSyncExternalStore } from "react";
import { Minus, Square, CopySimple, X } from "@phosphor-icons/react";
import { IconButton } from "./components";

// Existing desktop clients already publish this attribute, so a server update
// also restores the controls without requiring a new preload bridge.
function subscribe(callback: () => void) {
  const observer = new MutationObserver(callback);
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["data-window-expanded"],
  });
  return () => observer.disconnect();
}

export function WindowControls() {
  const expanded = useSyncExternalStore(
    subscribe,
    () => document.documentElement.dataset.windowExpanded === "true",
  );
  if (!window.brainDesktop) return null;
  return (
    <div className="window-buttons" role="group" aria-label="窗口控制">
      <IconButton
        label="最小化"
        onClick={() => window.brainDesktop!.windowAction("minimize")}
      >
        <Minus size={17} />
      </IconButton>
      <IconButton
        label={expanded ? "还原窗口" : "最大化"}
        onClick={() => window.brainDesktop!.windowAction("maximize")}
      >
        {expanded ? <CopySimple size={16} /> : <Square size={15} />}
      </IconButton>
      <IconButton
        label="关闭窗口"
        onClick={() => window.brainDesktop!.windowAction("close")}
      >
        <X size={18} />
      </IconButton>
    </div>
  );
}

export function WindowTitleBar() {
  if (!window.brainDesktop) return null;
  return (
    <div className="desktop-bar standalone-window-bar">
      <span className="window-caption">公司大脑</span>
      <span className="bar-spacer" />
      <WindowControls />
    </div>
  );
}
