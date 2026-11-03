export async function copyText(text: string) {
  if (window.brainDesktop?.copyText) return window.brainDesktop.copyText(text);
  // Compatibility with older clients whose permission policy denies the async
  // web clipboard API. The selected-text command still requires a user action.
  if (window.brainDesktop) {
    const active = document.activeElement as HTMLElement | null;
    const selection = window.getSelection();
    const ranges = selection
      ? Array.from({ length: selection.rangeCount }, (_, i) =>
          selection.getRangeAt(i).cloneRange(),
        )
      : [];
    const input = document.createElement("textarea");
    input.value = text;
    input.setAttribute("aria-label", "复制回答文本");
    input.style.cssText = "position:fixed;left:-10000px;top:0;";
    document.body.append(input);
    try {
      input.focus();
      input.select();
      if (document.execCommand("copy")) return;
    } finally {
      input.remove();
      active?.focus({ preventScroll: true });
      selection?.removeAllRanges();
      for (const range of ranges) selection?.addRange(range);
    }
  }
  await navigator.clipboard.writeText(text);
}
