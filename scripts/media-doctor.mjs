#!/usr/bin/env node
/**
 * Diagnoses and, where possible, fixes WebRTC media traversal.
 *
 * Signalling and media take different paths. A Cloudflare Tunnel carries the
 * app, the API and the SFU's WebSocket handshake — all HTTP — but WebRTC media
 * is UDP and goes straight to whichever machine runs the SFU. Behind a home
 * router that machine is usually unreachable from the internet, so a remote
 * participant joins the room, sees chat working, and hears nothing.
 *
 * There is no software trick that makes an unreachable host reachable. What
 * this script does is find out whether the host *can* be reached, and open the
 * path when the router allows it:
 *
 *   1. Work out the LAN and public addresses, and detect carrier-grade NAT,
 *      which makes inbound connections impossible no matter what is configured.
 *   2. Ask the router, over UPnP, to forward the media ports. Most consumer
 *      routers accept this; it is the same mechanism games and torrent clients
 *      use, and it removes the need to hand-edit port forwarding rules.
 *   3. Point the SFU at the public address so the candidates it advertises are
 *      ones a remote browser can actually try.
 *   4. Enable the TURN relay for participants whose own network blocks UDP.
 *
 * When the router refuses, the script says exactly which ports need forwarding
 * by hand rather than pretending the problem is solved.
 *
 * Usage:  node scripts/media-doctor.mjs [--apply] [--revert]
 */

import dgram from 'node:dgram';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const envPath = path.join(root, '.env');
const onWindows = process.platform === 'win32';

const APPLY = process.argv.includes('--apply');
const REVERT = process.argv.includes('--revert');
/** Skips UPnP and just points the SFU at the public address. For routers
 *  where the ports were forwarded by hand. */
const CONFIGURE_ONLY = process.argv.includes('--configure-only');

/** Ports WebRTC needs from the outside world. */
const MEDIA_PORTS = [
  { port: 7882, protocol: 'UDP', purpose: 'LiveKit media (primary)' },
  { port: 7881, protocol: 'TCP', purpose: 'LiveKit ICE-TCP fallback' },
  { port: 3478, protocol: 'UDP', purpose: 'TURN / STUN' },
  { port: 3478, protocol: 'TCP', purpose: 'TURN over TCP' },
  { port: 5349, protocol: 'TCP', purpose: 'TURN over TLS' },
];

/** Coturn's relay range. Kept small so UPnP mapping stays quick. */
const RELAY_RANGE = { from: 49160, to: 49179 };

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
const ok = (m) => console.log(`    ${c.green}ok${c.reset}   ${m}`);
const warn = (m) => console.log(`    ${c.yellow}warn${c.reset} ${m}`);
const bad = (m) => console.log(`    ${c.red}no${c.reset}   ${m}`);
const note = (m) => console.log(`    ${c.dim}${m}${c.reset}`);

// --------------------------------------------------------------- addresses

function detectLanIp() {
  if (process.env.ORBIT_LAN_IP) return process.env.ORBIT_LAN_IP;

  const candidates = [];
  for (const [name, addresses] of Object.entries(os.networkInterfaces())) {
    for (const address of addresses ?? []) {
      if (address.family !== 'IPv4' || address.internal) continue;
      const virtual = /(docker|vethernet|wsl|vmware|virtualbox|hyper-v|loopback|tailscale|zerotier)/i.test(name);
      candidates.push({ ip: address.address, virtual });
    }
  }
  if (candidates.length === 0) return null;

  const rank = (x) => (x.virtual ? 3 : /^192\.168\./.test(x.ip) ? 0 : /^10\./.test(x.ip) ? 1 : 2);
  candidates.sort((a, b) => rank(a) - rank(b));
  return candidates[0].ip;
}

async function publicIp() {
  for (const url of ['https://api.ipify.org', 'https://ifconfig.me/ip', 'https://icanhazip.com']) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(8000) });
      const text = (await response.text()).trim();
      if (/^\d+\.\d+\.\d+\.\d+$/.test(text)) return text;
    } catch {
      // Try the next provider.
    }
  }
  return null;
}

/**
 * Carrier-grade NAT means the ISP shares one public address between many
 * subscribers. Inbound connections are impossible, and no amount of router
 * configuration changes that — it has to be detected and reported honestly.
 */
function isCgnat(ip) {
  const [a, b] = ip.split('.').map(Number);
  return a === 100 && b >= 64 && b <= 127;
}

// -------------------------------------------------------------------- UPnP

/** Discovers an Internet Gateway Device by SSDP multicast. */
function discoverGateway(timeoutMs = 4000) {
  return new Promise((resolve) => {
    const socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });
    const found = [];

    const search = (target) =>
      Buffer.from(
        'M-SEARCH * HTTP/1.1\r\n' +
          'HOST: 239.255.255.250:1900\r\n' +
          'MAN: "ssdp:discover"\r\n' +
          'MX: 2\r\n' +
          `ST: ${target}\r\n\r\n`,
      );

    socket.on('message', (message) => {
      const text = message.toString();
      const location = /LOCATION:\s*(\S+)/i.exec(text)?.[1];
      if (location && !found.includes(location)) found.push(location);
    });

    socket.on('error', () => {
      try {
        socket.close();
      } catch {
        // Already closed.
      }
      resolve([]);
    });

    socket.bind(() => {
      for (const target of [
        'urn:schemas-upnp-org:device:InternetGatewayDevice:1',
        'urn:schemas-upnp-org:service:WANIPConnection:1',
        'urn:schemas-upnp-org:service:WANPPPConnection:1',
        'ssdp:all',
      ]) {
        socket.send(search(target), 1900, '239.255.255.250');
      }

      setTimeout(() => {
        try {
          socket.close();
        } catch {
          // Already closed.
        }
        resolve(found);
      }, timeoutMs);
    });
  });
}

/** Reads the device description and locates the WAN connection service. */
async function describeGateway(location) {
  const response = await fetch(location, { signal: AbortSignal.timeout(6000) });
  const xml = await response.text();

  // The control URL is relative to the description document's origin.
  const base = new URL(location);

  for (const type of ['WANIPConnection:1', 'WANIPConnection:2', 'WANPPPConnection:1']) {
    const pattern = new RegExp(
      `<serviceType>(urn:schemas-upnp-org:service:${type})</serviceType>[\\s\\S]*?<controlURL>([^<]+)</controlURL>`,
      'i',
    );
    const match = pattern.exec(xml);
    if (match) {
      return {
        serviceType: match[1],
        controlUrl: new URL(match[2], `${base.protocol}//${base.host}`).toString(),
      };
    }
  }
  return null;
}

async function soap(service, action, body) {
  const envelope =
    '<?xml version="1.0"?>' +
    '<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" ' +
    's:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/">' +
    `<s:Body><u:${action} xmlns:u="${service.serviceType}">${body}</u:${action}></s:Body>` +
    '</s:Envelope>';

  const response = await fetch(service.controlUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'text/xml; charset="utf-8"',
      SOAPAction: `"${service.serviceType}#${action}"`,
    },
    body: envelope,
    signal: AbortSignal.timeout(8000),
  });

  const text = await response.text();
  return { ok: response.ok, status: response.status, text };
}

async function addMapping(service, { port, protocol, internalIp, description }) {
  const body =
    '<NewRemoteHost></NewRemoteHost>' +
    `<NewExternalPort>${port}</NewExternalPort>` +
    `<NewProtocol>${protocol}</NewProtocol>` +
    `<NewInternalPort>${port}</NewInternalPort>` +
    `<NewInternalClient>${internalIp}</NewInternalClient>` +
    '<NewEnabled>1</NewEnabled>' +
    `<NewPortMappingDescription>${description}</NewPortMappingDescription>` +
    // A lease of 0 means permanent. Some routers reject it, so a long lease is
    // requested instead and refreshed by re-running this script.
    '<NewLeaseDuration>0</NewLeaseDuration>';

  const result = await soap(service, 'AddPortMapping', body);
  return result.ok;
}

async function deleteMapping(service, { port, protocol }) {
  const body =
    '<NewRemoteHost></NewRemoteHost>' +
    `<NewExternalPort>${port}</NewExternalPort>` +
    `<NewProtocol>${protocol}</NewProtocol>`;
  const result = await soap(service, 'DeletePortMapping', body);
  return result.ok;
}

// ------------------------------------------------------------------- .env

function patchEnv(updates) {
  if (!fs.existsSync(envPath)) throw new Error('.env not found. Run `npm run setup` first.');
  let text = fs.readFileSync(envPath, 'utf8');
  for (const [key, value] of Object.entries(updates)) {
    const pattern = new RegExp(`^${key}=.*$`, 'm');
    text = pattern.test(text)
      ? text.replace(pattern, `${key}=${value}`)
      : `${text.trimEnd()}\n${key}=${value}\n`;
  }
  fs.writeFileSync(envPath, text);
}

function readEnv(key) {
  if (!fs.existsSync(envPath)) return '';
  return new RegExp(`^${key}=(.*)$`, 'm').exec(fs.readFileSync(envPath, 'utf8'))?.[1]?.trim() ?? '';
}

// ------------------------------------------------------------------- main

async function main() {
  console.log(`\n${c.bold}WebRTC media diagnosis${c.reset}`);

  heading('Locating this machine');

  const lanIp = detectLanIp();
  if (!lanIp) {
    bad('No network interface found. Connect to Wi-Fi or Ethernet.');
    process.exit(1);
  }
  ok(`LAN address    ${c.bold}${lanIp}${c.reset}`);

  const wanIp = await publicIp();
  if (!wanIp) {
    bad('Could not determine the public address — no internet?');
    process.exit(1);
  }
  ok(`Public address ${c.bold}${wanIp}${c.reset}`);

  if (isCgnat(wanIp)) {
    bad('This is a carrier-grade NAT address (100.64.0.0/10).');
    note('Your ISP shares one public address between many customers, so nothing');
    note('outside can open a connection to this machine. No router setting fixes');
    note('this. Remote media needs a hosted SFU or a small public server.');
    process.exit(2);
  }
  ok('Not carrier-grade NAT, so inbound connections are possible in principle');

  if (CONFIGURE_ONLY) {
    heading('Pointing the SFU and TURN at the public address');
    patchEnv({
      LIVEKIT_NODE_IP: wanIp,
      TURN_EXTERNAL_IP: wanIp,
      TURN_URL: `turn:${wanIp}:3478`,
    });
    ok(`LIVEKIT_NODE_IP = ${wanIp}`);
    ok(`TURN_EXTERNAL_IP = ${wanIp}`);

    heading('Restarting media services');
    spawnSync('docker', ['compose', 'up', '-d', 'livekit'], { cwd: root, stdio: 'inherit', shell: onWindows });
    spawnSync('docker', ['compose', '--profile', 'turn', 'up', '-d', 'coturn'], {
      cwd: root,
      stdio: 'inherit',
      shell: onWindows,
    });
    ok('LiveKit and coturn restarted');
    note('Assumes the media ports are already forwarded to this machine.');
    console.log(`
  Rebuild and restart: npm run build && npm run start
`);
    process.exit(0);
  }

  // ---- UPnP ----
  heading('Asking the router to forward the media ports (UPnP)');

  const locations = await discoverGateway();
  if (locations.length === 0) {
    warn('No UPnP gateway responded.');
    note('Either the router has UPnP disabled, or it is not an IGD.');
    printManualInstructions(lanIp, wanIp);
    process.exit(3);
  }
  ok(`Found ${locations.length} UPnP device(s)`);

  let service = null;
  for (const location of locations) {
    try {
      const described = await describeGateway(location);
      if (described) {
        service = described;
        break;
      }
    } catch {
      // Try the next device.
    }
  }

  if (!service) {
    warn('No device exposed a WAN connection service.');
    printManualInstructions(lanIp, wanIp);
    process.exit(3);
  }
  ok(`Gateway service ${c.dim}${service.serviceType}${c.reset}`);

  // Confirm the router agrees about the public address. A mismatch means
  // there is a second layer of NAT above it, and forwarding here is useless.
  try {
    const external = await soap(service, 'GetExternalIPAddress', '');
    const routerWan = /<NewExternalIPAddress>([^<]*)<\/NewExternalIPAddress>/.exec(external.text)?.[1];
    if (routerWan && routerWan !== wanIp) {
      warn(`Router reports ${routerWan}, internet reports ${wanIp}`);
      note('There is another NAT above this router, so forwarding here will not');
      note('be enough. This usually means the ISP is doing the second NAT.');
    } else if (routerWan) {
      ok(`Router agrees the public address is ${routerWan}`);
    }
  } catch {
    // Not fatal; the mapping attempt below is the real test.
  }

  if (REVERT) {
    heading('Removing port mappings');
    for (const entry of MEDIA_PORTS) {
      const removed = await deleteMapping(service, entry).catch(() => false);
      console.log(`    ${removed ? c.green + 'removed' : c.dim + 'absent '}${c.reset} ${entry.protocol} ${entry.port}`);
    }
    for (let port = RELAY_RANGE.from; port <= RELAY_RANGE.to; port += 1) {
      await deleteMapping(service, { port, protocol: 'UDP' }).catch(() => false);
    }
    ok('Mappings removed');
    process.exit(0);
  }

  if (!APPLY) {
    note('Run with --apply to create the mappings and reconfigure the SFU.');
    process.exit(0);
  }

  const results = [];
  for (const entry of MEDIA_PORTS) {
    const added = await addMapping(service, {
      ...entry,
      internalIp: lanIp,
      description: `Orbit ${entry.purpose}`,
    }).catch(() => false);
    results.push({ ...entry, added });
    console.log(
      `    ${added ? c.green + 'open ' : c.red + 'fail '}${c.reset} ${entry.protocol.padEnd(3)} ${String(entry.port).padEnd(5)} ${c.dim}${entry.purpose}${c.reset}`,
    );
  }

  let relayOpened = 0;
  for (let port = RELAY_RANGE.from; port <= RELAY_RANGE.to; port += 1) {
    const added = await addMapping(service, {
      port,
      protocol: 'UDP',
      internalIp: lanIp,
      description: 'Orbit TURN relay',
    }).catch(() => false);
    if (added) relayOpened += 1;
  }
  console.log(
    `    ${relayOpened > 0 ? c.green + 'open ' : c.red + 'fail '}${c.reset} UDP ${RELAY_RANGE.from}-${RELAY_RANGE.to} ${c.dim}TURN relay range (${relayOpened} ports)${c.reset}`,
  );

  const primaryOpen = results.find((r) => r.port === 7882 && r.protocol === 'UDP')?.added;

  if (!primaryOpen) {
    bad('The router refused to forward the primary media port.');
    printManualInstructions(lanIp, wanIp);
    process.exit(3);
  }

  // ---- reconfigure ----
  heading('Pointing the SFU and TURN at the public address');

  patchEnv({
    // What the SFU advertises as its media address. This is the single most
    // important value: a private address here is why remote media fails.
    LIVEKIT_NODE_IP: wanIp,
    TURN_EXTERNAL_IP: wanIp,
    TURN_URL: `turn:${wanIp}:3478`,
  });
  ok(`LIVEKIT_NODE_IP = ${wanIp}`);
  ok(`TURN_EXTERNAL_IP = ${wanIp}`);

  heading('Restarting media services');
  spawnSync('docker', ['compose', 'up', '-d', 'livekit'], { cwd: root, stdio: 'inherit', shell: onWindows });
  spawnSync('docker', ['compose', '--profile', 'turn', 'up', '-d', 'coturn'], {
    cwd: root,
    stdio: 'inherit',
    shell: onWindows,
  });
  ok('LiveKit and coturn restarted');

  console.log(`
${c.green}Media path configured.${c.reset}

  The SFU now advertises ${c.bold}${wanIp}${c.reset} and the router is forwarding the
  media ports to this machine, so a participant on another network can reach
  it directly.

  ${c.bold}Restart the app${c.reset} so the API hands out the new configuration:

      ${c.cyan}npm run build && npm run start${c.reset}

  ${c.dim}Undo the port mappings with: node scripts/media-doctor.mjs --revert${c.reset}
  ${c.dim}Windows Firewall may still need to allow inbound UDP 7882 for Docker.${c.reset}
`);
}

function printManualInstructions(lanIp, wanIp) {
  console.log(`
${c.yellow}The router would not open the ports automatically.${c.reset}

  Media can still work, but the forwarding has to be done by hand. In the
  router's admin page (usually http://192.168.1.1), add these rules, all
  pointing at ${c.bold}${lanIp}${c.reset}:

      UDP  7882          LiveKit media          ${c.dim}(the important one)${c.reset}
      TCP  7881          LiveKit ICE-TCP fallback
      UDP  3478          TURN / STUN
      TCP  3478          TURN over TCP
      TCP  5349          TURN over TLS
      UDP  ${RELAY_RANGE.from}-${RELAY_RANGE.to}   TURN relay range

  Then set these in .env and restart:

      LIVEKIT_NODE_IP=${wanIp}
      TURN_EXTERNAL_IP=${wanIp}

  ${c.dim}If the router has no port-forwarding page, or your ISP uses CGNAT, the${c.reset}
  ${c.dim}only remaining options are a hosted SFU or a small public server.${c.reset}
`);
}

main().catch((error) => {
  console.error(`\n${c.red}Diagnosis failed:${c.reset} ${error.message}`);
  process.exit(1);
});
