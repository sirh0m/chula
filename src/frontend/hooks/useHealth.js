import { useEffect, useState } from 'react';
import { api } from '@/lib/api';

export function useHealth() {
  const [health, setHealth] = useState(null);
  useEffect(() => {
    const controller = new AbortController();
    api
      .health({ signal: controller.signal })
      .then(setHealth)
      .catch(() => setHealth({ ok: false }));
    return () => controller.abort();
  }, []);
  return health;
}
