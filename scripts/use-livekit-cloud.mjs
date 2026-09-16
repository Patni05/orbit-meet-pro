#!/usr/bin/env node
/**
 * Points media at a hosted LiveKit project instead of the local SFU.
 *
 * A Cloudflare Tunnel carries HTTP and WebSocket, but WebRTC media is UDP and
 * travels directly to whichever machine runs the SFU. Behind a home router
 * that machine is unreachable from the internet, so people outside the network
 * join the room and then sit in silence.
 *
 * Handing media to a hosted SFU removes the problem rather than working around
 * it: the SFU already has a public address and a valid certificate, so every
 * participant can reach it from anywhere with no router changes.
 *
 * Usage:
 *   node scripts/use-livekit-cloud.mjs <wss-url> <api-key> <api-secret>
 *   node scripts/use-livekit-cloud.mjs --revert
 */

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const envPath = path.join(root, '.env');
const onWindows = process.platform === 'win32';

const c = {
  reset: '[0m',
  dim: '[2m',
  bold: '[1m',
  red: '[31m',
  green: '[32m',
  cyan: '[36m',
};

const ok = (m) => console.log(`    ${c.green}ok${c.reset} ${m}`);
const note = (m) => console.log(`    ${c.dim}${m}${c.reset}`);

function fail(message, detail) {
  console.error(`\n${c.red}Failed: ${message}${c.reset}`);
  if (detail) console.error(`${c.dim}${detail}${c.reset}`);
  process.exit(1);
}

function patchEnv(updates) {
  if (!fs.existsSync(envPath)) fail('.env not found. Run `npm run setup` first.');
  let text = fs.readFileSync(envPath, 'utf8');
  for (const [key, value] of Object.entries(updates)) {
    const pattern = new RegExp(`^${key}=.*$`, 'm');
    text = pattern.test(text)
      ? text.replace(pattern, `${key}=${value}`)
      : `${text.trimEnd()}\n${key}=${value}\n`;
  }
  fs.writeFileSync(envPath, text);
}

const args = process.argv.slice(2);

// ------------------------------------------------------------------- revert

if (args[0] === '--revert') {
  console.log(`\n${c.cyan}Switching media back to the local SFU${c.reset}`);
  patchEnv({
    LIVEKIT_URL: 'http://localhost:7880',
    LIVEKIT_PUBLIC_URL: 'ws://localhost:7880',
  });
  ok('.env restored to the local SFU');
  spawnSync('docker', ['compose', 'up', '-d', 'livekit'], { cwd: root, stdio: 'inherit', shell: onWindows });
  ok('Local LiveKit started');
  console.log(`\n  Rebuild and restart: ${c.cyan}npm run build && npm run start${c.reset}\n`);
  process.exit(0);
}

// -------------------------------------------------------------------- apply

const [url, key, secret] = args;

if (!url || !key || !secret) {
  fail(
    'Three values are required.',
    'Usage:\n  node scripts/use-livekit-cloud.mjs <wss-url> <api-key> <api-secret>\n\n' +
      'Find them at https://cloud.livekit.io under your project\'s Settings → Keys.\n' +
      'The URL looks like: wss://your-project.livekit.cloud',
  );
}

let parsed;
try {
  parsed = new URL(url);
} catch {
  fail(`"${url}" is not a valid URL.`, 'It should look like wss://your-project.livekit.cloud');
}

if (parsed.protocol !== 'wss:') {
  fail(
    `The URL must use wss://, not ${parsed.protocol}//`,
    'An insecure ws:// address is refused by browsers on an HTTPS page.',
  );
}

console.log(`\n${c.cyan}Pointing media at ${parsed.host}${c.reset}`);

patchEnv({
  // The server-side admin API speaks HTTPS to the same host.
  LIVEKIT_URL: `https://${parsed.host}`,
  // Handed to browsers in the join ticket.
  LIVEKIT_PUBLIC_URL: `wss://${parsed.host}`,
  LIVEKIT_API_KEY: key,
  LIVEKIT_API_SECRET: secret,
});
ok('.env updated');

// The local SFU is now dead weight, and leaving it running only invites
// confusion about which one is actually carrying a call.
const stop = spawnSync('docker', ['compose', 'stop', 'livekit'], {
  cwd: root,
  stdio: 'pipe',
  shell: onWindows,
  encoding: 'utf8',
});
if (stop.status === 0) ok('Local LiveKit container stopped');
else note('Local LiveKit container was not running.');

console.log(`
${c.green}Done.${c.reset} Media now goes through ${c.bold}${parsed.host}${c.reset}.

  Rebuild and restart:

      ${c.cyan}npm run build && npm run start${c.reset}

  Anyone can now join from anywhere — mobile data included — and no router
  configuration is involved.

  ${c.dim}Back to the local SFU: node scripts/use-livekit-cloud.mjs --revert${c.reset}
`);
