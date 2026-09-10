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
  const DB_VERSION = 3;

  let dbInstance = null;
  let initPromise = null;

  const DEFAULT_TEMPLATES = [
    {
      id: 'template-ijsr-submission',
      name: 'IJSR Research Paper Submission',
      subject: 'Submit your Valuable Research for October issue',
      body: 'If your paper is ready, you can begin the submission process below.\n\nSubmit your Valuable Research for October issue:\nhttps://{{senderDomain}}/international-journal-of-scientific-research-(IJSR)/page/p/upload-your-article\n\nTo Opt Out:\nhttps://{{senderDomain}}/international-journal-of-scientific-research-(IJSR)/page/p/OptOut',
      bodyHtml: '<p style="margin: 0 0 12pt 0; font-size: 12pt; line-height: 1.15; font-family: Arial, sans-serif;">If your paper is ready, you can begin the submission process below.</p><p style="margin: 0 0 12pt 0; font-size: 12pt; line-height: 1.15; font-family: Arial, sans-serif;"><b><a href="https://{{senderDomain}}/international-journal-of-scientific-research-(IJSR)/page/p/upload-your-article" style="color: #0563c1; text-decoration: underline;"><span style="color: #3300ff;">Submit your Valuable Research for October issue</span></a></b></p><p style="margin: 0; font-size: 12pt; line-height: 1.15; font-family: Arial, sans-serif;"><a href="https://{{senderDomain}}/international-journal-of-scientific-research-(IJSR)/page/p/OptOut" style="color: #0563c1; text-decoration: underline;"><span style="color: #3300ff;">To Opt Out</span></a></p>',
      createdAt: new Date().toISOString()
    },
    {
      id: 'template-starter',
      name: 'Welcome & Introduction',
      subject: 'Hello {{First Name}}, quick update on {{Project}}',
      body: 'Hi {{First Name}},\n\nI wanted to reach out regarding {{Project}}.\n\nYou can check our details on our website (https://workspace.google.com).\n\nBest regards,\n{{Sender Name}}',
      bodyHtml: '<div style="font-family: Roboto, Arial, sans-serif; font-size: 14px; color: #202124; line-height: 1.6;"><p>Hi <b>{{First Name}}</b>,</p><p>I wanted to reach out regarding <span style="color: #1a73e8; font-weight: 600;">{{Project}}</span>.</p><p>You can check our details on <a href="https://workspace.google.com" target="_blank" style="color: #1a73e8; text-decoration: underline; font-weight: 500;">our website</a>.</p><p>Best regards,<br><b>{{Sender Name}}</b></p></div>',
      createdAt: new Date().toISOString()
    }
  ];

  function generateId(prefix = 'id') {
    const randomSuffix = Math.random().toString(36).substring(2, 7);
    return `${prefix}_${Date.now()}_${randomSuffix}`;
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

          // 5. forensics store (overnight visual proof & error captures)
          if (!db.objectStoreNames.contains('forensics')) {
            const forensicsStore = db.createObjectStore('forensics', { keyPath: 'id', autoIncrement: true });
            forensicsStore.createIndex('campaignId', 'campaignId', { unique: false });
            forensicsStore.createIndex('timestamp', 'timestamp', { unique: false });
            forensicsStore.createIndex('stage', 'stage', { unique: false });
          }

          // 6. archived_campaigns store (preserves failed / removed campaigns for 1-click recovery)
          if (!db.objectStoreNames.contains('archived_campaigns')) {
            const archivedStore = db.createObjectStore('archived_campaigns', { keyPath: 'id' });
            archivedStore.createIndex('archivedAt', 'archivedAt', { unique: false });
            archivedStore.createIndex('originalStatus', 'originalStatus', { unique: false });
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

        for (const tpl of DEFAULT_TEMPLATES) {
          const req = store.get(tpl.id);
          req.onsuccess = () => {
            if (!req.result) {
              store.put(tpl);
            }
          };
        }

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
     * Deletes a campaign by ID, including its forensics, logs, and any archive records.
     * @param {string} id
     * @returns {Promise<boolean>}
     */
    async deleteCampaign(id) {
      await this.deleteForensicsByCampaign(id).catch(() => {});
      await this.deleteLogsByCampaign(id).catch(() => {});
      await this._transaction('campaigns', 'readwrite', (store) => {
        store.delete(id);
      });
      try {
        await this._transaction('archived_campaigns', 'readwrite', (store) => {
          store.delete(id);
        });
      } catch (_) {}
      return true;
    },

    /**
     * Deletes all campaigns matching a specific status (e.g. 'FAILED').
     * @param {string} status
     * @returns {Promise<number>} Number of deleted campaigns
     */
    async deleteCampaignsByStatus(status) {
      const db = await this.init();
      return new Promise((resolve, reject) => {
        const tx = db.transaction('campaigns', 'readwrite');
        const store = tx.objectStore('campaigns');
        const index = store.index('status');
        const req = index.openCursor(IDBKeyRange.only(status));
        let count = 0;

        req.onsuccess = (e) => {
          const cursor = e.target.result;
          if (cursor) {
            const campId = cursor.value?.id || cursor.primaryKey;
            if (campId) {
              this.deleteForensicsByCampaign(campId).catch(() => {});
              this.deleteLogsByCampaign(campId).catch(() => {});
            }
            cursor.delete();
            count++;
            cursor.continue();
          }
        };

        tx.oncomplete = () => resolve(count);
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
      });
    },

    /**
     * Permanently wipes all failed campaigns, their forensic screenshots, and their logs from IndexedDB.
     * Hard database purge with ZERO archival.
     * @returns {Promise<number>} Number of deleted campaigns
     */
    async deleteFailedCampaigns() {
      const all = await this.getCampaigns();
      const failedList = all.filter((c) => c.status === 'FAILED');
      let count = 0;
      for (const camp of failedList) {
        try {
          await this.deleteForensicsByCampaign(camp.id).catch(() => {});
          await this.deleteLogsByCampaign(camp.id).catch(() => {});
          await this._transaction('campaigns', 'readwrite', (store) => {
            store.delete(camp.id);
          });
          try {
            await this._transaction('archived_campaigns', 'readwrite', (store) => {
              store.delete(camp.id);
            });
          } catch (_) {}
          count++;
        } catch (err) {
          console.warn('[IDBStore] Error permanently deleting failed campaign:', camp.id, err);
        }
      }
      return count;
    },

    /**
     * Archives a campaign from the active 'campaigns' store into 'archived_campaigns'.
     * Preserves all campaign data (subject, bodyTemplate, spreadsheetUrl, column, etc.)
     * for instant 1-click clone/recovery, while clearing the active queue and Unique ID.
     * @param {string} campaignId
     * @returns {Promise<Object|null>}
     */
    async archiveCampaign(campaignId) {
      const camp = await this.getCampaignById(campaignId);
      if (!camp) return null;

      const db = await this.init();
      const archivedRecord = {
        ...camp,
        originalStatus: camp.status,
        archivedAt: new Date().toISOString()
      };

      // Save to archived_campaigns
      await new Promise((resolve, reject) => {
        const tx = db.transaction(['archived_campaigns'], 'readwrite');
        const store = tx.objectStore('archived_campaigns');
        const req = store.put(archivedRecord);
        req.onsuccess = () => resolve(true);
        req.onerror = () => reject(req.error);
      });

      // Delete from active campaigns
      await this.deleteCampaign(campaignId);
      return archivedRecord;
    },

    /**
     * Archives all campaigns matching status === 'FAILED' into 'archived_campaigns'
     * and removes them from active queue.
     * @returns {Promise<number>}
     */
    async archiveFailedCampaigns() {
      const all = await this.getCampaigns();
      const failedList = all.filter((c) => c.status === 'FAILED');
      let count = 0;
      for (const camp of failedList) {
        try {
          await this.archiveCampaign(camp.id);
          count++;
        } catch (err) {
          console.warn('[IDBStore] Error archiving failed campaign:', camp.id, err);
        }
      }
      return count;
    },

    /**
     * Retrieves all archived campaigns, ordered newest archived first.
     * @returns {Promise<Array<Object>>}
     */
    async getArchivedCampaigns() {
      const db = await this.init();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(['archived_campaigns'], 'readonly');
        const store = tx.objectStore('archived_campaigns');
        const req = store.getAll();
        req.onsuccess = () => {
          const list = req.result || [];
          list.sort((a, b) => new Date(b.archivedAt || 0) - new Date(a.archivedAt || 0));
          resolve(list);
        };
        req.onerror = () => reject(req.error);
      });
    },

    /**
     * Permanently deletes a campaign from the 'archived_campaigns' store.
     * @param {string} campaignId
     * @returns {Promise<boolean>}
     */
    async deleteArchivedCampaign(campaignId) {
      const db = await this.init();
      await this.deleteForensicsByCampaign(campaignId).catch(() => {});
      return new Promise((resolve, reject) => {
        const tx = db.transaction(['archived_campaigns'], 'readwrite');
        const store = tx.objectStore('archived_campaigns');
        const req = store.delete(campaignId);
        req.onsuccess = () => resolve(true);
        req.onerror = () => reject(req.error);
      });
    },

    /**
     * Permanently purges all records in 'archived_campaigns'.
     * @returns {Promise<boolean>}
     */
    async clearAllArchivedCampaigns() {
      const db = await this.init();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(['archived_campaigns'], 'readwrite');
        const store = tx.objectStore('archived_campaigns');
        const req = store.clear();
        req.onsuccess = () => resolve(true);
        req.onerror = () => reject(req.error);
      });
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

    /**
     * Deletes all log entries associated with a specific campaign ID.
     * @param {string} campaignId
     * @returns {Promise<boolean>}
     */
    async deleteLogsByCampaign(campaignId) {
      if (!campaignId) return false;
      await this._transaction('logs', 'readwrite', (store) => {
        return new Promise((resolve, reject) => {
          const idx = store.index('campaignId');
          const req = idx.openKeyCursor(IDBKeyRange.only(campaignId));
          req.onsuccess = (e) => {
            const cursor = e.target.result;
            if (cursor) {
              store.delete(cursor.primaryKey);
              cursor.continue();
            } else {
              resolve(true);
            }
          };
          req.onerror = () => reject(req.error);
        });
      });
      return true;
    },

    // =========================================================================
    // FORENSICS & VISUAL SCREENSHOTS
    // =========================================================================

    /**
     * Saves a visual/DOM forensic capture for a campaign.
     * @param {Object} capture
     * @returns {Promise<Object>}
     */
    async saveForensicCapture(capture) {
      if (!capture) return null;
      const record = {
        campaignId: capture.campaignId || null,
        stage: capture.stage || 'UNKNOWN',
        screenshotUrl: capture.screenshotUrl || capture.screenshotDataUrl || null,
        screenshotDataUrl: capture.screenshotDataUrl || capture.screenshotUrl || null,
        popupTitle: capture.popupTitle || null,
        popupBody: capture.popupBody || null,
        domSnippet: capture.domSnippet || null,
        errorMessage: capture.errorMessage || null,
        url: capture.url || null,
        timestamp: capture.timestamp || new Date().toISOString()
      };

      const id = await this._transaction('forensics', 'readwrite', (store) => {
        return new Promise((resolve, reject) => {
          const req = store.add(record);
          req.onsuccess = () => resolve(req.result);
          req.onerror = () => reject(req.error);
        });
      });

      // Also set flag on campaign so UI can immediately render the camera icon without full query
      if (record.campaignId) {
        try {
          await this.updateCampaign(record.campaignId, { hasForensic: true, lastForensicId: id });
        } catch (_) {}
      }

      return { ...record, id };
    },

    /**
     * Retrieves all forensic captures for a campaign.
     * @param {string} campaignId
     * @returns {Promise<Array<Object>>}
     */
    async getForensicsByCampaign(campaignId) {
      if (!campaignId) return [];
      const results = await this._transaction('forensics', 'readonly', (store) => {
        return new Promise((resolve, reject) => {
          const idx = store.index('campaignId');
          const req = idx.getAll(IDBKeyRange.only(campaignId));
          req.onsuccess = () => resolve(req.result || []);
          req.onerror = () => reject(req.error);
        });
      });
      return results.sort((a, b) => new Date(b.timestamp || 0) - new Date(a.timestamp || 0));
    },

    /**
     * Retrieves the latest forensic capture for a campaign.
     * @param {string} campaignId
     * @returns {Promise<Object|null>}
     */
    async getLatestForensic(campaignId) {
      const all = await this.getForensicsByCampaign(campaignId);
      return all[0] || null;
    },

    /**
     * Deletes all forensic records for a campaign.
     * @param {string} campaignId
     * @returns {Promise<boolean>}
     */
    async deleteForensicsByCampaign(campaignId) {
      if (!campaignId) return false;
      await this._transaction('forensics', 'readwrite', (store) => {
        return new Promise((resolve, reject) => {
          const idx = store.index('campaignId');
          const req = idx.openKeyCursor(IDBKeyRange.only(campaignId));
          req.onsuccess = (e) => {
            const cursor = e.target.result;
            if (cursor) {
              store.delete(cursor.primaryKey);
              cursor.continue();
            } else {
              resolve(true);
            }
          };
          req.onerror = () => reject(req.error);
        });
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
    },

    /**
     * Exports all object stores (campaigns, templates, logs, settings) as a plain JS backup object.
     * @returns {Promise<Object>}
     */
    async exportAllData() {
      const campaigns = await this.getCampaigns();
      const templates = await this.getTemplates();
      const logs = await this.getLogs(null, 500);
      const settings = await this._transaction('settings', 'readonly', (store) => {
        return new Promise((resolve, reject) => {
          const req = store.getAll();
          req.onsuccess = () => resolve(req.result || []);
          req.onerror = () => reject(req.error);
        });
      });

      return {
        version: 1,
        exportedAt: new Date().toISOString(),
        campaigns: campaigns || [],
        templates: templates || [],
        logs: logs || [],
        settings: settings || []
      };
    },

    /**
     * Imports campaigns and templates from a backup payload.
     * @param {Object} data
     * @returns {Promise<{campaignsImported: number, templatesImported: number}>}
     */
    async importAllData(data) {
      if (!data || typeof data !== 'object') {
        throw new Error('Invalid backup file format.');
      }
      let campaignsCount = 0;
      let templatesCount = 0;

      if (Array.isArray(data.campaigns)) {
        for (const camp of data.campaigns) {
          if (camp && camp.id) {
            await this.saveCampaign(camp);
            campaignsCount++;
          }
        }
      }

      if (Array.isArray(data.templates)) {
        for (const tmpl of data.templates) {
          if (tmpl && tmpl.id) {
            await this.saveTemplate(tmpl);
            templatesCount++;
          }
        }
      }

      return { campaignsImported: campaignsCount, templatesImported: templatesCount };
    },

    // =========================================================================
    // SAFEGUARDS & QUOTA SETTINGS
    // =========================================================================

    /**
     * Gets a setting by key.
     */
    async getSetting(key, defaultValue = null) {
      return this._transaction('settings', 'readonly', (store) => {
        return new Promise((resolve) => {
          const req = store.get(key);
          req.onsuccess = () => {
            if (req.result && req.result.value !== undefined) {
              resolve(req.result.value);
            } else {
              resolve(defaultValue);
            }
          };
          req.onerror = () => resolve(defaultValue);
        });
      });
    },

    /**
     * Sets a setting by key.
     */
    async setSetting(key, value) {
      return this._transaction('settings', 'readwrite', (store) => {
        return new Promise((resolve, reject) => {
          const req = store.put({ key, value, updatedAt: new Date().toISOString() });
          req.onsuccess = () => resolve(true);
          req.onerror = () => reject(req.error);
        });
      });
    },

    /**
     * Retrieves safeguard settings with defaults.
     */
    async getSafeguardSettings() {
      const defaults = { maxRecipientsPerSheet: 25, dailyQuotaCeiling: 1450 };
      try {
        const stored = await this.getSetting('safeguard_settings', defaults);
        return { ...defaults, ...stored };
      } catch (_) {
        return defaults;
      }
    },

    /**
     * Saves safeguard settings.
     */
    async saveSafeguardSettings(settings) {
      return this.setSetting('safeguard_settings', settings);
    },

    /**
     * Calculates rolling 24-hour quota usage for a specific sender account.
     * Sums recipients from COMPLETED, PROCESSING, and QUEUED campaigns in the last 24h.
     */
    async getRolling24hQuota(accountEmail) {
      const settings = await this.getSafeguardSettings();
      const ceiling = settings.dailyQuotaCeiling || 1450;
      if (!accountEmail) return { used: 0, ceiling, remaining: ceiling, isExceeded: false, level: 'SAFE' };

      const twentyFourHoursAgo = Date.now() - (24 * 60 * 60 * 1000);
      const allCampaigns = await this.getCampaigns();

      let used = 0;
      for (const camp of allCampaigns) {
        const campAccount = (camp.accountEmail || camp.senderEmail || camp.senderDomain || '').toLowerCase().trim();
        const targetAccount = accountEmail.toLowerCase().trim();
        const isMatchingAccount = !campAccount || campAccount === targetAccount || campAccount.includes(targetAccount) || targetAccount.includes(campAccount);
        const isActiveStatus = ['COMPLETED', 'PROCESSING', 'QUEUED'].includes(camp.status);
        const isRecent = new Date(camp.updatedAt || camp.createdAt || 0).getTime() >= twentyFourHoursAgo;

        if (isMatchingAccount && isActiveStatus && isRecent) {
          const count = Number(camp.recipientCount || camp.sentCount || camp.meta?.recipientCount || 0);
          used += count;
        }
      }

      const remaining = Math.max(0, ceiling - used);
      const isExceeded = used >= ceiling;
      const level = isExceeded ? 'FULL' : (used > 1000 ? 'WARNING' : 'SAFE');

      return {
        used,
        ceiling,
        remaining,
        isExceeded,
        level
      };
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
