import { useEffect } from "react";

// Global sticky horizontal scrollbar pinned to viewport bottom.
// Solves two problems in this RTL Arabic app:
// 1. Wide tables require scrolling to the native scrollbar (off-screen).
// 2. dir="rtl" on the dashboard means scrollLeft semantics differ between the
//    container (RTL) and a naively-created proxy bar (LTR on document.body).
//    Fix: set bar.dir to match the container so scrollLeft values are in sync.
export function StickyScrollbars() {
  useEffect(() => {
    const bars = new Map<HTMLElement, HTMLElement>(); // container → proxy bar

    const ensureBar = (container: HTMLElement): HTMLElement => {
      const existing = bars.get(container);
      if (existing) return existing;

      const bar = document.createElement("div");
      bar.className = "global-hscroll-bar";

      // Match the container's text direction so scrollLeft semantics are identical
      // (RTL containers in Chrome have negative scrollLeft; proxy must match).
      bar.dir = getComputedStyle(container).direction;

      const inner = document.createElement("div");
      inner.style.height = "1px";
      bar.appendChild(inner);
      document.body.appendChild(bar);

      let syncing = false;
      bar.addEventListener("scroll", () => {
        if (syncing) return;
        syncing = true;
        container.scrollLeft = bar.scrollLeft;
        syncing = false;
      }, { passive: true });
      container.addEventListener("scroll", () => {
        if (syncing) return;
        syncing = true;
        bar.scrollLeft = container.scrollLeft;
        syncing = false;
      }, { passive: true });

      bars.set(container, bar);
      return bar;
    };

    const update = () => {
      const vh = window.innerHeight;
      const containers = document.querySelectorAll<HTMLElement>(".overflow-x-auto");
      containers.forEach((container) => {
        if (container.closest("[role=dialog]")) return;

        const overflow = container.scrollWidth - container.clientWidth > 2;
        const bar = ensureBar(container);
        const inner = bar.firstElementChild as HTMLElement;
        const r = container.getBoundingClientRect();
        const inView = r.top < vh - 16 && r.bottom > 32 && r.width > 0;
        const show = overflow && inView;

        if (show) {
          bar.style.display = "block";
          bar.style.left   = `${r.left}px`;
          bar.style.width  = `${r.width}px`;
          inner.style.width = `${container.scrollWidth}px`;
          // Keep proxy in sync (direction-aware — both bar and container share dir).
          if (bar.scrollLeft !== container.scrollLeft) {
            bar.scrollLeft = container.scrollLeft;
          }
        } else {
          bar.style.display = "none";
        }
      });

      // Clean up proxy bars for removed containers.
      bars.forEach((bar, container) => {
        if (!document.body.contains(container)) {
          bar.remove();
          bars.delete(container);
        }
      });
    };

    window.addEventListener("scroll", update, { passive: true, capture: true });
    window.addEventListener("resize", update);
    const mo = new MutationObserver(update);
    mo.observe(document.body, { childList: true, subtree: true });
    const interval = window.setInterval(update, 300);
    update();

    return () => {
      window.removeEventListener("scroll", update, true);
      window.removeEventListener("resize", update);
      mo.disconnect();
      window.clearInterval(interval);
      bars.forEach((bar) => bar.remove());
      bars.clear();
    };
  }, []);

  return null;
}
