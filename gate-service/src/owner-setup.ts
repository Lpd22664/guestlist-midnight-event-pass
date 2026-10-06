/** Owner-terminal-only setup. Importing this module never prompts, creates keys, writes or listens. */
import { randomBytes } from 'node:crypto';
import { createInterface } from 'node:readline/promises';
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';
import { SERVER_FILE, CLIENT_FILE, DATABASE_FILE, PREVIEW_ENDPOINTS, assertNewPrivateDirectory, confirmed,
  confirmationPhrase, readPublicManifest, setupPlan, writePrivateConfigPair } from './owner-config.js';
import { checkOwnerRuntime } from './owner-runtime.js';

export function requireOwnerTerminal(args: string[], inputIsTty: boolean, outputIsTty: boolean): void {
  if (args.length !== 0 || !inputIsTty || !outputIsTty) throw new Error('Owner setup requires an interactive terminal and accepts no options or unattended approval');
}
export async function ownerSetup(): Promise<void> {
  requireOwnerTerminal(process.argv.slice(2), process.stdin.isTTY === true, process.stdout.isTTY === true);
  checkOwnerRuntime();
  const terminal = createInterface({ input: process.stdin, output: process.stdout });
  let approved = false;
  try {
    console.info('Owner-only Guestlist gate setup. No wallet, issuer/bearer key, prover or network access.');
    console.info('Use a trusted verified public Preview manifest; this command does not verify deployment on-chain.');
    const manifestPath = await terminal.question('Absolute path to the public Preview manifest: ');
    const manifest = readPublicManifest(manifestPath);
    const allowedAppOrigin = await terminal.question('Exact app origin (scheme + host + optional port; no path): ');
    const portText = await terminal.question('Explicit loopback port (1024-65535): ');
    if (!/^[0-9]{4,5}$/.test(portText)) throw new Error('Invalid loopback port');
    const id = await terminal.question('Owner-assigned gate ID (letters, digits, _ or -; 1-64 chars): ');
    const directory = await terminal.question('New absolute private directory outside the repo, on your durable local filesystem: ');
    const plan = setupPlan({ event: manifest, allowedAppOrigin, port: Number(portText), gateId: id, privateDirectory: directory });
    assertNewPrivateDirectory(plan.privateDirectory);
    console.info('\nReview this exact scope before creating persistent API authority:');
    console.info(JSON.stringify({ event: plan.event, allowedAppOrigin: plan.allowedAppOrigin, gateId: plan.gateId,
      listener: `http://127.0.0.1:${plan.port}`, publicReadEndpoints: PREVIEW_ENDPOINTS,
      privateServerConfig: join(directory, SERVER_FILE), privateClientConnection: join(directory, CLIENT_FILE),
      singleDurableDatabase: join(directory, DATABASE_FILE) }, null, 2));
    console.info('This creates a fresh persistent gate API secret in two private owner-only files (0600) inside a new 0700 directory.');
    console.info('Anyone with that secret can open and claim gate attempts for this configured event. CORS is not an authentication barrier.');
    console.info('Protect both files and the single SQLite database. Do not upload, commit, share, clone, delete, or roll back them while gates are active.');
    console.info('The client file contains authentication authority. Personally import it only into your reviewed private Guestlist app.');
    console.info('The database must be on one durable local filesystem supporting SQLite locking; not a network/cloud-sync filesystem.');
    console.info('This does not start a listener, connect to the chain, open a port remotely, or configure autostart/TLS/firewalls.');
    const phrase = confirmationPhrase(plan);
    const answer = await terminal.question(`\nTo personally authorize creation now, type exactly:\n${phrase}\n> `);
    if (!confirmed(plan, answer)) { console.info('Cancelled. No authority created and no private files written.'); return; }
    approved = true;
    // Sole fresh authority generation site: only AFTER the final exact, scope-bound terminal confirmation.
    writePrivateConfigPair(plan, randomBytes(32).toString('hex'));
    console.info('Private configuration and connection files created. No listener was started.');
    console.info('When you choose to start it, run the separate owner:launch command with the absolute private server-config path.');
  } catch {
    // Never print raw filesystem/JSON/exception content that could include private data.
    console.error(approved ? 'Setup failed after confirmation; private files may be partially present. Preserve them and inspect locally; nothing is overwritten.' : 'Setup failed before confirmation; check the public manifest, exact origin, port and new owner-private directory. No authority was created.');
    process.exitCode = 1;
  } finally { terminal.close(); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  ownerSetup().catch(() => { console.error('Owner setup requires an interactive terminal, no arguments, and Node >=24.19.0 <25 with SQLite >=3.51.3. No authority created.'); process.exitCode = 1; });
}
