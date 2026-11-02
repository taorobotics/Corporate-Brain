/* Dossier composition adapted from dsh-startup-screen, MIT © 沈宏宏.
   Original motion/geometry for Corporate Brain. No upstream recordings/media.
   Shared by native startup, web authentication and the playable preview. */
(() => {
  if (customElements.get("brain-entry-scene")) return;
  const mark = `<svg viewBox="0 0 120 120" fill="none" aria-hidden="true"><path d="M60 8 105 34v52L60 112 15 86V34Z"/><path d="m15 34 45 26 45-26M60 60v52M37 21l46 26v27L60 87 37 74V47l46-26"/></svg>`;
  class EntryScene extends HTMLElement {
    static get observedAttributes() {
      return ["theme", "phase", "headline", "detail"];
    }
    connectedCallback() {
      if (this.built) return;
      this.built = true;
      this.classList.add("entry-scene");
      this.innerHTML = `
        <div class="entry-paper" aria-hidden="true"></div>
        <div class="entry-grid" aria-hidden="true"></div>
        <div class="entry-panels" aria-hidden="true"><i></i><i></i><i></i><i></i></div>
        <div class="entry-frame" aria-hidden="true"><i></i><i></i><i></i><i></i></div>
        <div class="entry-brand"><span>CORPORATE</span><small>SYNTHESIZE INTELLIGENCE</small><span>BRAIN<span class="entry-brand-os"> OS</span></span><p>公司大脑 <b> / </b> WORKSPACE SYSTEM</p></div>
        <div class="entry-edition" aria-hidden="true">INTELLIGENCE, CONNECTED.<br><span>DESIGNED FOR YOUR COMPANY</span></div>
        <div class="entry-object" aria-hidden="true">
          <div class="entry-orbit orbit-one"><i></i><i></i></div>
          <div class="entry-orbit orbit-two"></div>
          <div class="entry-orbit orbit-three"></div>
          <div class="entry-cross cross-x"></div><div class="entry-cross cross-y"></div>
          <span class="entry-coordinate coordinate-a">01 / CONTEXT</span><span class="entry-coordinate coordinate-b">02 / KNOWLEDGE</span>
          <div class="entry-core"><div class="entry-core-shadow">${mark}</div><div class="entry-core-front">${mark}</div></div>
          <div class="entry-scan"></div>
        </div>
        <div class="entry-status" role="status" aria-live="polite" aria-atomic="true"><span class="entry-kicker">ESTABLISHING CONNECTION</span><h1><span class="entry-headline">正在连接公司工作空间</span><i></i></h1><div class="entry-rule"></div><p class="entry-detail">页面就绪后自动进入</p></div>
        <div class="entry-auth-caption" aria-hidden="true"><span>YOUR NEXT</span><strong>GREAT IDEA<span>_</span></strong><small>从这里，连接整个公司的智慧。</small></div>
        <div class="entry-welcome" aria-hidden="true"><span>WELCOME TO</span><strong>YOUR NEXT<br><em>GREAT IDEA.</em></strong><small>公司大脑 · 工作空间已就绪</small></div>
        <div class="entry-footer"><div><div class="entry-meter" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i></div><span class="entry-step">[ 01 / 04 ] CONNECTION</span></div><span class="entry-footer-note">你的对话与草稿保留在本机</span><div class="entry-signature">CORPORATE BRAIN<span>INTELLIGENCE WORKSPACE <b>■</b></span></div></div>
        <div class="entry-progress" aria-hidden="true"><i></i></div>
        <div class="entry-intro" aria-hidden="true"><div class="entry-intro-mark">${mark}<span>CORPORATE BRAIN</span><small>把智慧，连接成一个整体。</small></div><div class="entry-intro-line"></div></div>
        <div class="entry-wash" aria-hidden="true"></div>
        <div class="entry-shutters" aria-hidden="true">${Array.from({ length: 10 }, (_, i) => `<i style="--shutter:${i}"></i>`).join("")}</div>`;
      this.renderState();
    }
    disconnectedCallback() {
      clearTimeout(this.introTimer);
    }
    attributeChangedCallback() {
      if (this.built) this.renderState();
    }
    renderState() {
      const phase = this.getAttribute("phase") || "connecting";
      const content = {
        connecting: [
          "ESTABLISHING CONNECTION",
          "正在连接公司工作空间",
          "[ 01 / 04 ] CONNECTION",
        ],
        retrying: ["RECONNECTING", "正在重新建立连接", "[ 01 / 04 ] RECONNECT"],
        auth: ["WORKSPACE ACCESS", "登录公司账号", "[ 02 / 04 ] SIGN IN"],
        verifying: [
          "VERIFYING YOUR ACCOUNT",
          "正在验证公司账号",
          "[ 02 / 04 ] VERIFYING",
        ],
        profile: [
          "PREPARING YOUR WORKSPACE",
          "正在读取本机记录",
          "[ 03 / 04 ] LOCAL WORKSPACE",
        ],
        ready: ["WORKSPACE READY", "欢迎回来", "[ 04 / 04 ] READY"],
        error: [
          "CONNECTION PAUSED",
          "暂时无法连接公司服务器",
          "[ -- / 04 ] RETRY AVAILABLE",
        ],
      }[phase] || ["STARTUP PREVIEW", "公司大脑", "PREVIEW"];
      this.querySelector(".entry-kicker").textContent = content[0];
      this.querySelector(".entry-headline").textContent =
        this.getAttribute("headline") || content[1];
      this.querySelector(".entry-detail").textContent =
        this.getAttribute("detail") || "";
      this.querySelector(".entry-step").textContent = content[2];
    }
    start(elapsed = 0, skip = false) {
      clearTimeout(this.introTimer);
      this.classList.remove("entry-playing", "entry-skipped");
      void this.offsetWidth;
      this.classList.add("entry-playing");
      const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
      if (skip || reduced || elapsed >= 3600) {
        this.skip();
        return;
      }
      for (const animation of this.getAnimations({ subtree: true }))
        animation.currentTime = Math.max(0, elapsed);
      this.introTimer = setTimeout(
        () => {
          this.dataset.introDone = "true";
          this.dispatchEvent(new Event("entry-intro-end", { bubbles: true }));
        },
        3600 - Math.max(0, elapsed),
      );
    }
    skip() {
      clearTimeout(this.introTimer);
      this.classList.add("entry-skipped");
      this.dataset.introDone = "true";
      this.dispatchEvent(new Event("entry-intro-end", { bubbles: true }));
    }
  }
  customElements.define("brain-entry-scene", EntryScene);
})();
