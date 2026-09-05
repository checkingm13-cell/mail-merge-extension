/**
 * IDBStore - Self-contained zero-dependency IndexedDB storage library
 * Designed for Chrome Extensions (Background Service Worker, Content Scripts, Popup, Dashboard)
 */
(function (root) {
  'use strict';

  if (root.IDBStore && typeof root.IDBStore.init === 'function') {
    return;
  }

  const DB_NAME = 'GmailMailMergeDB';
  const DB_VERSION = 1;

  let dbInstance = null;
  let initPromise = null;

  const DEFAULT_TEMPLATES = [
    {
      id: 'template-starter',
      name: 'Welcome & Introduction',
      subject: 'Hello {{First Name}}, quick update on {{Project}}',
      body: 'Hi {{First Name}},\n\nI wanted to reach out regarding {{Project}}.\n\nBest regards,\n{{Sender Name}}',
      createdAt: new Date().toISOString()
    }
  ];

  function generateId(prefix = 'id') {
    return `${prefix}_${typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : Date.now()}`;
  }

  const IDBStore = {
    /**
     * Initializes the IndexedDB database, creates stores and indexes, and seeds defaults.
     * @returns {Promise<IDBDatabase>}
     */
    async init() {
      if (dbInstance) {
        return dbInstance;
      }
      if (initPromise) {
        return initPromise;
      }

      initPromise = new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);

        request.onupgradeneeded = (event) => {
          const db = event.target.result;

          // 1. campaigns store
          if (!db.objectStoreNames.contains('campaigns')) {
            const campaignsStore = db.createObjectStore('campaigns', { keyPath: 'id' });
            campaignsStore.createIndex('status', 'status', { unique: false });
            campaignsStore.createIndex('scheduledAt', 'scheduledAt', { unique: false });
            campaignsStore.createIndex('createdAt', 'createdAt', { unique: false });
          }

          // 2. templates store
          if (!db.objectStoreNames.contains('templates')) {
            const templatesStore = db.createObjectStore('templates', { keyPath: 'id' });
            templatesStore.createIndex('name', 'name', { unique: false });
            templatesStore.createIndex('createdAt', 'createdAt', { unique: false });
          }

          // 3. logs store
          if (!db.objectStoreNames.contains('logs')) {
            const logsStore = db.createObjectStore('logs', { keyPath: 'id', autoIncrement: true });
            logsStore.createIndex('campaignId', 'campaignId', { unique: false });
            logsStore.createIndex('timestamp', 'timestamp', { unique: false });
          }

          // 4. settings store
          if (!db.objectStoreNames.contains('settings')) {
            db.createObjectStore('settings', { keyPath: 'key' });
          }
        };

        request.onsuccess = async (event) => {
          dbInstance = event.target.result;

          dbInstance.onversionchange = () => {
            dbInstance.close();
            dbInstance = null;
            initPromise = null;
          };

          try {
            await IDBStore._seedTemplatesIfEmpty(dbInstance);
            resolve(dbInstance);
          } catch (seedErr) {
            console.warn('[IDBStore] Template seeding warning:', seedErr);
            resolve(dbInstance);
          }
        };

        request.onerror = (event) => {
          console.error('[IDBStore] Error opening IndexedDB:', event.target.error);
          initPromise = null;
          reject(event.target.error);
        };
      });

      return initPromise;
    },

    /**
     * Seed canned templates if the templates store is empty
     * @private
     */
    async _seedTemplatesIfEmpty(db) {
      return new Promise((resolve, reject) => {
        const tx = db.transaction('templates', 'readwrite');
        const store = tx.objectStore('templates');
        const countReq = store.count();

        countReq.onsuccess = () => {
          if (countReq.result === 0) {
            for (const tpl of DEFAULT_TEMPLATES) {
              store.put(tpl);
            }
          }
        };

        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
      });
    },

    /**
     * Executes a transaction on an object store
     * @private
     */
    async _transaction(storeName, mode, callback) {
      const db = await this.init();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(storeName, mode);
        const store = tx.objectStore(storeName);

        let result;
        tx.oncomplete = () => resolve(result);
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);

        try {
          result = callback(store, tx);
        } catch (err) {
          reject(err);
        }
      });
    },

    // =========================================================================
    // CAMPAIGNS
    // =========================================================================

    /**
     * Saves or creates a campaign.
     * @param {Object} campaign
     * @returns {Promise<Object>}
     */
    async saveCampaign(campaign) {
      if (!campaign || typeof campaign !== 'object') {
        throw new Error('Invalid campaign object provided.');
      }
      const record = {
        ...campaign,
        id: campaign.id || generateId('camp'),
        status: campaign.status || 'DRAFT',
        dryRun: campaign.dryRun !== undefined ? !!campaign.dryRun : true,
        createdAt: campaign.createdAt || new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };

      await this._transaction('campaigns', 'readwrite', (store) => {
        store.put(record);
      });

      return record;
    },

    /**
     * Retrieves all campaigns, sorted latest first.
     * @returns {Promise<Array<Object>>}
     */
    async getCampaigns() {
      const campaigns = await this._transaction('campaigns', 'readonly', (store) => {
        return new Promise((resolve, reject) => {
          const req = store.getAll();
          req.onsuccess = () => resolve(req.result || []);
          req.onerror = () => reject(req.error);
        });
      });

      // Auto-heal any campaigns that had completed successfully but were stomped to FAILED by duplicate triggers
      try {
        const recentLogs = await this._transaction('logs', 'readonly', (store) => {
          return new Promise((resolve) => {
            const req = store.getAll();
            req.onsuccess = () => resolve(req.result || []);
            req.onerror = () => resolve([]);
          });
        });

        for (const camp of campaigns) {
          if (camp.status === 'FAILED') {
            const campLogs = recentLogs.filter((l) => l.campaignId === camp.id);
            const hasSuccess = campLogs.some((l) => (l.message || '').includes('Native Send All triggered successfully'));
            if (hasSuccess) {
              console.log(`[IDBStore] Auto-healing completed campaign ${camp.id} from FAILED back to COMPLETED`);
              camp.status = 'COMPLETED';
              camp.errorMessage = null;
              if (!camp.completedAt) {
                const succLog = campLogs.find((l) => (l.message || '').includes('Native Send All triggered successfully'));
                camp.completedAt = succLog ? succLog.timestamp : (camp.updatedAt || new Date().toISOString());
              }
              this._transaction('campaigns', 'readwrite', (store) => {
                store.put(camp);
              }).catch(() => {});
            }
          }
        }
      } catch (err) {
        console.warn('[IDBStore] Auto-heal check non-critical error:', err);
      }

      return campaigns.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
    },

    /**
     * Retrieves a campaign by its ID.
     * @param {string} id
     * @returns {Promise<Object|null>}
     */
    async getCampaignById(id) {
      if (!id) return null;
      return this._transaction('campaigns', 'readonly', (store) => {
        return new Promise((resolve, reject) => {
          const req = store.get(id);
          req.onsuccess = () => resolve(req.result || null);
          req.onerror = () => reject(req.error);
        });
      });
    },

    /**
     * Updates an existing campaign with the provided partial object.
     * @param {string} id
     * @param {Object} updates
     * @returns {Promise<Object>}
     */
    async updateCampaign(id, updates) {
      const existing = await this.getCampaignById(id);
      if (!existing) {
        throw new Error(`Campaign with id "${id}" not found.`);
      }

      const cleanUpdates = { ...updates };

      // Safety guard: A completed campaign cannot regress to FAILED or PROCESSING
      if (existing.status === 'COMPLETED' && (cleanUpdates.status === 'FAILED' || cleanUpdates.status === 'PROCESSING')) {
        console.warn(`[IDBStore] Rejecting status regression for campaign ${id}: ${existing.status} -> ${cleanUpdates.status}`);
        delete cleanUpdates.status;
        delete cleanUpdates.errorMessage;
      }

      const updated = {
        ...existing,
        ...cleanUpdates,
        id, // Ensure id cannot be overwritten
        updatedAt: new Date().toISOString()
      };

      await this._transaction('campaigns', 'readwrite', (store) => {
        store.put(updated);
      });

      return updated;
    },

    /**
     * Deletes a campaign by ID.
     * @param {string} id
     * @returns {Promise<boolean>}
     */
    async deleteCampaign(id) {
      await this._transaction('campaigns', 'readwrite', (store) => {
        store.delete(id);
      });
      return true;
    },

    /**
     * Returns campaigns where status === 'QUEUED' and scheduledAt <= now.
     * @returns {Promise<Array<Object>>}
     */
    async getDueCampaigns() {
      const all = await this.getCampaigns();
      const now = Date.now();

      return all.filter((camp) => {
        if (camp.status !== 'QUEUED') return false;
        if (!camp.scheduledAt) return true; // Immediately due if no schedule date specified
        const scheduledTime = new Date(camp.scheduledAt).getTime();
        return !isNaN(scheduledTime) && scheduledTime <= now;
      });
    },

    // =========================================================================
    // TEMPLATES
    // =========================================================================

    /**
     * Saves or creates a template.
     * @param {Object} template
     * @returns {Promise<Object>}
     */
    async saveTemplate(template) {
      if (!template || typeof template !== 'object') {
        throw new Error('Invalid template object provided.');
      }
      const record = {
        ...template,
        id: template.id || generateId('tpl'),
        createdAt: template.createdAt || new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };

      await this._transaction('templates', 'readwrite', (store) => {
        store.put(record);
      });

      return record;
    },

    /**
     * Retrieves all templates.
     * @returns {Promise<Array<Object>>}
     */
    async getTemplates() {
      const templates = await this._transaction('templates', 'readonly', (store) => {
        return new Promise((resolve, reject) => {
          const req = store.getAll();
          req.onsuccess = () => resolve(req.result || []);
          req.onerror = () => reject(req.error);
        });
      });

      return templates.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
    },

    /**
     * Deletes a template by ID.
     * @param {string} id
     * @returns {Promise<boolean>}
     */
    async deleteTemplate(id) {
      await this._transaction('templates', 'readwrite', (store) => {
        store.delete(id);
      });
      return true;
    },

    // =========================================================================
    // LOGS
    // =========================================================================

    /**
     * Adds an audit/activity log entry.
     * @param {string|null} campaignId
     * @param {string} level - 'INFO' | 'WARN' | 'ERROR' | 'SUCCESS'
     * @param {string} message
     * @returns {Promise<Object>}
     */
    async addLog(campaignId, level = 'INFO', message = '') {
      const logRecord = {
        campaignId: campaignId || null,
        level: level.toUpperCase(),
        message: String(message),
        timestamp: new Date().toISOString()
      };

      const id = await this._transaction('logs', 'readwrite', (store) => {
        return new Promise((resolve, reject) => {
          const req = store.add(logRecord);
          req.onsuccess = () => resolve(req.result);
          req.onerror = () => reject(req.error);
        });
      });

      return { ...logRecord, id };
    },

    /**
     * Retrieves the latest logs up to limit.
     * @param {number} limit
     * @returns {Promise<Array<Object>>}
     */
    async getLogs(limit = 100) {
      const allLogs = await this._transaction('logs', 'readonly', (store) => {
        return new Promise((resolve, reject) => {
          const req = store.getAll();
          req.onsuccess = () => resolve(req.result || []);
          req.onerror = () => reject(req.error);
        });
      });

      return allLogs
        .sort((a, b) => new Date(b.timestamp || 0) - new Date(a.timestamp || 0))
        .slice(0, limit);
    },

    /**
     * Clears all log entries.
     * @returns {Promise<boolean>}
     */
    async clearLogs() {
      await this._transaction('logs', 'readwrite', (store) => {
        store.clear();
      });
      return true;
    },

    // =========================================================================
    // SETTINGS
    // =========================================================================

    /**
     * Retrieves a stored setting value.
     * @param {string} key
     * @param {*} defaultValue
     * @returns {Promise<*>}
     */
    async getSetting(key, defaultValue = null) {
      if (!key) return defaultValue;
      const record = await this._transaction('settings', 'readonly', (store) => {
        return new Promise((resolve, reject) => {
          const req = store.get(key);
          req.onsuccess = () => resolve(req.result || null);
          req.onerror = () => reject(req.error);
        });
      });

      return record && record.value !== undefined ? record.value : defaultValue;
    },

    /**
     * Sets a key-value setting.
     * @param {string} key
     * @param {*} value
     * @returns {Promise<*>}
     */
    async setSetting(key, value) {
      if (!key) throw new Error('Setting key is required.');
      const record = {
        key,
        value,
        updatedAt: new Date().toISOString()
      };

      await this._transaction('settings', 'readwrite', (store) => {
        store.put(record);
      });

      return value;
    }
  };

  // Expose to window / globalThis / self / module
  root.IDBStore = IDBStore;
  if (typeof window !== 'undefined') {
    window.IDBStore = IDBStore;
  }
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = IDBStore;
  }
})(typeof globalThis !== 'undefined' ? globalThis : (typeof self !== 'undefined' ? self : this));
