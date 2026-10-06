export const EVENT = {
  id: 'builders-table-2026', name: "The Builders’ Table", category: 'A small gathering. Big ideas.',
  date: 'Friday, 23 October', time: '18:00–22:00 UTC', location: 'Assembly House, London',
  expiresAt: '2026-10-24T00:00:00.000Z', capacity: 72,
} as const;
// This is a replayable portfolio fixture, not the visitor's real clock.
export const DEMO_CLOCK = '2026-10-05T17:00:00.000Z';
export const demoNow = () => new Date(DEMO_CLOCK);
export type PassStatus = 'ready' | 'used' | 'revoked' | 'expired';
export type PassType = 'Guest' | 'Host';
export type Pass = { id: string; sequence: number; label: string; type: PassType; commitment: string; secret: string; status: 'ready' | 'used' | 'revoked'; issuedAt: string; expiresAt: string; usedAt?: string; revokedAt?: string };
export type Activity = { id: string; type: 'issue' | 'redeem' | 'revoke'; passId: string; label: string; at: string; operationId: string };
export type Receipt = { mode: 'demo'; operationId: string; type: Activity['type']; passId: string; status: 'verified-locally'; at: string };
export type DemoState = { version: 1; revision: number; eventId: string; passes: Pass[]; activity: Activity[]; requests: Record<string, { fingerprint: string; receipt: Receipt }> };
export type Credential = { version: 1; mode: 'demo'; eventId: string; passId: string; secret: string };
export type FailureCode = 'invalid' | 'wrong-event' | 'used' | 'revoked' | 'expired' | 'unauthorised' | 'duplicate' | 'request-conflict' | 'capacity';
export class PassError extends Error { constructor(public code: FailureCode, message: string) { super(message); this.name = 'PassError'; } }
const hex = (bytes: Uint8Array) => [...bytes].map(b => b.toString(16).padStart(2, '0')).join('');
export async function demoCommitment(secret: string, eventId = EVENT.id): Promise<string> {
  return hex(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`guestlist:demo:v1:${eventId}:${secret}`))));
}
export const newSecret = () => hex(crypto.getRandomValues(new Uint8Array(32)));
export const statusOf = (pass: Pass, now = Date.parse(DEMO_CLOCK)): PassStatus => pass.status === 'ready' && Date.parse(pass.expiresAt) <= now ? 'expired' : pass.status;
export const shortCommitment = (value: string) => `${value.slice(0, 8)}…${value.slice(-6)}`;
export const passNumber = (pass: Pick<Pass, 'sequence'>) => `GL-${String(pass.sequence).padStart(3, '0')}`;
export function encodeCredential(pass: Pass): string { return `guestlist-demo:${btoa(JSON.stringify({ version: 1, mode: 'demo', eventId: EVENT.id, passId: pass.id, secret: pass.secret } satisfies Credential))}`; }
export function decodeCredential(raw: string): Credential {
  if (raw.length > 2048 || !raw.startsWith('guestlist-demo:')) throw new PassError('invalid', 'This is not a Guestlist preview credential');
  try {
    const parsed: unknown = JSON.parse(atob(raw.trim().slice('guestlist-demo:'.length)));
    if (!parsed || typeof parsed !== 'object') throw new Error('object required');
    const c = parsed as Record<string, unknown>;
    if (c.version !== 1 || c.mode !== 'demo' || typeof c.eventId !== 'string' || typeof c.passId !== 'string' || typeof c.secret !== 'string' || !/^[0-9a-f]{64}$/.test(c.secret) || !/^[0-9a-f]{64}$/.test(c.passId)) throw new Error('invalid fields');
    if (c.eventId !== EVENT.id) throw new PassError('wrong-event', 'This pass belongs to another event');
    return c as Credential;
  } catch (error) { if (error instanceof PassError) throw error; throw new PassError('invalid', 'The credential is incomplete or unreadable'); }
}
const labels = ['Alex Morgan', 'Sam Rivers', 'Jamie Chen', 'Taylor Reed', 'Robin Ellis', 'Casey Park', 'Jordan Blake', 'Drew Hayes', 'Avery Lane', 'Harper Quinn', 'Charlie Moss', 'Rowan Finch', 'Riley Brooks', 'Quinn West', 'Sage Woods', 'Emery Cole', 'Finley Gray', 'Remy Stone'];
export async function createDemoState(): Promise<DemoState> {
  const passes = await Promise.all(labels.map(async (label, i): Promise<Pass> => {
    const secret = (i + 1).toString(16).padStart(64, '0'); // PUBLIC SYNTHETIC FIXTURES. Never use for a real credential.
    const commitment = await demoCommitment(secret);
    const status = i >= 12 && i <= 14 ? 'used' : i >= 15 && i <= 16 ? 'revoked' : 'ready';
    return { id: commitment, commitment, secret, sequence: i + 1, label, type: i === 0 || i === 12 ? 'Host' : 'Guest', status, issuedAt: `2026-10-05T${String(10 + Math.floor(i / 6)).padStart(2, '0')}:${String((i * 7) % 60).padStart(2, '0')}:00.000Z`, expiresAt: i === 17 ? '2026-10-04T00:00:00.000Z' : EVENT.expiresAt, ...(status === 'used' ? { usedAt: `2026-10-05T15:${String(i * 3).padStart(2, '0')}:00.000Z` } : {}), ...(status === 'revoked' ? { revokedAt: '2026-10-05T14:25:00.000Z' } : {}) };
  }));
  return { version: 1, revision: 0, eventId: EVENT.id, passes, requests: {}, activity: [
    { id: 'seed-3', type: 'redeem', passId: passes[14].id, label: passes[14].label, at: '2026-10-05T15:42:00.000Z', operationId: 'demo-seed-3' },
    { id: 'seed-2', type: 'revoke', passId: passes[15].id, label: passes[15].label, at: '2026-10-05T14:25:00.000Z', operationId: 'demo-seed-2' },
    { id: 'seed-1', type: 'issue', passId: passes[0].id, label: passes[0].label, at: '2026-10-05T10:00:00.000Z', operationId: 'demo-seed-1' },
  ] };
}
export type Command = { type: 'issue'; label: string; passType: PassType; secret: string } | { type: 'redeem'; credential: string } | { type: 'revoke'; passId: string };
export async function applyCommand(input: DemoState, command: Command, role: 'organiser' | 'attendee', requestId: string, now = demoNow()): Promise<{ state: DemoState; receipt: Receipt }> {
  if (!requestId || requestId.length > 128) throw new PassError('invalid', 'A bounded request ID is required');
  if ((command.type === 'issue' || command.type === 'revoke') && role !== 'organiser') throw new PassError('unauthorised', 'Only the preview organiser can do this');
  const fingerprint = await demoCommitment(JSON.stringify(command));
  const previous = Object.hasOwn(input.requests, requestId) ? input.requests[requestId] : undefined;
  if (previous) { if (previous.fingerprint !== fingerprint) throw new PassError('request-conflict', 'This request ID was already used for another action'); return { state: structuredClone(input), receipt: previous.receipt }; }
  const state = structuredClone(input);
  let pass: Pass;
  if (command.type === 'issue') {
    if (now.getTime() >= Date.parse(EVENT.expiresAt)) throw new PassError('expired', 'The event admission window has closed');
    const label = command.label.trim();
    if (label.length < 2 || label.length > 48 || !/^[0-9a-f]{64}$/.test(command.secret) || !['Guest', 'Host'].includes(command.passType)) throw new PassError('invalid', 'Use a guest label of 2–48 characters and a valid pass type');
    if (state.passes.length >= EVENT.capacity) throw new PassError('capacity', 'This gathering has reached its pass limit');
    const commitment = await demoCommitment(command.secret);
    if (state.passes.some(p => p.commitment === commitment)) throw new PassError('duplicate', 'This credential has already been issued');
    pass = { id: commitment, sequence: Math.max(0, ...state.passes.map(p => p.sequence)) + 1, label, type: command.passType, commitment, secret: command.secret, status: 'ready', issuedAt: now.toISOString(), expiresAt: EVENT.expiresAt };
    state.passes.push(pass);
  } else {
    const credential = command.type === 'redeem' ? decodeCredential(command.credential) : undefined;
    const found = state.passes.find(p => p.id === (credential?.passId ?? (command as { passId: string }).passId));
    if (!found || (credential && await demoCommitment(credential.secret) !== found.commitment)) throw new PassError('invalid', 'No issued pass matches this credential');
    pass = found;
    const status = statusOf(pass, now.getTime());
    if (status !== 'ready') throw new PassError(status, status === 'used' ? 'This pass has already been checked in' : status === 'revoked' ? 'The organiser has revoked this pass' : 'This pass has expired');
    if (command.type === 'redeem') { pass.status = 'used'; pass.usedAt = now.toISOString(); }
    else { pass.status = 'revoked'; pass.revokedAt = now.toISOString(); }
  }
  state.revision++;
  const receipt: Receipt = { mode: 'demo', operationId: `demo-${requestId}`, type: command.type, passId: pass.id, status: 'verified-locally', at: now.toISOString() };
  Object.defineProperty(state.requests, requestId, { value: { fingerprint, receipt }, enumerable: true, configurable: true, writable: true });
  state.activity.unshift({ id: requestId, type: command.type, passId: pass.id, label: pass.label, at: now.toISOString(), operationId: receipt.operationId });
  return { state, receipt };
}
