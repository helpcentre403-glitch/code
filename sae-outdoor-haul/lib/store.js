'use strict';
/**
 * Tiny JSON-file store. Good for one small business on one server.
 * TODO (launch): if you host on a platform with an ephemeral disk (many free tiers),
 * point DATA_DIR at a persistent volume, or leads/settings will be lost on redeploy.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { defaultSettings } = require('./defaults');

function isPlainObject(v) {
  return v && typeof v === 'object' && !Array.isArray(v);
}

// Fill in keys that exist in defaults but are missing in saved data (new features).
function fillMissing(saved, defaults) {
  if (!isPlainObject(saved) || !isPlainObject(defaults)) return saved === undefined ? defaults : saved;
  const out = { ...saved };
  for (const k of Object.keys(defaults)) {
    if (!(k in out)) out[k] = defaults[k];
    else out[k] = fillMissing(out[k], defaults[k]);
  }
  return out;
}

function createStore(dataDir) {
  fs.mkdirSync(dataDir, { recursive: true });
  const settingsFile = path.join(dataDir, 'settings.json');
  const leadsFile = path.join(dataDir, 'leads.json');

  function readJson(file, fallback) {
    try {
      return JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch (e) {
      if (e.code === 'ENOENT') return fallback;
      throw e;
    }
  }
  function writeJson(file, data) {
    const tmp = `${file}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
    fs.renameSync(tmp, file);
  }

  let settings = fillMissing(readJson(settingsFile, null) || {}, defaultSettings());
  if (!fs.existsSync(settingsFile)) writeJson(settingsFile, settings);
  let leads = readJson(leadsFile, []);

  return {
    getSettings: () => settings,
    saveSettings(next) {
      settings = next;
      writeJson(settingsFile, settings);
      return settings;
    },
    listLeads: () => leads,
    getLead: (id) => leads.find((l) => l.id === id) || null,
    addLead(lead) {
      const full = { id: crypto.randomUUID(), createdAt: new Date().toISOString(), status: 'new', ...lead };
      leads.push(full);
      writeJson(leadsFile, leads);
      return full;
    },
    updateLead(id, patch) {
      const i = leads.findIndex((l) => l.id === id);
      if (i < 0) return null;
      leads[i] = { ...leads[i], ...patch, updatedAt: new Date().toISOString() };
      writeJson(leadsFile, leads);
      return leads[i];
    },
  };
}

module.exports = { createStore, fillMissing };
