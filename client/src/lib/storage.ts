/** Browser storage that never throws (private mode, blocked storage, etc.). */
function safe(kind: 'local' | 'session') {
  const store = () => (kind === 'local' ? window.localStorage : window.sessionStorage);
  return {
    get(key: string): string | null {
      try { return store().getItem(key); } catch { return null; }
    },
    set(key: string, value: string) {
      try { store().setItem(key, value); } catch { /* ignore */ }
    },
    remove(key: string) {
      try { store().removeItem(key); } catch { /* ignore */ }
    },
  };
}

export const local = safe('local');
/** Per-tab storage: lets two tabs on one computer be two different players. */
export const session = safe('session');
