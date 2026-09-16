#!/usr/bin/env node
/**
 * Publishes this machine's Orbit on a public HTTPS URL via Cloudflare Tunnel.
 *
 * Unlike `npm run lan`, which serves a self-signed certificate that every
 * device has to accept, the tunnel presents a certificate Cloudflare already
 * owns. Phones and laptops anywhere on the internet can open the link with no
 * warning, which is what makes camera and microphone access work without the
 * user having to click through a security interstitial.
 *
 * What the tunnel carries: the app, the REST API, the realtime socket, and SFU
 * signalling — all HTTP or WebSocket, all through the one origin the reverse
 * proxy already fronts.
 *
 * What it does NOT carry: WebRTC media. That is UDP, and a tunnel is HTTP
 * only. See the note printed at the end.
 */

import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const envPath = path.join(root, '.env');
const binDir = path.join(root, '.tmp', 'bin');
const onWindows = process.platform === 'win32';
const exe = path.join(binDir, onWindows ? 'cloudflared.exe' : 'cloudflared');
const LOCAL_ORIGIN = 'http://localhost:8080';

const c = {
  reset: '[0m',
  dim: '[2m',
  bold: '[1m',
  red: '[31m',
  green: '[32m',
  yellow: '[33m',
  cyan: '[36m',
};

let step = 0;
const heading = (m) => console.log(`\n${c.cyan}[${++step}] ${m}${c.reset}`);
const ok = (m) => console.log(`    ${c.green}ok${c.reset} ${m}`);
const note = (m) => console.log(`    ${c.dim}${m}${c.reset}`);

function fail(message, detail) {
  console.error(`\n${c.red}Failed: ${message}${c.reset}`);
  if (detail) console.error(`${c.dim}${detail}${c.reset}`);
  process.exit(1);
}

// ------------------------------------------------------------------- binary

heading('Checking for cloudflared');

if (!fs.existsSync(exe)) {
  fs.mkdirSync(binDir, { recursive: true });
  const asset = onWindows
    ? 'cloudflared-windows-amd64.exe'
    : process.platform === 'darwin'
      ? 'cloudflared-darwin-amd64.tgz'
      : 'cloudflared-linux-amd64';

  if (!onWindows && process.platform === 'darwin') {
    fail('Automatic download supports Windows and Linux.', 'On macOS: brew install cloudflared');
  }

  console.log('    downloading…');
  const result = spawnSync(
    'curl',
    ['-sL', '-o', exe, `https://github.com/cloudflare/cloudflared/releases/latest/download/${asset}`],
    { stdio: 'inherit', shell: onWindows },
  );
  if (result.status !== 0 || !fs.existsSync(exe)) fail('Could not download cloudflared.');
  if (!onWindows) fs.chmodSync(exe, 0o755);
}
ok('cloudflared is available');

// --------------------------------------------------------------- the proxy

heading('Checking the local proxy');

const probe = spawnSync(
  'curl',
  ['-s', '-m', '10', '-o', onWindows ? 'NUL' : '/dev/null', '-w', '%{http_code}', `${LOCAL_ORIGIN}/api/health/live`],
  { encoding: 'utf8', shell: onWindows },
);

if (probe.stdout?.trim() !== '200') {
  fail(
    `Nothing healthy is answering on ${LOCAL_ORIGIN}.`,
    'Start the stack first:\n  npm run lan     (starts the proxy)\n  npm run dev     (starts the app)',
  );
}
ok('Proxy is serving the app and the API');

// ------------------------------------------------------------------ tunnel

heading('Opening the tunnel');

const child = spawn(exe, ['tunnel', '--url', LOCAL_ORIGIN, '--no-autoupdate'], {
  cwd: root,
  stdio: ['ignore', 'pipe', 'pipe'],
});

let url = null;
let settled = false;

/** Cloudflare prints the assigned hostname to stderr as a banner. */
function scan(chunk) {
  const text = chunk.toString();
  const match = text.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
  if (match && !url) {
    url = match[0];
    onUrl();
  }
}

child.stdout.on('data', scan);
child.stderr.on('data', scan);

child.on('exit', (code) => {
  if (!settled) fail(`cloudflared exited with code ${code} before giving out a URL.`);
});

const timeout = setTimeout(() => {
  if (!url) fail('Timed out waiting for a tunnel URL.', 'Check your internet connection and try again.');
}, 60_000);

function onUrl() {
  clearTimeout(timeout);
  settled = true;
  ok(`Public URL: ${c.bold}${url}${c.reset}`);

  // ------------------------------------------------------------------ .env
  heading('Telling the app about its public address');

  if (!fs.existsSync(envPath)) fail('.env not found. Run `npm run setup` first.');
  let envText = fs.readFileSync(envPath, 'utf8');

  const read = (key) => new RegExp(`^${key}=(.*)$`, 'm').exec(envText)?.[1]?.trim() ?? '';

  // Keep any origins already configured (the LAN proxy, typically) and add
  // this one, so both ways of reaching the app keep working at once.
  const merge = (existing, addition) =>
    [...new Set([...existing.split(',').map((v) => v.trim()).filter(Boolean), addition])].join(',');

  const updates = {
    PROXY_ORIGINS: merge(read('PROXY_ORIGINS'), url),
    NEXT_PUBLIC_PROXY_ORIGINS: merge(read('NEXT_PUBLIC_PROXY_ORIGINS'), url),
    CORS_ORIGINS: merge(read('CORS_ORIGINS') || 'http://localhost:3000', url),
    APP_URL: url,
  };

  for (const [key, value] of Object.entries(updates)) {
    const pattern = new RegExp(`^${key}=.*$`, 'm');
    envText = pattern.test(envText)
      ? envText.replace(pattern, `${key}=${value}`)
      : `${envText.trimEnd()}\n${key}=${value}\n`;
  }

  fs.writeFileSync(envPath, envText);
  ok('.env updated');

  console.log(`
${c.green}Tunnel is open.${c.reset}

  ${c.bold}Rebuild and restart${c.reset} so the app picks up its public address:

      ${c.cyan}npm run build && npm run start${c.reset}

  Then share this link with anyone, on any device:

      ${c.bold}${c.cyan}${url}${c.reset}

  ${c.yellow}One caveat about media.${c.reset} The tunnel carries HTTP and WebSocket, so the
  app, chat and signalling all work anywhere. WebRTC audio and video are UDP
  and travel directly to this machine instead, so people outside your network
  need one of:

    - UDP port 7882 forwarded to this machine, with LIVEKIT_NODE_IP set to
      your public address, or
    - a hosted SFU: set LIVEKIT_URL, LIVEKIT_API_KEY and LIVEKIT_API_SECRET
      to a LiveKit Cloud project and no router changes are needed.

  People on your own Wi-Fi can already see and hear each other.

  ${c.dim}Leave this running. Ctrl+C closes the tunnel and the URL stops working.${c.reset}
  ${c.dim}A free tunnel gets a new URL every restart.${c.reset}
`);
}
