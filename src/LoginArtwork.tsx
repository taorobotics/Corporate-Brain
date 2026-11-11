import { useEffect, useRef, useState } from "react";
import type { PlanetSceneController } from "./login-artwork/scene";

export default function LoginArtwork({ theme }: { theme: string }) {
  const owner = useRef<HTMLElement>(null),
    host = useRef<HTMLDivElement>(null);
  const [paused, setPaused] = useState(false),
    [reduced, setReduced] = useState(false),
    [staticArt, setStaticArt] = useState(false);
  useEffect(() => {
    const element = host.current!,
      section = owner.current!;
    const intro = section.closest(".entry-experience");
    const reduce = matchMedia("(prefers-reduced-motion: reduce)"),
      narrow = matchMedia("(max-width:650px)");
    let active = true,
      importing = false,
      controller: PlanetSceneController | undefined;
    const sync = () => {
      if (!active) return;
      const shown =
        !intro || (intro as HTMLElement).dataset.introDone === "true";
      const fallback = section.dataset.brandStatic === "true";
      setReduced(reduce.matches);
      setStaticArt(fallback);
      section.dataset.brandMotion =
        shown &&
        !document.hidden &&
        !narrow.matches &&
        !reduce.matches &&
        section.dataset.userPaused !== "true" &&
        !fallback
          ? "playing"
          : "paused";
      if (!shown || narrow.matches || importing || controller) return;
      importing = true;
      void import("./login-artwork/scene")
        .then(({ createPlanetScene }) => {
          if (!active) return;
          controller = createPlanetScene(element, section);
          // Rendering diagnostics never contain account or form data.
          Object.defineProperty(element, "__brainArtwork", {
            value: controller,
            configurable: true,
          });
          sync();
        })
        .catch(() => {
          if (!active) return;
          section.dataset.brandStatic = "true";
          element.dataset.renderer = "fallback";
          sync();
        });
    };
    const observer = new MutationObserver(sync);
    if (intro)
      observer.observe(intro, {
        attributes: true,
        attributeFilter: ["data-intro-done"],
      });
    observer.observe(section, {
      attributes: true,
      attributeFilter: ["data-user-paused"],
    });
    section.addEventListener("brand-motion-capability", sync);
    document.addEventListener("visibilitychange", sync);
    reduce.addEventListener("change", sync);
    narrow.addEventListener("change", sync);
    sync();
    return () => {
      active = false;
      observer.disconnect();
      controller?.dispose();
      delete (
        element as HTMLElement & { __brainArtwork?: PlanetSceneController }
      ).__brainArtwork;
      section.removeEventListener("brand-motion-capability", sync);
      document.removeEventListener("visibilitychange", sync);
      reduce.removeEventListener("change", sync);
      narrow.removeEventListener("change", sync);
    };
  }, []);
  return (
    <section
      ref={owner}
      className={`brand-visual sculptural-visual ${theme === "dark" ? "dsu-dark" : ""}`}
      data-user-paused={paused}
      aria-label="行星动态视觉"
    >
      <div className="visual-top">
        <span className="archive-square" aria-hidden="true" />
        <span>公司工作台</span>
      </div>
      <div
        className="brand-motion-stage sculpture-host login-artwork-host"
        ref={host}
        aria-hidden="true"
      >
        <div className="sculpture-ambient" />
        <svg
          className="planet-fallback"
          viewBox="0 0 460 460"
          aria-hidden="true"
        >
          <defs>
            <radialGradient id="auth-pearl" cx=".25" cy=".2" r=".9">
              <stop stopColor="#fffdf5" />
              <stop offset=".45" stopColor="#dce4e9" />
              <stop offset=".8" stopColor="#9daebe" />
              <stop offset="1" stopColor="#8896a7" />
            </radialGradient>
            <linearGradient id="auth-ring">
              <stop stopColor="#96a2a4" />
              <stop offset=".35" stopColor="#f8f4e9" />
              <stop offset=".6" stopColor="#b8b9b3" />
              <stop offset="1" stopColor="#8f9da7" />
            </linearGradient>
            <radialGradient id="auth-shadow">
              <stop stopColor="#a2a6a3" stopOpacity=".3" />
              <stop offset="1" stopColor="#a2a6a3" stopOpacity="0" />
            </radialGradient>
          </defs>
          <ellipse
            cx="230"
            cy="365"
            rx="128"
            ry="14"
            fill="url(#auth-shadow)"
          />
          <ellipse
            cx="230"
            cy="222"
            rx="163"
            ry="66"
            fill="none"
            stroke="url(#auth-ring)"
            strokeWidth="13"
            transform="rotate(-27 230 222)"
          />
          <circle cx="230" cy="222" r="90" fill="url(#auth-pearl)" />
          <path
            d="M87 296c36 36 142 23 230-33 69-44 91-90 62-109"
            fill="none"
            stroke="url(#auth-ring)"
            strokeWidth="12"
          />
          <circle cx="103" cy="128" r="15" fill="url(#auth-pearl)" />
          <circle cx="366" cy="317" r="21" fill="#c8ab83" />
        </svg>
      </div>
      <div className="visual-bottom">
        <span className="visual-rule" aria-hidden="true" />
        <button
          type="button"
          className="motion-toggle"
          aria-label={
            staticArt
              ? "当前为静态视觉"
              : reduced
                ? "动效已遵循系统设置暂停"
                : paused
                  ? "播放动效"
                  : "暂停动效"
          }
          aria-pressed={paused || reduced || staticArt}
          disabled={reduced || staticArt}
          onClick={() => setPaused((value) => !value)}
        >
          <svg viewBox="0 0 16 16" aria-hidden="true">
            {paused ? <path d="m5 3 7 5-7 5Z" /> : <path d="M5 4v8m6-8v8" />}
          </svg>
          <span>
            {staticArt
              ? "静态预览"
              : reduced
                ? "静态模式"
                : paused
                  ? "播放动效"
                  : "暂停动效"}
          </span>
        </button>
      </div>
    </section>
  );
}
