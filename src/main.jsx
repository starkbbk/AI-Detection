import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import './index.css'

// window.storage implementation replacing localStorage completely
window.storage = {
  dbPromise: new Promise((resolve, reject) => {
    const req = indexedDB.open('GodModeAppDB', 1);
    req.onupgradeneeded = e => e.target.result.createObjectStore('store');
    req.onsuccess = e => resolve(e.target.result);
    req.onerror = e => reject(e.target.error);
  }),
  async get(key) {
    const db = await this.dbPromise;
    return new Promise((resolve, reject) => {
      const tx = db.transaction('store', 'readonly');
      const req = tx.objectStore('store').get(key);
      req.onsuccess = () => resolve(req.result ? { value: req.result } : null);
      req.onerror = () => reject(req.error);
    });
  },
  async set(key, value) {
    const db = await this.dbPromise;
    return new Promise((resolve, reject) => {
      const tx = db.transaction('store', 'readwrite');
      const req = tx.objectStore('store').put(value, key);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  },
  async remove(key) {
    const db = await this.dbPromise;
    return new Promise((resolve, reject) => {
      const tx = db.transaction('store', 'readwrite');
      const req = tx.objectStore('store').delete(key);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  },
  async keys() {
    const db = await this.dbPromise;
    return new Promise((resolve, reject) => {
      const tx = db.transaction('store', 'readonly');
      const req = tx.objectStore('store').getAllKeys();
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
};

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
