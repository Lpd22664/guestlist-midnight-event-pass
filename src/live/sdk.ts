import type { Sdk } from './model';
let imported: Promise<Sdk> | undefined;
/** One compiled runtime realm, no wallet access or key generation as an import side effect. */
export function loadLiveSdk(): Promise<Sdk> {
  if (!imported) {
    const url = new URL('/midnight/sdk/event-pass.js', location.origin).href;
    imported = import(/* @vite-ignore */ url).then(module => module as Sdk).catch(() => { imported = undefined; throw new Error('The genuine Midnight browser bundle could not load. Build and mount the complete SDK and compiler artifacts.'); });
  }
  return imported;
}
export function assetsUrl(): string { return new URL('/midnight/event-pass/', location.origin).href; }
