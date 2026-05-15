import { useEffect, useRef } from "react";

/**
 * Swap the browser tab favicon to a "🔴 recording" indicator while `active`
 * is true (e.g. during a render). Restores the original favicon on unmount or
 * when active flips to false.
 */
export function useDynamicFavicon(active: boolean, label = "SkyBrief — Rendering") {
  const originalRef = useRef<{ href: string; title: string } | null>(null);

  useEffect(() => {
    const link =
      (document.querySelector("link[rel~='icon']") as HTMLLinkElement | null) ||
      (() => {
        const l = document.createElement("link");
        l.rel = "icon";
        document.head.appendChild(l);
        return l;
      })();

    if (!originalRef.current) {
      originalRef.current = { href: link.href, title: document.title };
    }

    if (active) {
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><defs><radialGradient id="g" cx="50%" cy="50%" r="50%"><stop offset="0%" stop-color="#ff4b4b"/><stop offset="100%" stop-color="#7a0000"/></radialGradient></defs><circle cx="32" cy="32" r="26" fill="url(#g)"/><circle cx="32" cy="32" r="10" fill="#fff" opacity="0.92"/></svg>`;
      const url = `data:image/svg+xml;base64,${btoa(svg)}`;
      link.href = url;
      document.title = `🔴 ${label}`;
    } else if (originalRef.current) {
      link.href = originalRef.current.href;
      document.title = originalRef.current.title;
    }
  }, [active, label]);

  useEffect(() => {
    return () => {
      const link = document.querySelector("link[rel~='icon']") as HTMLLinkElement | null;
      if (link && originalRef.current) link.href = originalRef.current.href;
      if (originalRef.current) document.title = originalRef.current.title;
    };
  }, []);
}
