// In-browser data store for DEMO MODE. Holds the generated dataset, persists
// mutations to localStorage, and exposes a small query/mutation surface the
// TanStack Query hooks call. In live mode the hooks talk to Supabase instead;
// this store is the zero-credential fallback.

import { generateDemoData, type DemoDataset } from './demo/generate';

const STORAGE_KEY = 'compass-demo-v4';

function load(): DemoDataset {
  if (typeof localStorage !== 'undefined') {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      try {
        return JSON.parse(raw) as DemoDataset;
      } catch {
        /* fall through to regenerate */
      }
    }
  }
  const fresh = generateDemoData();
  persist(fresh);
  return fresh;
}

let db: DemoDataset = load();

function persist(data: DemoDataset = db) {
  if (typeof localStorage !== 'undefined') {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch {
      /* quota — ignore, keep in memory */
    }
  }
}

export function resetDemoData() {
  db = generateDemoData();
  persist();
}

export function getDb(): DemoDataset {
  return db;
}

// crude id generator for new rows created in the UI
let seq = 1;
export function newId(prefix: string): string {
  return `${prefix}_new_${Date.now().toString(36)}_${seq++}`;
}

// Generic table accessors -----------------------------------------------------
export type TableName = keyof DemoDataset;

export function all<K extends TableName>(table: K): DemoDataset[K] {
  return db[table];
}

export function insert<K extends TableName>(table: K, row: DemoDataset[K][number]) {
  (db[table] as unknown[]).unshift(row);
  persist();
  return row;
}

export function update<K extends TableName>(
  table: K,
  id: string,
  patch: Partial<DemoDataset[K][number]>
) {
  const arr = db[table] as { id: string }[];
  const idx = arr.findIndex((r) => r.id === id);
  if (idx >= 0) {
    arr[idx] = { ...arr[idx], ...patch };
    persist();
    return arr[idx] as DemoDataset[K][number];
  }
  return null;
}

export function remove<K extends TableName>(table: K, id: string) {
  const arr = db[table] as { id: string }[];
  const idx = arr.findIndex((r) => r.id === id);
  if (idx >= 0) {
    arr.splice(idx, 1);
    persist();
  }
}
