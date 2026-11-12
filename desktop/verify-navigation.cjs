// Legacy QA scenarios express a plain reload as a short script. Wait for the
// real new document so persistence checks cannot accidentally inspect old DOM.
module.exports = async function executeQaScript(web, source) {
  const navigation = /^\s*(?:location\.hash\s*=\s*(["'])([^"']*)\1\s*;\s*)?location\.reload\(\)\s*;?\s*(true)?\s*;?\s*$/.exec(source);
  if (!navigation) return web.executeJavaScript(source, true);
  if (navigation[2] !== undefined)
    await web.executeJavaScript(`location.hash=${JSON.stringify(navigation[2])};true`, true);
  await new Promise((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timer);
      web.removeListener("did-finish-load", loaded);
      web.removeListener("did-fail-load", failed);
      web.removeListener("destroyed", destroyed);
    };
    const finish = (error) => {
      cleanup();
      error ? reject(error) : resolve();
    };
    const loaded = () => finish();
    const failed = (_event, code, description, _url, main) => {
      if (main) finish(Error(`QA reload failed: ${code} ${description}`));
    };
    const destroyed = () => finish(Error("QA window closed during reload"));
    const timer = setTimeout(() => finish(Error("QA reload did not finish")), 15000);
    web.once("did-finish-load", loaded);
    web.on("did-fail-load", failed);
    web.once("destroyed", destroyed);
    try { web.reload(); } catch (error) { finish(error); }
  });
  return navigation[3] ? true : undefined;
};
