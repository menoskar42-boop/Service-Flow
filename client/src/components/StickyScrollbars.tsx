import { useEffect } from "react";

// Global, site-wide helper that gives every wide table an always-visible
// horizontal scrollbar pinned to the bottom of the viewport — so the user can
// scroll a table left/right without first scrolling down to reach its native
// scrollbar. It enhances every `.overflow-x-auto` container automatically
// (current and future ones), so individual report components need no changes.
//
// For each overflowing container that is in view but whose native bottom bar is
// still below the fold, a proxy scrollbar is rendered fixed at the viewport
// bottom and kept in sync (both directions) with the container's scrollLeft.
export function StickyScrollbars() {
  useEffect(() => {
    const bars = new Map<HTMLElement, HTMLElement>(); // container → proxy bar

    const ensureBar = (container: HTMLElement): HTMLElement => {
      const existing = bars.get(container);
      if (existing) return existing;

      const bar = document.createElement("div");
      bar.className = "global-hscroll-bar";
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
        // Skip tables inside modals — they scroll within their own dialog.
        if (container.closest("[role=dialog]")) return;

        const overflow = container.scrollWidth - container.clientWidth > 2;
        const bar = ensureBar(container);
        const inner = bar.firstElementChild as HTMLElement;
        const r = container.getBoundingClientRect();
        const inView = r.top < vh - 24 && r.bottom > 48;
        const nativeBarVisible = r.bottom <= vh; // native scrollbar already on screen
        const show = overflow && inView && !nativeBarVisible && r.width > 0;

        if (show) {
          bar.style.display = "block";
          bar.style.left = `${r.left}px`;
          bar.style.width = `${r.width}px`;
          inner.style.width = `${container.scrollWidth}px`;
          if (bar.scrollLeft !== container.scrollLeft) bar.scrollLeft = container.scrollLeft;
        } else {
          bar.style.display = "none";
        }
      });

      // Drop proxy bars whose container has been removed from the DOM.
      bars.forEach((bar, container) => {
        if (!document.body.contains(container)) {
          bar.remove();
          bars.delete(container);
        }
      });
    };

    // Capture-phase scroll catches scrolling inside any nested scroller too.
    window.addEventListener("scroll", update, { passive: true, capture: true });
    window.addEventListener("resize", update);
    const mo = new MutationObserver(update);
    mo.observe(document.body, { childList: true, subtree: true });
    const interval = window.setInterval(update, 500); // catch async data/size changes
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
