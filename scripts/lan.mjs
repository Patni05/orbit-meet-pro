#!/usr/bin/env node
/**
 * Prepares the app for testing on a phone or a second machine.
 *
 * Two things stop a LAN device from joining a meeting, and this handles both:
 *
 *   1. The browser refuses camera and microphone access over plain HTTP.
 *      Outside localhost, getUserMedia requires a secure context, so the app
 *      has to be served over HTTPS even on a home network.
 *
 *   2. The SFU advertises a media address for peers to reach. Left at
 *      127.0.0.1 that address means "this phone", so media never connects.
 *
 * So: detect the LAN address, issue a self-signed certificate for it, point
 * the app and the SFU at it, and put everything behind one TLS origin — one
 * certificate for the device to accept rather than one per port.
 *
 * Re-running is safe and picks up a changed network address.
 */

import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const certDir = path.join(root, 'infrastructure', 'nginx', 'certs');
const envPath = path.join(root, '.env');
const onWindows = process.platform === 'win32';
const PORT = 8443;

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

/**
 * Quotes arguments that contain spaces.
 *
 * On Windows these commands run through cmd.exe, which re-splits the argument
 * list on whitespace. Without quoting, a project path like
 * "D:\\Google Meet Sasta" arrives as three separate arguments and the command
 * fails with a confusing complaint about an unknown option.
 */
function quoteForShell(args) {
  if (!onWindows) return args;
  return args.map((arg) => (/\s/.test(arg) && !arg.startsWith('"') ? `"${arg}"` : arg));
}

function run(command, args, options = {}) {
  const result = spawnSync(command, quoteForShell(args), {
    cwd: root,
    stdio: options.quiet ? 'pipe' : 'inherit',
    shell: onWindows,
    encoding: 'utf8',
    ...options,
  });
  if (result.status !== 0 && !options.allowFailure) {
    fail(`${command} ${args.join(' ')} failed`, `${result.stdout ?? ''}${result.stderr ?? ''}`);
  }
  return result;
}

/**
 * Picks the address other devices on the network can actually reach.
 *
 * Virtual adapters from Docker, WSL and VPN software also present private
 * addresses, and choosing one of those produces a URL that silently fails from
 * a phone. Ordinary home and office ranges are preferred, and an explicit
 * ORBIT_LAN_IP always wins.
 */
function detectLanIp() {
  if (process.env.ORBIT_LAN_IP) return process.env.ORBIT_LAN_IP;

  const candidates = [];
  for (const [name, addresses] of Object.entries(os.networkInterfaces())) {
    for (const address of addresses ?? []) {
      if (address.family !== 'IPv4' || address.internal) continue;
      const looksVirtual = /(docker|vethernet|wsl|vmware|virtualbox|hyper-v|loopback|tailscale|zerotier)/i.test(name);
      candidates.push({ name, ip: address.address, virtual: looksVirtual });
    }
  }

  if (candidates.length === 0) return null;

  const rank = (candidate) => {
    if (candidate.virtual) return 3;
    // 192.168.x and 10.x are the usual home and office ranges.
    if (/^192\.168\./.test(candidate.ip)) return 0;
    if (/^10\./.test(candidate.ip)) return 1;
    return 2;
  };

  candidates.sort((a, b) => rank(a) - rank(b));
  return candidates[0].ip;
}

// ------------------------------------------------------------------ address

heading('Finding this machine on the network');

const ip = detectLanIp();
if (!ip) {
  fail(
    'No network address was found.',
    'Connect to Wi-Fi or Ethernet, or set ORBIT_LAN_IP to the address you want to use.',
  );
}
ok(`Using ${c.bold}${ip}${c.reset}`);
note('Override with ORBIT_LAN_IP=<address> if this is the wrong adapter.');

// -------------------------------------------------------------- certificate

heading('Issuing a certificate for that address');

fs.mkdirSync(certDir, { recursive: true });
const crtPath = path.join(certDir, 'orbit-lan.crt');
const keyPath = path.join(certDir, 'orbit-lan.key');

// A certificate is reissued when the address changes, since the address is
// baked into the SAN and a stale one fails validation on the device.
const existingMatches =
  fs.existsSync(crtPath) &&
  (() => {
    try {
      const text = execFileSync('openssl', quoteForShell(['x509', '-in', crtPath, '-noout', '-text']), {
        encoding: 'utf8',
        shell: onWindows,
      });
      return text.includes(`IP Address:${ip}`);
    } catch {
      return false;
    }
  })();

if (existingMatches) {
  ok('Existing certificate already covers this address');
} else {
  try {
    execFileSync('openssl', ['version'], { stdio: 'pipe', shell: onWindows });
  } catch {
    fail('openssl was not found on PATH.', 'Install OpenSSL, or use Git Bash which bundles it.');
  }

  // The IP must appear in subjectAltName: browsers ignore the legacy common
  // name entirely, so a certificate without the SAN is rejected outright.
  const config = [
    '[req]',
    'distinguished_name = dn',
    'x509_extensions = ext',
    'prompt = no',
    '',
    '[dn]',
    'CN = Orbit LAN development',
    '',
    '[ext]',
    'subjectAltName = @alt',
    'basicConstraints = critical, CA:FALSE',
    'keyUsage = critical, digitalSignature, keyEncipherment',
    'extendedKeyUsage = serverAuth',
    '',
    '[alt]',
    `IP.1 = ${ip}`,
    'IP.2 = 127.0.0.1',
    'DNS.1 = localhost',
    '',
  ].join('\n');

  const configPath = path.join(certDir, 'openssl.cnf');
  fs.writeFileSync(configPath, config);

  run(
    'openssl',
    [
      'req', '-x509', '-nodes',
      '-newkey', 'rsa:2048',
      '-keyout', keyPath,
      '-out', crtPath,
      // Kept under the ~13 months that browsers accept for leaf certificates.
      '-days', '365',
      '-config', configPath,
    ],
    { quiet: true },
  );

  ok(`Self-signed certificate written for ${ip}`);
  note('Self-signed, so the device shows a one-time warning to accept.');
}

// ---------------------------------------------------------------- .env

heading('Pointing the app at the proxy');

if (!fs.existsSync(envPath)) fail('.env not found. Run `npm run setup` first.');

const origin = `https://${ip}:${PORT}`;

/**
 * Only additive changes.
 *
 * Earlier this rewrote API_URL and friends to point at the proxy, which broke
 * http://localhost:3000 — the desktop browser has never accepted the proxy's
 * self-signed certificate, so its requests failed and the app reported that it
 * could not reach the server. Instead the proxy origin is merely *announced*,
 * and the client picks the right base at runtime from the page it is on. Both
 * ways of opening the app keep working.
 */
const updates = {
  // Announced, not imposed: see serviceBases() in apps/web/src/lib/api.ts and
  // livekitUrlFor() in the API's join service.
  PROXY_ORIGINS: origin,
  NEXT_PUBLIC_PROXY_ORIGINS: origin,
  // Invitation links should be the address other devices can actually open.
  APP_URL: origin,
  // The address peers use for media. Not proxied — WebRTC goes direct.
  LIVEKIT_NODE_IP: ip,
};

let envText = fs.readFileSync(envPath, 'utf8');

// Keep a copy of the original values so the change is reversible.
const backupPath = path.join(root, '.env.local-backup');
if (!fs.existsSync(backupPath)) {
  fs.writeFileSync(backupPath, envText);
  note(`Previous .env saved to ${path.basename(backupPath)}`);
}

for (const [key, value] of Object.entries(updates)) {
  const pattern = new RegExp(`^${key}=.*$`, 'm');
  envText = pattern.test(envText)
    ? envText.replace(pattern, `${key}=${value}`)
    : `${envText.trimEnd()}\n${key}=${value}\n`;
}

fs.writeFileSync(envPath, envText);
ok('.env updated for LAN access');

// ------------------------------------------------------------ containers

heading('Restarting the SFU with the new media address');
run('docker', ['compose', 'up', '-d', 'livekit']);
ok(`LiveKit is advertising ${ip} for media`);

heading('Starting the HTTPS proxy');
run('docker', ['compose', '--profile', 'lan', 'up', '-d', 'proxy-lan']);
ok(`Proxy listening on ${origin}`);

// ------------------------------------------------------------------- done

console.log(`
${c.green}Ready.${c.reset}

  ${c.bold}Restart the dev servers${c.reset} so they pick up the new .env:

      ${c.cyan}npm run dev${c.reset}

  Then open this on the phone (same Wi-Fi):

      ${c.bold}${c.cyan}${origin}${c.reset}

  ${c.yellow}The certificate is self-signed${c.reset}, so the browser shows a warning the
  first time. Choose "Advanced" then "Proceed" — camera and microphone will
  not work until you do, because the page must be a secure context.

  ${c.dim}Troubleshooting${c.reset}
  ${c.dim}- Wrong address? Re-run with ORBIT_LAN_IP=<address> npm run lan${c.reset}
  ${c.dim}- Windows may block incoming connections; allow Node and Docker${c.reset}
  ${c.dim}  through the firewall on private networks.${c.reset}
  ${c.dim}- Back to localhost-only: restore .env.local-backup, then${c.reset}
  ${c.dim}  docker compose --profile lan down${c.reset}
`);
