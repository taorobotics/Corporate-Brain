import { useCallback, useLayoutEffect, useRef, useState } from "react";

// Follow rendered size, including streaming text, images and expanded details.
// User navigation pauses following until they return to the end or send again.
export function useChatScroll(conversationKey: string | null, nearEnd = 48) {
  const containerRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const following = useRef(true);
  const previousTop = useRef(0);
  const [showLatest, setShowLatest] = useState(false);
  const jumpToLatest = useCallback(() => {
    following.current = true;
    const container = containerRef.current;
    if (container) {
      container.scrollTop = container.scrollHeight;
      previousTop.current = container.scrollTop;
    }
    setShowLatest(false);
  }, []);

  useLayoutEffect(() => {
    const container = containerRef.current;
    const content = contentRef.current;
    if (conversationKey === null || !container || !content) return;
    let frame = 0;
    let touchY = 0;
    let previousHeight = container.scrollHeight;
    let previousViewport = container.clientHeight;
    const distance = () =>
      container.scrollHeight - container.clientHeight - container.scrollTop;
    const updateHint = () => setShowLatest(distance() > nearEnd);
    // Nested process panels own their wheel/touch/keyboard navigation. Reading
    // the process must not pause the surrounding conversation's follow state.
    const ownsEvent = (event: Event) =>
      !(event.target instanceof Element) ||
      !event.target.closest("[data-chat-scroll]") ||
      event.target.closest("[data-chat-scroll]") === container;
    const pause = () => {
      following.current = false;
    };
    const schedule = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        if (following.current) {
          // Do not queue smooth animations for each token or steal focus.
          container.scrollTop = container.scrollHeight;
          previousTop.current = container.scrollTop;
        }
        previousHeight = container.scrollHeight;
        previousViewport = container.clientHeight;
        updateHint();
      });
    };
    const scroll = () => {
      const change = container.scrollTop - previousTop.current;
      const resized =
        previousHeight !== container.scrollHeight ||
        previousViewport !== container.clientHeight;
      // Browsers clamp scrollTop as content collapses or the viewport resizes.
      // A layout-driven upward movement is not the employee reading history.
      if (resized && following.current) schedule();
      else if (change < -1 && distance() > nearEnd) pause();
      else if (change > 1 && distance() <= nearEnd) following.current = true;
      previousTop.current = container.scrollTop;
      previousHeight = container.scrollHeight;
      previousViewport = container.clientHeight;
      updateHint();
    };
    const wheel = (event: WheelEvent) => {
      if (!ownsEvent(event)) return;
      if (event.deltaY < 0) pause();
    };
    const touchStart = (event: TouchEvent) => {
      if (!ownsEvent(event)) return;
      touchY = event.touches[0]?.clientY ?? 0;
    };
    const touchMove = (event: TouchEvent) => {
      if (!ownsEvent(event)) return;
      const y = event.touches[0]?.clientY ?? touchY;
      if (y > touchY) pause();
      touchY = y;
    };
    const keyDown = (event: KeyboardEvent) => {
      if (!ownsEvent(event)) return;
      if (
        event.target instanceof HTMLElement &&
        event.target.closest("input, textarea, [contenteditable=true]")
      )
        return;
      if (
        ["ArrowUp", "PageUp", "Home"].includes(event.key) ||
        (event.key === " " && event.shiftKey)
      )
        pause();
    };
    jumpToLatest();
    const observer = new ResizeObserver(schedule);
    observer.observe(content);
    observer.observe(container);
    container.addEventListener("scroll", scroll, { passive: true });
    container.addEventListener("wheel", wheel, { passive: true });
    container.addEventListener("touchstart", touchStart, { passive: true });
    container.addEventListener("touchmove", touchMove, { passive: true });
    container.addEventListener("keydown", keyDown);
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
      container.removeEventListener("scroll", scroll);
      container.removeEventListener("wheel", wheel);
      container.removeEventListener("touchstart", touchStart);
      container.removeEventListener("touchmove", touchMove);
      container.removeEventListener("keydown", keyDown);
    };
  }, [conversationKey, jumpToLatest, nearEnd]);

  return { containerRef, contentRef, showLatest, jumpToLatest };
}
