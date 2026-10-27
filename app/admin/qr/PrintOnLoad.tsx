'use client';

import { useEffect } from 'react';

export function PrintOnLoad() {
  useEffect(() => {
    const t = setTimeout(() => window.print(), 600);
    return () => clearTimeout(t);
  }, []);
  return null;
}
