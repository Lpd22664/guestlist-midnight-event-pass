/** Runtime consent contract. These are owner-controlled actions, never approvals supplied by an agent or a fixture. */
export const CONSENT_REQUIREMENTS = Object.freeze({
  provision: { mode: 'per-action', ownerFinalAction: true, agentMayExecute: false, createsPersistentAuthority: true },
  importPrivateFile: { mode: 'hand-off', ownerFinalAction: true, agentMayExecute: false, localFilePickerOnly: true },
  connection: { mode: 'pre-approval', ownerFinalAction: true, network: 'preview' },
  storage: { mode: 'pre-approval', ownerFinalAction: true, encryptedCapabilities: true },
  walletProver: { mode: 'per-action', ownerFinalAction: true, privatePreimagesLeavePage: true },
  transaction: { mode: 'per-action', ownerFinalAction: true, network: 'preview', paysDust: true },
  presentation: { mode: 'pre-approval', ownerFinalAction: true, containsBearerCapability: true },
  gateAuthority: { mode: 'hand-off', ownerFinalAction: true, agentMayExecute: false },
});
export interface ConsentRequest { title: string; details: string[]; acceptLabel: string; requirement: keyof typeof CONSENT_REQUIREMENTS; }
export class ConsentQueue {
  #pending?: { request: ConsentRequest; resolve: (accepted: boolean) => void };
  #listeners = new Set<() => void>();
  subscribe = (listener: () => void) => { this.#listeners.add(listener); return () => { this.#listeners.delete(listener); }; };
  getSnapshot = () => this.#pending?.request;
  request = (request: ConsentRequest): Promise<boolean> => {
    if (this.#pending) return Promise.reject(new Error('An owner review is already pending'));
    return new Promise(resolve => { this.#pending = { request, resolve }; this.#emit(); });
  };
  respond(accepted: boolean): void { const pending = this.#pending; this.#pending = undefined; this.#emit(); pending?.resolve(accepted); }
  #emit(): void { this.#listeners.forEach(listener => listener()); }
}
