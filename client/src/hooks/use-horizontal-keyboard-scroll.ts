import { useCallback, useEffect, useRef } from "react";

/**
 * Gives an overflow container keyboard focus and lets the left/right arrows
 * move its wide content without requiring the user to grab the scrollbar.
 */
export function useHorizontalKeyboardScroll(enabled: boolean, stepRatio = 0.65) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (enabled) {
      requestAnimationFrame(() => ref.current?.focus({ preventScroll: true }));
    }
  }, [enabled]);

  const onKeyDown = useCallback((event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    const target = event.target as HTMLElement;
    if (target.closest("input, textarea, select, button, a, [contenteditable='true'], [role='textbox'], [role='combobox']")) return;
    event.preventDefault();
    const step = Math.max(220, Math.floor(event.currentTarget.clientWidth * stepRatio));
    event.currentTarget.scrollBy({
      left: event.key === "ArrowLeft" ? -step : step,
      behavior: "smooth",
    });
  }, [stepRatio]);

  return { ref, onKeyDown };
}