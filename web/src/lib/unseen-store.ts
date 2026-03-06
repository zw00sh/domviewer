/**
 * localStorage-persisted store tracking the last time the user viewed each payload panel.
 * Used to drive "unseen data" green dots on DB-backed tool icons.
 *
 * Storage key: "dv_last_viewed"
 * Shape: Record<clientId, Record<payloadName, timestampMs>>
 */

const STORAGE_KEY = "dv_last_viewed";

type ViewedStore = Record<string, Record<string, number>>;

function loadStore(): ViewedStore {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
  } catch {
    return {};
  }
}

function saveStore(store: ViewedStore) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
  } catch {
    // Ignore write failures (e.g. storage quota exceeded, private mode)
  }
}

/**
 * Record that the user viewed the payload panel for a given client.
 * Sets the last-viewed timestamp to now.
 * @param clientId - Client UUID
 * @param payloadName - Payload key (e.g. "spider", "keylogger", "cookies")
 */
export function markViewed(clientId: string, payloadName: string) {
  const store = loadStore();
  if (!store[clientId]) store[clientId] = {};
  store[clientId][payloadName] = Date.now();
  saveStore(store);
}

/**
 * Returns true if `lastDataAt` is more recent than the last time the user viewed this payload.
 * A return value of true means there is unseen data to show.
 * @param clientId - Client UUID
 * @param payloadName - Payload key
 * @param lastDataAt - Unix timestamp (ms) of the most recent data entry, or 0 if no data
 */
export function hasUnseenData(
  clientId: string,
  payloadName: string,
  lastDataAt: number
): boolean {
  if (!lastDataAt) return false;
  const store = loadStore();
  const lastViewed = store[clientId]?.[payloadName] ?? 0;
  return lastDataAt > lastViewed;
}
