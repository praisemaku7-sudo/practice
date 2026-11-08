// Talks to your own Pocket Ledger sync server (see server/ and docs/BANK_LINKING.md).
export function client({ url, token }) {
  if (!url || !token) throw new Error('Add your sync server address and app token first.');
  const base = url.replace(/\/+$/, '');
  const call = async (path, opts = {}) => {
    let res;
    try {
      res = await fetch(base + path, { ...opts, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(opts.headers || {}) } });
    } catch { throw new Error("Couldn't reach your sync server. Check the address and that you're online."); }
    const data = await res.json().catch(() => ({}));
    if (res.status === 401) throw new Error('The sync server rejected the app token.');
    if (!res.ok) throw new Error(data.error || `Sync server error ${res.status}`);
    return data;
  };
  return {
    health: () => call('/health'),
    banks: (country = 'GB') => call(`/banks?country=${country}`),
    connect: (bank, redirect, country = 'GB') => call('/connect', { method: 'POST', body: JSON.stringify({ bank, country, redirect }) }),
    transactions: (uid, from) => call(`/transactions?account=${encodeURIComponent(uid)}${from ? `&from=${from}` : ''}`),
    inbox: () => call('/inbox'),
    ack: (ids) => call('/inbox/ack', { method: 'POST', body: JSON.stringify({ ids }) }),
    disconnect: (id) => call(`/sessions/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  };
}

/** Where to start fetching: a week before the last sync (catches late-posting payments), else the tracking start. */
export function syncFrom(lastSync, trackFrom, today) {
  if (lastSync) {
    const d = new Date(Date.parse(lastSync + 'T00:00:00Z') - 7 * 86400000).toISOString().slice(0, 10);
    return trackFrom && d < trackFrom ? trackFrom : d;
  }
  return trackFrom || new Date(Date.parse(today + 'T00:00:00Z') - 90 * 86400000).toISOString().slice(0, 10);
}
