import { useEffect, useState } from 'react';

const QUERY = '(pointer: coarse)';

/** True on phones and tablets (touch is the main input), false with a mouse. */
export function useIsTouch(): boolean {
  const [touch, setTouch] = useState(() => {
    const forced = new URLSearchParams(location.search).get('touch');
    if (forced !== null) return forced !== '0';
    return window.matchMedia(QUERY).matches;
  });
  useEffect(() => {
    if (new URLSearchParams(location.search).has('touch')) return;
    const mq = window.matchMedia(QUERY);
    const on = () => setTouch(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return touch;
}
