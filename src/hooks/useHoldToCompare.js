import { useEffect, useState } from 'react';

const typing = (target) =>
  target instanceof Element &&
  Boolean(target.closest('input, textarea, select, [contenteditable="true"]'));

/** Hold D (outside text fields) to compare saved designs with automatic layouts. */
export function useHoldToCompare(code = 'KeyD') {
  const [comparing, setComparing] = useState(false);
  useEffect(() => {
    const down = (event) => {
      if (
        event.code !== code ||
        event.repeat ||
        event.ctrlKey ||
        event.metaKey ||
        event.altKey ||
        typing(event.target)
      )
        return;
      setComparing(true);
    };
    const up = (event) => event.code === code && setComparing(false);
    const reset = () => setComparing(false);
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', reset);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      window.removeEventListener('blur', reset);
    };
  }, [code]);
  return [comparing, setComparing];
}
