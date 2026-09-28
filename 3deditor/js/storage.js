/**
 * IndexedDB Storage Helper for caching the last loaded GLB file and session state.
 * Supports large binary files (ArrayBuffer) across page refreshes and browser restarts.
 */
const DB_NAME = 'GLBStudioDB';
const DB_VERSION = 1;
const STORE_NAME = 'last_session';
const RECORD_KEY = 'latest_model';

function openDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };

    request.onsuccess = (event) => {
      resolve(event.target.result);
    };

    request.onerror = (event) => {
      console.error('IndexedDB open error:', event.target.error);
      reject(event.target.error);
    };
  });
}

export class SessionStorage {
  /**
   * Save the last loaded model binary and metadata
   * @param {string} fileName 
   * @param {ArrayBuffer} arrayBuffer 
   * @param {boolean} isSample 
   */
  static async saveLastModel(fileName, arrayBuffer, isSample = false) {
    try {
      const db = await openDB();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);

        const data = {
          fileName,
          arrayBuffer,
          isSample,
          updatedAt: Date.now()
        };

        const putReq = store.put(data, RECORD_KEY);
        putReq.onsuccess = () => resolve(true);
        putReq.onerror = (err) => reject(err);
      });
    } catch (err) {
      console.warn('Failed to save session to IndexedDB:', err);
      return false;
    }
  }

  /**
   * Retrieve the last loaded model from storage
   * @returns {Promise<{ fileName: string, arrayBuffer: ArrayBuffer, isSample: boolean } | null>}
   */
  static async getLastModel() {
    try {
      const db = await openDB();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readonly');
        const store = tx.objectStore(STORE_NAME);
        const getReq = store.get(RECORD_KEY);

        getReq.onsuccess = () => {
          resolve(getReq.result || null);
        };
        getReq.onerror = (err) => reject(err);
      });
    } catch (err) {
      console.warn('Failed to read session from IndexedDB:', err);
      return null;
    }
  }

  /**
   * Clear cached model session
   */
  static async clearSession() {
    try {
      const db = await openDB();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        const delReq = store.delete(RECORD_KEY);
        delReq.onsuccess = () => resolve(true);
        delReq.onerror = (err) => reject(err);
      });
    } catch (err) {
      console.warn('Failed to clear session from IndexedDB:', err);
      return false;
    }
  }
}
