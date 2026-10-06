import { applyCommand, createDemoState, EVENT, type Command, type DemoState, type Receipt } from './domain';
const KEY = 'guestlist.synthetic-preview.v1';
function valid(value: unknown): value is DemoState {
  if (!value || typeof value !== 'object') return false;
  const s = value as DemoState;
  return s.version === 1 && s.eventId === EVENT.id && Number.isInteger(s.revision) && s.revision >= 0 && Array.isArray(s.passes) && s.passes.every(p => !!p && typeof p.id === 'string' && /^[0-9a-f]{64}$/.test(p.id) && p.id === p.commitment && /^[0-9a-f]{64}$/.test(p.secret) && typeof p.label === 'string' && p.label.length >= 2 && p.label.length <= 48 && Number.isInteger(p.sequence) && p.sequence > 0 && ['Guest','Host'].includes(p.type) && ['ready','used','revoked'].includes(p.status) && Number.isFinite(Date.parse(p.expiresAt)) && Number.isFinite(Date.parse(p.issuedAt))) && new Set(s.passes.map(p=>p.id)).size === s.passes.length && Array.isArray(s.activity) && s.activity.every(a => !!a && ['issue','redeem','revoke'].includes(a.type) && typeof a.id === 'string' && typeof a.label === 'string' && typeof a.passId === 'string' && typeof a.operationId === 'string' && Number.isFinite(Date.parse(a.at))) && !!s.requests && typeof s.requests === 'object' && !Array.isArray(s.requests) && Object.values(s.requests).every(r => !!r && typeof r === 'object' && typeof r.fingerprint === 'string' && /^[0-9a-f]{64}$/.test(r.fingerprint) && !!r.receipt && r.receipt.mode === 'demo' && typeof r.receipt.operationId === 'string' && ['issue','redeem','revoke'].includes(r.receipt.type) && typeof r.receipt.passId === 'string' && r.receipt.status === 'verified-locally' && Number.isFinite(Date.parse(r.receipt.at)));
}
export class DemoService {
  state!: DemoState;
  storageWarning = '';
  private unsaved = false;
  private queue: Promise<unknown> = Promise.resolve();
  private listeners = new Set<() => void>();
  constructor(private readonly storage: Storage | undefined = typeof localStorage !== 'undefined' ? localStorage : undefined, private readonly latency = 650) {}
  async initialise() {
    try { const raw = this.storage?.getItem(KEY); if (raw) { const parsed: unknown = JSON.parse(raw); if (!valid(parsed)) throw new Error('corrupt'); this.state = parsed; return; } }
    catch { this.storageWarning = 'The saved preview could not be read. Fresh synthetic data has been loaded.'; }
    this.state = await createDemoState(); this.save();
  }
  subscribe(fn: () => void) { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; }
  private save() { this.unsaved = true; try { this.storage?.setItem(KEY, JSON.stringify(this.state)); this.unsaved = !this.storage; } catch { this.storageWarning = 'Browser storage is unavailable. This preview will reset when the page closes.'; } }
  sync() { if (this.unsaved) return; try { const raw = this.storage?.getItem(KEY); if (raw) { const parsed: unknown = JSON.parse(raw); if (valid(parsed) && JSON.stringify(parsed) !== JSON.stringify(this.state)) { this.state = parsed; this.listeners.forEach(fn => fn()); } } } catch { /* Existing in-memory state remains usable. */ } }
  execute(command: Command, role: 'organiser' | 'attendee', requestId: string = crypto.randomUUID()): Promise<Receipt> {
    const run = async () => {
      await new Promise(resolve => setTimeout(resolve, this.latency));
      const apply = async () => { this.sync(); const result = await applyCommand(this.state, command, role, requestId); this.state = result.state; this.save(); this.listeners.forEach(fn => fn()); return result.receipt; };
      return typeof navigator !== 'undefined' && navigator.locks ? navigator.locks.request('guestlist-preview-ledger', apply) : apply();
    };
    const result = this.queue.then(run, run); this.queue = result.catch(() => undefined); return result;
  }
  async reset() {
    const run = async () => {
      const apply = async () => {
        this.sync();
        const revision = this.state.revision + 1;
        this.state = await createDemoState();
        // Never reuse a revision after reset: another tab may hold that number.
        this.state.revision = revision;
        this.save(); this.listeners.forEach(fn => fn());
      };
      return typeof navigator !== 'undefined' && navigator.locks ? navigator.locks.request('guestlist-preview-ledger', apply) : apply();
    };
    const result = this.queue.then(run, run); this.queue = result.catch(() => undefined); await result;
  }
}
