/** Separate explicit launch command. Importing this module starts no listener and reads no owner files. */
import { closeSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { configEnvironment, openOwnerServerConfig } from './owner-config.js';
import { checkOwnerRuntime } from './owner-runtime.js';
export async function ownerLaunch(args: string[]): Promise<void> {
  if (args.length !== 1 || !args[0] || args[0].startsWith('-')) throw new Error('Supply one absolute private server-config path');
  checkOwnerRuntime();
  const opened = openOwnerServerConfig(args[0]);
  try {
    Object.assign(process.env, configEnvironment(opened.config));
    const { startGateFromEnvironment } = await import('./main.js');
    startGateFromEnvironment(opened.config.databaseIdentity);
  } finally { closeSync(opened.databaseFd); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  ownerLaunch(process.argv.slice(2)).catch(() => { console.error('Gate launch failed; check the private owner config, file ownership/modes, durable database and supported runtime. Admissions remain closed.'); process.exitCode = 1; });
}
