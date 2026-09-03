import { useCallback, useEffect, useRef } from "react";

/**
 * Gives an overflow container keyboard focus and lets the left/right arrows
 * move its wide content without requiring the user to grab the scrollbar.
 */
export function useHorizontalKeyboardScroll(enabled: boolean, stepRatio = 0.65) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!enabled) return;
    const focusTable = () => ref.current?.focus({ preventScroll: true });
    const isInteractive = (target: EventTarget | null) =>
      target instanceof Element &&
      !!target.closest("input, textarea, select, button, a, [contenteditable='true'], [role='textbox'], [role='combobox']");
    const scrollTable = (event: KeyboardEvent) => {
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      if (event.altKey || event.ctrlKey || event.metaKey || isInteractive(event.target)) return;
      const element = ref.current;
      if (!element || element.scrollWidth <= element.clientWidth) return;
      event.preventDefault();
      event.stopPropagation();
      const step = Math.max(220, Math.floor(element.clientWidth * stepRatio));
      const delta = event.key === "ArrowLeft" ? -step : step;
      element.scrollTo({ left: element.scrollLeft + delta, behavior: "smooth" });
    };

    // Radix Dialog may move focus after the first animation frame. The
    // capture listener keeps the arrows working from anywhere in the dialog.
    requestAnimationFrame(focusTable);
    window.addEventListener("keydown", scrollTable, true);
    return () => window.removeEventListener("keydown", scrollTable, true);
  }, [enabled]);

  const onKeyDown = useCallback((event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    const target = event.target as HTMLElement;
    if (target.closest("input, textarea, select, button, a, [contenteditable='true'], [role='textbox'], [role='combobox']")) return;
    event.preventDefault();
    const step = Math.max(220, Math.floor(event.currentTarget.clientWidth * stepRatio));
    event.currentTarget.scrollTo({
      left: event.currentTarget.scrollLeft + (event.key === "ArrowLeft" ? -step : step),
      behavior: "smooth",
    });
  }, [stepRatio]);

  return { ref, onKeyDown };
}