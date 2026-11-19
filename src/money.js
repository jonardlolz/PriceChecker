import { useEffect, useMemo, useState } from 'react';
import { api } from './api.js';

let cached;
const loadConfig = () => (cached ??= api.config().catch(() => ({ currency: 'PHP' })));

/** Returns a formatter for prices in the server-configured currency (CURRENCY env var). */
export function useMoney() {
  const [currency, setCurrency] = useState('PHP');
  useEffect(() => {
    loadConfig().then((c) => setCurrency(c.currency));
  }, []);
  return useMemo(() => {
    const fmt = new Intl.NumberFormat(undefined, { style: 'currency', currency });
    return (n) => fmt.format(n);
  }, [currency]);
}
