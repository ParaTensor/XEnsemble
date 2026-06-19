import { useState, useCallback } from 'react';

export function useButtonLoading() {
  const [isLoading, setIsLoading] = useState(false);

  const run = useCallback(async (fn) => {
    if (isLoading) return;
    setIsLoading(true);
    try {
      return await fn();
    } finally {
      setIsLoading(false);
    }
  }, [isLoading]);

  return { isLoading, run };
}
