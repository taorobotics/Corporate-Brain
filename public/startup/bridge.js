// Decorative sequence only. The parent starts it after actual account and
// device-profile checks; this document has no auth, files or permission bridge.
(() => {
  const params = new URLSearchParams(location.search);
  const theme = params.get('theme') === 'dark' ? 'dark' : 'light';
  const token = params.get('token');
  document.documentElement.dataset.theme = theme;
  window.__DSH_STARTUP__ = {
    enabled: true, mode: 'always', theme, speed: 1.7,
    requireInteraction: false, allowSkip: true, sound: false, voice: false,
    voiceSource: 'tts', sfx: 'synth', identity: '公司成员',
    identityId: '已登录', accessLevel: '当前账号',
    brand1: 'CORPORATE', brand2: 'CONNECTED INTELLIGENCE',
    brand3a: 'BRAIN', brand3b: 'OS', orgZh: '公司大脑', orgEn: 'CORPORATE BRAIN',
    orgSub: 'COMPANY INTELLIGENCE WORKSPACE', welcomeBox: 'CORPORATE BRAIN',
    footer: 'POWERED BY CORPORATE BRAIN',
  };
  window.__DSH_STARTUP_SCRIPT_URL__ = './runtime.js';
  const send = state => {
    if (parent !== window && token) parent.postMessage({ type: 'brain:startup', token, state }, location.origin);
  };
  let observed;
  const observer = new MutationObserver(() => {
    const root = document.getElementById('dsh-startup-root');
    if (!root || root === observed) return;
    observed = root;
    let plateSent = false;
    const sync = () => {
      const text = root.querySelector('.dsu-status-zh')?.textContent || '';
      root.dataset.companyPhase = text === '需要访问许可' ? 'grant' : text === '身份资料确认' ? 'confirm' : 'sequence';
      if (!plateSent && root.querySelector('.dsu-brand.dsu-in')) { plateSent = true; send('plate'); }
    };
    const changes = new MutationObserver(sync);
    changes.observe(root, { subtree: true, childList: true, attributes: true, attributeFilter: ['class'] });
    addEventListener('pagehide', () => changes.disconnect(), { once: true });
    sync();
  });
  observer.observe(document, { childList: true, subtree: true });
  addEventListener('dsh-startup:done', () => { observer.disconnect(); send('finished'); }, { once: true });
  addEventListener('error', event => {
    if (event instanceof ErrorEvent || event.target instanceof HTMLScriptElement) send('finished');
  }, true);
  const loaded = () => { if (!window.__DSH_STARTUP_API__) send('finished'); };
  document.addEventListener('DOMContentLoaded', loaded, { once: true });
  addEventListener('pagehide', () => document.removeEventListener('DOMContentLoaded', loaded), { once: true });
  addEventListener('pagehide', () => { observer.disconnect(); window.__DSH_STARTUP_API__?.dispose(); }, { once: true });
})();
