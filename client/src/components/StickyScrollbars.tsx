import { useEffect } from "react";

// Sticky horizontal scrollbar pinned to viewport bottom.
// Fixes RTL sync: bar.dir matches the container so scrollLeft semantics align
// (Chrome RTL gives negative scrollLeft; LTR proxy would break bidirectional sync).
export function StickyScrollbars() {
  useEffect(() => {
    const bars = new Map<HTMLElement, HTMLElement>(); // container → proxy bar
    let rafId = 0;

    const ensureBar = (container: HTMLElement): HTMLElement => {
      const existing = bars.get(container);
      if (existing) return existing;

      const bar = document.createElement("div");
      bar.className = "global-hscroll-bar";
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
      const vw = window.innerWidth;
      const containers = document.querySelectorAll<HTMLElement>(".overflow-x-auto");

      containers.forEach((container) => {
        if (container.closest("[role=dialog]")) return;

        const scrollable = container.scrollWidth - container.clientWidth > 2;
        const bar  = ensureBar(container);
        const inner = bar.firstElementChild as HTMLElement;
        const r = container.getBoundingClientRect();

        // Show the proxy bar only when the container's native bottom scrollbar
        // is below the viewport fold (r.bottom > vh). No need for it when the
        // native scrollbar is already visible on-screen.
        const show = scrollable && r.top < vh && r.bottom > vh && r.width > 0;

        if (show) {
          // Clamp left/width to the visible portion of the viewport.
          const left  = Math.max(0, r.left);
          const right = Math.min(vw, r.right);
          bar.style.display = "block";
          bar.style.left    = `${left}px`;
          bar.style.width   = `${right - left}px`;
          inner.style.width = `${container.scrollWidth}px`;
          if (bar.scrollLeft !== container.scrollLeft) {
            bar.scrollLeft = container.scrollLeft;
          }
        } else {
          bar.style.display = "none";
        }
      });

      // Clean up proxy bars whose containers were removed from the DOM.
      bars.forEach((bar, container) => {
        if (!document.body.contains(container)) {
          bar.remove();
          bars.delete(container);
        }
      });
    };

    // rAF loop: runs every frame so the bar tracks immediately on any scroll,
    // resize, or data-load without waiting for a MutationObserver batch.
    const loop = () => { update(); rafId = requestAnimationFrame(loop); };
    rafId = requestAnimationFrame(loop);

    // Also listen for scroll events (capture phase catches nested scrollers)
    // and resize so the bar position/width updates synchronously.
    window.addEventListener("scroll", update, { passive: true, capture: true });
    window.addEventListener("resize", update);

    return () => {
      cancelAnimationFrame(rafId);
      window.removeEventListener("scroll", update, true);
      window.removeEventListener("resize", update);
      bars.forEach((bar) => bar.remove());
      bars.clear();
    };
  }, []);

  return null;
}
