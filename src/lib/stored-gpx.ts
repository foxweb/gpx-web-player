const DB_NAME = "vizualizator-trekov"
const STORE = "files"
const LAST_KEY = "last-gpx"

export type StoredGpx = {
  name: string
  text: string
}

export function saveLastGpx(file: StoredGpx): Promise<void> {
  return withStore("readwrite", (store) => {
    store.put(file, LAST_KEY)
  }).then(() => undefined)
}

export async function readLastGpx(): Promise<StoredGpx | null> {
  let stored: unknown
  await withStore("readonly", (store) => {
    const request = store.get(LAST_KEY)
    request.onsuccess = () => {
      stored = request.result
    }
    return request
  })
  return isStoredGpx(stored) ? stored : null
}

export function clearLastGpx(): Promise<void> {
  return withStore("readwrite", (store) => {
    store.delete(LAST_KEY)
  }).then(() => undefined)
}

function withStore(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => void,
): Promise<void> {
  return openDb().then(
    (db) =>
      new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORE, mode)
        run(tx.objectStore(STORE))
        tx.oncomplete = () => {
          db.close()
          resolve()
        }
        tx.onerror = () => {
          db.close()
          reject(tx.error)
        }
        tx.onabort = () => {
          db.close()
          reject(tx.error ?? new Error("IndexedDB transaction aborted"))
        }
      }),
  )
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE)
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

function isStoredGpx(value: unknown): value is StoredGpx {
  if (!value || typeof value !== "object") return false
  const record = value as StoredGpx
  return typeof record.name === "string" && typeof record.text === "string"
}
