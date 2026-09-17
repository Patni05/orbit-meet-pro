# Orbit

Self-hosted video meetings. Create a meeting, share a link, and talk — no
account needed to join, no per-seat licence, and no media passing through a
vendor you do not control.

Built on WebRTC with [LiveKit](https://livekit.io) as the SFU, so media flows
between participants and your own server rather than a third party.

## Live demo

**<https://min-bryant-organisms-speaking.trycloudflare.com>**

A real deployment, served over HTTPS through a Cloudflare Tunnel. You can open
it on a phone or a laptop and join a meeting with just a name.

Two things to know before you judge it by that link:

**The demo runs on a development machine, not a server.** It is live only while
that machine is awake, and a free Cloudflare Tunnel gets a new hostname every
time it restarts — so the URL above will eventually stop resolving. Anyone
running this themselves gets a permanent address by following
[Publishing it on the internet](#publishing-it-on-the-internet).

**Audio and video only connect for people on the host machine's own network.**
A tunnel carries HTTP and WebSocket; WebRTC media is UDP and travels directly
to whichever machine runs the SFU, which a home router does not expose. The
app, sign-in, chat, quizzes, polls and the whiteboard all work from anywhere.
[Media needs its own path](#media-needs-its-own-path) explains the two ways to
fix it, and `npm run media:doctor` diagnoses a particular network.

---

## Quick start

You need **Node 20+** and **Docker Desktop** (running).

```bash
git clone <your-fork> orbit && cd orbit
npm install
npm run setup     # generates .env, starts containers, applies migrations
npm run dev       # shared + API + web, all in watch mode
```

Then open <http://localhost:3000>.

`npm run setup` is safe to re-run. It never overwrites an existing `.env`,
because regenerating the JWT secrets would invalidate every session and every
meeting token already issued.

---

## What you get

| Area | Detail |
| --- | --- |
| **Joining** | Guests join with just a name. Hosts can require sign-in, a passcode, or both. |
| **Meetings** | Instant or scheduled, with a waiting room, a lock, and per-meeting policy. |
| **In-call** | Camera, microphone, screen sharing, chat, reactions, raised hands, grid/speaker layouts. |
| **Moderation** | Mute, remove, co-host, spotlight, per-meeting blocklist, announcements — all re-authorized server-side. |
| **Media locks** | Host can lock microphones or cameras for the whole room. A lock persists and the server refuses a locked participant, rather than greying out a button. |
| **Tasks** | A shared meeting task list everyone can read and only hosts can change, stored in the database so it survives reloads and reconnects. Co-hosts are opted in by the host. |
| **Presence checks** | Consent-based: a participant agrees first, then answers a prompt themselves. No camera, microphone or sensor is ever read, and an unanswered check simply expires. |
| **Polls** | Live polls whose tallies are genuinely withheld on the wire until they close. |
| **Quizzes** | Graded exams with a server-held clock, ranking, per-question analytics and CSV export. |
| **Whiteboard** | Shared board synced as strokes, with per-author undo, host permissions and PNG export. |
| **Personalisation** | 88 built-in avatars, command palette (Ctrl/Cmd+K), focus mode, picture-in-picture. |
| **Resilience** | Reconnects restore your seat rather than cloning you into the roster. |
| **Recording** | Optional, via LiveKit Egress. Audio only, never silent — every participant is told — and downloaded through an authorised route rather than a public URL. |

---

## Tests

260 automated checks, all passing, run against both localhost and the live
deployment:

```bash
npm test                                      # 51 unit tests
npm run test:e2e                              # 22 browser tests, two real browsers
node apps/api/scripts/test-moderation.mjs     # 36 checks
node apps/api/scripts/test-quiz.mjs           # 51 checks
node apps/api/scripts/test-whiteboard.mjs     # 36 checks
node apps/api/scripts/test-controls.mjs       # 57 checks
node apps/api/scripts/test-recording.mjs      # 7 checks
```

The integration suites talk to the realtime API exactly as a browser would,
and deliberately send things no UI would: host commands from a participant's
socket, answers after a quiz deadline, duplicate submissions, oversized
payloads. What they prove is that the *server* refuses them — a hidden button
is a convenience, never a boundary.

The browser suite drives two independent contexts through a real meeting with
Chromium's fake media devices, asserting that `<video>` elements actually
report frame sizes rather than that buttons exist.

---

## How it fits together

```
      browser                      your server                    media
  ┌──────────────┐            ┌────────────────────┐        ┌──────────────┐
  │  Next.js 15  │  HTTPS     │  Fastify API       │        │   LiveKit    │
  │  React 19    │◄──────────►│  auth, meetings    │◄──────►│   SFU        │
  │              │            │  moderation        │  admin │              │
  │  livekit-    │  WebSocket │                    │        │              │
  │  client      │◄──────────►│  Socket.IO gateway │        │              │
  └──────┬───────┘            └─────────┬──────────┘        └──────▲───────┘
         │                              │                          │
         │                     ┌────────┴────────┐                 │
         │                     │   PostgreSQL    │                 │
         │                     │   Redis         │                 │
         │                     └─────────────────┘                 │
         └───────────────── WebRTC (DTLS-SRTP) ────────────────────┘
```

Two connections do two different jobs, and keeping them separate is the central
design decision:

- **LiveKit** carries media. It never decides who is allowed to do what.
- **Socket.IO** carries authority — roster, chat, roles, moderation, waiting
  room. Every privileged action is re-checked against the caller's role on the
  server, so a hidden button is a convenience, not a security boundary.

PostgreSQL is the source of truth. Redis holds only coordination state:
pub/sub between API instances, presence counters, and short-lived join
sessions. Flushing Redis degrades presence; it never loses a meeting.

### Repository layout

```
apps/api         Fastify server, Socket.IO gateway, Prisma schema
apps/web         Next.js app (App Router) and the Playwright suite
packages/shared  Types, Zod schemas and pure helpers used by both sides
infrastructure/  LiveKit, Coturn and nginx configuration
scripts/         setup.mjs and development helpers
```

`packages/shared` is what keeps the two halves honest: the same Zod schemas
validate a request in the browser and again in the API, and the same meeting-code
parser runs in both places.

---

## Testing on a phone

Opening `http://<your-ip>:3000` on a phone **will not work**, and the reason is
not a bug you can configure away:

- Browsers only grant camera and microphone access in a **secure context**.
  `localhost` is exempt; a LAN address over plain HTTP is not. Without HTTPS
  the phone refuses to capture media at all.
- `localhost` in the client bundle means *the phone*, not your laptop.
- The SFU advertises a media address for peers to reach. Left at `127.0.0.1`,
  that address means "this phone", so media never connects.

One command handles all three:

```bash
npm run lan     # detects your LAN IP, issues a certificate, starts an HTTPS proxy
npm run dev     # restart so the dev servers pick up the new .env
```

Then open the printed `https://<your-ip>:8443` on the phone, on the same Wi-Fi.
The certificate is self-signed, so the browser shows a warning once — choose
**Advanced → Proceed**. Camera and microphone stay blocked until you do,
because the page has to be a secure context first.

Everything is served through that single HTTPS origin, so the phone has one
certificate to accept rather than one per port:

| Path | Goes to |
| --- | --- |
| `/` | the Next.js app |
| `/api/…` | the API (prefix stripped) |
| `/realtime` | the Socket.IO gateway |
| `/livekit/…` | the SFU's signalling endpoint |

Media itself does not pass through the proxy. WebRTC sends it directly over UDP
to the SFU, already encrypted with DTLS-SRTP.

```bash
npm run lan:off   # restore the previous .env and stop the proxy
```

If it picks the wrong network adapter — common with Docker, WSL or a VPN
installed — override it:

```bash
ORBIT_LAN_IP=192.168.1.35 npm run lan
```

On Windows you may also need to allow Node and Docker through the firewall on
private networks.

The end-to-end suite can be pointed at the proxy to verify this exact path:

```bash
E2E_BASE_URL=https://192.168.1.35:8443 \
E2E_API_URL=https://192.168.1.35:8443/api \
NODE_TLS_REJECT_UNAUTHORIZED=0 \
npm run test:e2e
```

---

## Publishing it on the internet

`npm run lan` is for your own Wi-Fi. To let anyone join from anywhere, put a
Cloudflare Tunnel in front of it:

```bash
npm run lan           # start the local reverse proxy (once)
npm run build         # production build — dev mode is far too slow over a tunnel
npm run start         # run the built app
npm run tunnel        # opens the tunnel, prints a public https:// URL
```

The tunnel presents a certificate Cloudflare already owns, so there is no
warning to click through on any device — which matters, because camera access
needs a secure context and users will not get one from a self-signed
certificate they have dismissed.

Leave `npm run tunnel` running; closing it retires the URL. A free tunnel gets
a new hostname on every restart, so the script rewrites `.env` and you rebuild.

### Media needs its own path

A tunnel carries HTTP and WebSocket. **WebRTC audio and video are UDP**, and
travel directly to whichever machine runs the SFU. Behind a home router that
machine is not reachable from the internet, so people outside your network will
join the room, see chat working, and hear nothing.

People on your own Wi-Fi are unaffected — they reach the SFU directly.

Two ways to fix it for everyone else:

**A hosted SFU (simplest).** Create a free project at
[cloud.livekit.io](https://cloud.livekit.io) and point media at it:

```bash
npm run livekit:cloud -- wss://your-project.livekit.cloud <api-key> <api-secret>
npm run build && npm run start
```

Media then flows through LiveKit's own servers. No router configuration, works
on mobile data, and no code changes — the app already speaks this protocol.
`npm run livekit:cloud -- --revert` switches back to the local SFU.

**Or forward a port.** Forward UDP `7882` to this machine and set
`LIVEKIT_NODE_IP` to your public address. Free and keeps media on your own
hardware, but many ISPs block it and a dynamic public IP will eventually move.

---

## Everyday commands

```bash
npm run dev            # everything, in watch mode
npm run dev:api        # API only
npm run dev:web        # web only

npm test               # unit tests: shared, api, web
npm run test:e2e       # Playwright, needs `npm run dev` running
npm run typecheck      # all three packages
npm run build          # production build

npm run infra:up       # postgres, redis, livekit
npm run infra:down
npm run infra:logs

npm run db:migrate     # create a migration during development
npm run db:studio      # browse the database
```

### Tests

Unit tests cover the pure logic that both sides depend on — meeting-code
parsing, password hashing, duration formatting, device-preference storage.

The end-to-end suite is the one that matters most. It drives **two independent
browser contexts** through a real meeting with Chromium's fake media devices,
so it exercises the genuine WebRTC path: capture, publish through the SFU,
subscribe, decode. Assertions are about observable behaviour — a `<video>`
element actually reporting a frame size, a message actually arriving in the
other browser — rather than about a button existing.

```bash
npm run dev            # in one terminal
npm run test:e2e       # in another
```

It also checks that moderation is enforced by the server, by calling a
host-only endpoint directly as a non-host and asserting it is refused.

---

## Configuration

`npm run setup` writes `.env` from `.env.example` with generated secrets. The
settings you are most likely to change:

| Variable | Purpose |
| --- | --- |
| `APP_URL`, `API_URL` | Public URLs. Must be correct for cookies and invitation links. |
| `DATABASE_URL` | PostgreSQL connection string. |
| `REDIS_URL` | Redis connection string. |
| `JWT_SECRET`, `JWT_REFRESH_SECRET` | Token signing. Changing these signs everyone out. |
| `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET` | SFU connection and admin credentials. |
| `TURN_*` | Relay for restrictive networks. See below. |
| `RECORDING_ENABLED` | Master switch for the recording feature. |
| `RATE_LIMIT_MAX`, `RATE_LIMIT_WINDOW` | Global HTTP budget. Sensitive routes are tighter. |

---

## Deploying

1. Point DNS at the host and terminate TLS — WebRTC requires a secure context,
   so `getUserMedia` will not work over plain HTTP anywhere but localhost.
2. Set `APP_URL` and `API_URL` to the public HTTPS URLs, and `COOKIE_SECURE=true`.
3. Generate fresh secrets. Never ship the development `.env`.
4. `npm run db:deploy` to apply migrations.
5. `docker compose up -d` — the compose file includes API, web and nginx
   profiles alongside the infrastructure.

### TURN

Some corporate and mobile networks block the UDP traffic WebRTC prefers. Without
a relay, those users connect to everything else and then sit in silence. Enable
the bundled Coturn service and set `TURN_EXTERNAL_IP` to the server's public
address.

### Sizing

Roughly **1 vCPU per 25 concurrent participants** is a reasonable starting
point. The client already reduces load adaptively:

- **Simulcast** publishes three quality layers, so each viewer receives what
  their connection and tile size can actually use.
- **Adaptive stream** drops the resolution of small tiles and pauses off-screen
  ones.
- **Dynacast** stops the SFU forwarding layers nobody is watching.

Audio is given priority and is the last thing to degrade, because a call with
blurry video is workable and a call with broken audio is not.

---

## Notes on a few decisions

**Permission is requested late.** The browser is asked for camera and
microphone access on the pre-join screen — the first moment the user has said
they intend to join — not on page load. A refusal is not fatal: the failure is
explained and joining stays available, because someone with a broken webcam
should still be able to attend.

**Refreshing does not clone you.** A per-tab session id in `sessionStorage`
lets the server resume the same participant row instead of creating a second
one, and the tab restores its own place in the meeting.

**Chat is rendered as text.** Messages are never passed through
`dangerouslySetInnerHTML`, so markup in a message is displayed rather than
executed. There is an end-to-end test that asserts exactly this.

**Redis is not a hard dependency of the request path.** Command clients use
bounded retries and a command timeout, and the rate limiter fails open. An
unreachable Redis therefore degrades presence and rate limiting instead of
hanging every request — which is what happens if command clients are configured
with unlimited retries, as the pub/sub clients deliberately are.

---

## Licence

MIT.

---

## Moderation model

Every privileged action is a *request* to the server, which re-reads the
caller's role from the database before acting. A hidden button is a
convenience, never a boundary — `apps/api/scripts/test-moderation.mjs` sends
host commands from a plain participant's socket specifically to prove they are
refused.

**Spotlight** promotes someone for the whole room, and outranks both the
automatic active speaker and each viewer's personal pin. A presentation still
wins, because that is what the presenter asked for.

**Blocking** is scoped to one meeting. A signed-in account stays blocked across
new sessions and devices; an anonymous guest can only be matched on the
meeting-scoped identity issued at join time. That is a real limit, stated
plainly: a guest who clears storage can return under a new identity. The
alternative is device fingerprinting, which is invasive and defeated by any
determined visitor anyway — a host who needs a firmer boundary should turn on
*Require sign-in*.

The block check runs in the join path **before a LiveKit token is minted**.
Checking later would still have handed SFU credentials to someone the host
barred, and a token alone is enough to reach the media server.

**Polls** withhold their tally rather than merely hiding it. While a poll is
open and the host chose to hide interim results, each option's `votes` is
`null` in the payload itself, so there is no number in the frame for a curious
participant to read. Hosts always see the running count.

```bash
node apps/api/scripts/test-moderation.mjs   # 36 checks, needs the API running
```
