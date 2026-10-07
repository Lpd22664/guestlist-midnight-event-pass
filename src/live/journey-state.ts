/** Only allowlisted navigation and public drafts. Never use this for private material. */
export type JourneyRole = 'organiser' | 'guest' | 'gate';
export type JourneyStage = 'event' | 'access' | 'wallet' | 'pass' | 'door' | 'requests' | 'new-event';
export const JOURNEY_KEY = 'guestlist.midnight-preview.journey.v1';
export interface Journey { mode: 'demo' | 'preview'; role?: JourneyRole; stage: JourneyStage }
const roles = ['organiser', 'guest', 'gate'];
const stages = ['event', 'access', 'wallet', 'pass', 'door', 'requests', 'new-event'];
export function readJourney(storage: Pick<Storage, 'getItem'>, hash = ''): Journey {
  const path = /^#preview(?:\/(organiser|guest|gate)(?:\/(event|access|wallet|pass|door|requests|new-event))?)?$/.exec(hash);
  if (path) return {mode:'preview', ...(path[1] ? {role:path[1] as JourneyRole} : {}), stage:(path[2]??'event') as JourneyStage};
  if (hash.startsWith('#event=')) return {mode:'preview',role:'guest',stage:'event'};
  if (hash && hash !== '#') return {mode:'demo',stage:'event'};
  try { const value = JSON.parse(storage.getItem(JOURNEY_KEY)??'null');
    if (value && typeof value === 'object' && Object.keys(value).every(k=>['mode','role','stage'].includes(k)) && ['demo','preview'].includes(value.mode) && stages.includes(value.stage) && (!value.role || roles.includes(value.role))) return value;
  } catch { /* Malformed navigation is not authority and cannot unlock anything. */ }
  return {mode:'demo',stage:'event'};
}
export function saveJourney(storage: Pick<Storage,'setItem'>, value: Journey): void {
  if (!['demo','preview'].includes(value.mode) || !stages.includes(value.stage) || value.role && !roles.includes(value.role)) throw new Error('Invalid journey');
  try { storage.setItem(JOURNEY_KEY,JSON.stringify({mode:value.mode,...(value.role?{role:value.role}:{}),stage:value.stage})); } catch { /* Session remains usable with persistence disabled. */ }
}
