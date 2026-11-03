export async function api<T = any>(
  path: string,
  body?: unknown,
  method?: string,
  timeoutMs = body === undefined ? 20000 : 0,
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`/api${path}`, {
      method: method ?? (body === undefined ? "GET" : "POST"),
      credentials: "include",
      headers:
        body === undefined ? undefined : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: timeoutMs ? AbortSignal.timeout(timeoutMs) : undefined,
    });
  } catch (error) {
    if ((error as Error).name === "TimeoutError")
      throw new Error("公司服务响应超时，请检查网络后重新连接。");
    throw new Error(
      `公司服务连接失败：${(error as Error).message || "请检查网络和服务状态"}`,
    );
  }
  let result: any;
  try {
    result = await response.json();
  } catch {
    throw new Error(`公司服务返回了无法读取的响应（HTTP ${response.status}）`);
  }
  if (!response.ok)
    throw new Error(result.error ?? `请求失败 ${response.status}`);
  return result;
}
export function download(
  name: string,
  text: string,
  type = "application/json",
) {
  if (window.brainDesktop) {
    void window.brainDesktop
      .saveFile(name, text)
      .catch(() => window.alert("保存失败，请检查目录或磁盘空间。"));
    return;
  }
  const url = URL.createObjectURL(new Blob([text], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
