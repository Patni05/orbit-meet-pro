#!/usr/bin/env node
/**
 * Reverts what `npm run lan` changed.
 *
 * Restores the .env saved before LAN mode was enabled, stops the HTTPS proxy,
 * and puts the SFU back on the loopback media address. The certificate is left
 * in place so re-enabling LAN mode on the same network is instant.
 */

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const envPath = path.join(root, '.env');
const backupPath = path.join(root, '.env.local-backup');
const onWindows = process.platform === 'win32';

const c = { reset: '[0m', dim: '[2m', green: '[32m', yellow: '[33m', cyan: '[36m' };
const ok = (m) => console.log(`    ${c.green}ok${c.reset} ${m}`);
const warn = (m) => console.log(`    ${c.yellow}!${c.reset}  ${m}`);

function run(command, args) {
  return spawnSync(command, args, { cwd: root, stdio: 'inherit', shell: onWindows, encoding: 'utf8' });
}

console.log(`\n${c.cyan}Turning LAN mode off${c.reset}`);

if (fs.existsSync(backupPath)) {
  fs.copyFileSync(backupPath, envPath);
  fs.rmSync(backupPath);
  ok('.env restored from .env.local-backup');
} else {
  warn('No .env.local-backup found; .env left as it is.');
}

run('docker', ['compose', '--profile', 'lan', 'down']);
ok('HTTPS proxy stopped');

// Restart the SFU so it stops advertising the LAN address for media.
run('docker', ['compose', 'up', '-d', 'livekit']);
ok('LiveKit back on the loopback media address');

console.log(`
${c.green}Done.${c.reset} Restart the dev servers to pick up the restored .env:

    ${c.cyan}npm run dev${c.reset}

${c.dim}Re-enable device testing at any time with: npm run lan${c.reset}
`);
