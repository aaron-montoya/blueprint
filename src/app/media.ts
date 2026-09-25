import { useSyncExternalStore } from 'react';

/** Live result of a CSS media query. */
export function useMedia(query: string): boolean {
  return useSyncExternalStore(
    (cb) => {
      const m = window.matchMedia(query);
      m.addEventListener('change', cb);
      return () => m.removeEventListener('change', cb);
    },
    () => window.matchMedia(query).matches,
    () => false,
  );
}

/** Narrow screens (phones, small tablets): sidebars become drawers. */
export const COMPACT_QUERY = '(max-width: 900px)';
/** Touch screens: one finger pans, taps add parts, bigger hit targets. */
export const TOUCH_QUERY = '(pointer: coarse)';

export const useCompact = () => useMedia(COMPACT_QUERY);
export const useTouch = () => useMedia(TOUCH_QUERY);
export const isTouch = () => window.matchMedia(TOUCH_QUERY).matches;
