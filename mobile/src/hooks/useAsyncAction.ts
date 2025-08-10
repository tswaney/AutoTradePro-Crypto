
import { useCallback, useState } from "react";

export function useAsyncAction<T extends any[]>(fn: (...args: T) => Promise<void>) {
  const [busy, setBusy] = useState(false);
  const run = useCallback(async (...args: T) => {
    if (busy) return;
    setBusy(true);
    try { await fn(...args); }
    finally { setBusy(false); }
  }, [busy, fn]);
  return { busy, run };
}
