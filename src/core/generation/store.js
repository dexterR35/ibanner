import { createStore, get, set, update, entries, setMany, del } from 'idb-keyval';
import { analysisSchema, correctionSchema } from './contracts.js';
import { canonical } from './fingerprint.js';
let database;
const db = () => (database ||= createStore('bannerflow-intelligence-v1', 'records'));
export const getRecord = (key) => get(key, db());
export const deleteRecord = (key) => del(key, db());
export const putRecord = (key, value) => set(key, value, db());
export const listRecords = async (prefix = '') =>
  (await entries(db())).filter(([key]) => key.startsWith(prefix));
export async function immutableRecord(key, value) {
  await update(
    key,
    (old) => {
      if (old && canonical(old) !== canonical(value))
        throw new Error('An immutable result already exists for this identity.');
      return old || value;
    },
    db(),
  );
  return value;
}
export const saveAnalysis = (value) => {
  const run = analysisSchema.parse(value);
  return immutableRecord(`analysis:${run.id}`, run);
};
export async function saveCorrection(assetId, value, expectedRevision = 0) {
  const correction = correctionSchema.parse(value);
  await update(
    `correction:${assetId}`,
    (old) => {
      if ((old?.revision || 0) !== expectedRevision)
        throw new Error('Corrections changed in another tab. Reload and retry.');
      return {
        assetId,
        revision: expectedRevision + 1,
        value: correction,
        previous: old
          ? [...(old.previous || []), { revision: old.revision, value: old.value }]
          : [],
      };
    },
    db(),
  );
}
export async function snapshotRecords(assetIds) {
  const allowed = new Set(assetIds);
  return (await entries(db())).filter(
    ([key, v]) =>
      (key.startsWith('analysis:') ||
        key.startsWith('correction:') ||
        key.startsWith('tombstone:')) &&
      allowed.has(v.assetId),
  );
}
export function validateRecords(records, assetIds) {
  if (!Array.isArray(records) || records.length > 10000)
    throw new Error('Invalid intelligence archive.');
  const allowed = new Set(assetIds),
    seen = new Set();
  // Semantic search was removed; older backups may still carry its derived vectors.
  records = records.filter(([key]) => !(typeof key === 'string' && key.startsWith('embedding:')));
  return records.map(([key, v]) => {
    if (typeof key !== 'string' || seen.has(key) || !allowed.has(v?.assetId))
      throw new Error('Invalid intelligence reference.');
    seen.add(key);
    if (key.startsWith('analysis:')) {
      v = analysisSchema.parse(v);
      if (key !== `analysis:${v.id}`) throw new Error('Analysis identity mismatch.');
    } else if (key === `correction:${v.assetId}`) {
      if (!Number.isInteger(v.revision) || v.revision < 1)
        throw new Error('Invalid correction revision.');
      v = {
        ...v,
        value: correctionSchema.parse(v.value),
        previous: (v.previous || []).map((r) => ({ ...r, value: correctionSchema.parse(r.value) })),
      };
    } else if (key !== `tombstone:${v.assetId}` || typeof v.deletedAt !== 'string')
      throw new Error('Unknown intelligence archive record.');
    return [key, v];
  });
}
export const restoreRecords = (records) => setMany(records, db());

// Ledger is one transactional record: state, fencing tokens and outbox commit together.
export async function mutateLedger(fn) {
  let result;
  await update(
    'ledger',
    (old) => {
      const ledger = old || { sequence: 0, jobs: {}, events: [] };
      result = fn(ledger);
      return ledger;
    },
    db(),
  );
  return result;
}
export function event(ledger, type, id, payload = {}) {
  ledger.events.push({ sequence: ++ledger.sequence, type, aggregateId: id, payload });
  ledger.events = ledger.events.slice(-1000);
}
export async function enqueueJob(key, payload, now = Date.now(), { retryFallback = false } = {}) {
  return mutateLedger((l) => {
    const retry =
      retryFallback &&
      l.jobs[key]?.state === 'succeeded' &&
      // A run that fell back without Qwen is retried once Qwen is available again.
      (l.jobs[key]?.result?.layout?.fallback || l.jobs[key]?.result?.planner?.fallback);
    if (l.jobs[key] && !retry && !['failed', 'cancelled'].includes(l.jobs[key].state))
      return l.jobs[key];
    const previous = l.jobs[key];
    const job = {
      key,
      payload,
      state: 'queued',
      attempt: 0,
      token: previous?.token || 0,
      owner: null,
      expires: 0,
      createdAt: now,
    };
    l.jobs[key] = job;
    event(l, 'JobQueued', key);
    return job;
  });
}
export async function leaseJob(key, owner, now = Date.now(), ttl = 60000) {
  return mutateLedger((l) => {
    const j = l.jobs[key];
    if (
      !j ||
      j.state === 'succeeded' ||
      j.state === 'cancelled' ||
      j.state === 'failed' ||
      (j.state === 'running' && j.expires > now)
    )
      return null;
    if (j.attempt >= 3) {
      j.state = 'failed';
      event(l, 'JobFailed', key, { reason: 'Retry limit reached' });
      return null;
    }
    Object.assign(j, {
      state: 'running',
      owner,
      expires: now + ttl,
      token: j.token + 1,
      attempt: j.attempt + 1,
    });
    event(l, 'JobStarted', key);
    return structuredClone(j);
  });
}
export async function commitJob(key, owner, token, result, now = Date.now()) {
  return mutateLedger((l) => {
    const j = l.jobs[key];
    if (!j || j.state !== 'running' || j.owner !== owner || j.token !== token || j.expires <= now)
      return false;
    Object.assign(j, { state: 'succeeded', result, expires: 0 });
    event(l, 'JobCompleted', key);
    return true;
  });
}
export async function cancelJob(key) {
  return mutateLedger((l) => {
    const j = l.jobs[key];
    if (j && j.state !== 'succeeded') {
      j.state = 'cancelled';
      j.token++;
      event(l, 'JobCancelled', key);
    }
  });
}
export async function failJob(key, owner, token, message) {
  return mutateLedger((l) => {
    const j = l.jobs[key];
    if (j?.state === 'running' && j.owner === owner && j.token === token) {
      j.state = 'failed';
      j.error = String(message).slice(0, 2000);
      event(l, 'JobFailed', key);
    }
  });
}
