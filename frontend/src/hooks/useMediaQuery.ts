import { useSyncExternalStore } from "react";

/** True while the CSS media query matches, e.g. useMediaQuery("(max-width: 759px)"). */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const mql = window.matchMedia(query);
      mql.addEventListener("change", onChange);
      return () => mql.removeEventListener("change", onChange);
    },
    () => window.matchMedia(query).matches
  );
}
