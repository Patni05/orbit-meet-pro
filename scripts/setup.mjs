#!/usr/bin/env node
/**
 * One-command setup.
 *
 * Takes a fresh clone to a running stack: checks prerequisites, writes a .env
 * with freshly generated secrets, starts the infrastructure containers, waits
 * for them to become healthy, then applies migrations and builds the shared
 * package.
 *
 * Safe to re-run. An existing .env is never overwritten, because doing so
 * would silently invalidate every session and meeting already in the database.
 */

import { execFileSync, spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const envPath = path.join(root, '.env');
const examplePath = path.join(root, '.env.example');
const onWindows = process.platform === 'win32';

const c = {
  reset: '[0m',
  dim: '[2m',
  red: '[31m',
  green: '[32m',
  yellow: '[33m',
  cyan: '[36m',
};

let step = 0;
const heading = (message) => console.log(`\n${c.cyan}[${++step}] ${message}${c.reset}`);
const ok = (message) => console.log(`    ${c.green}ok${c.reset} ${message}`);
const note = (message) => console.log(`    ${c.dim}${message}${c.reset}`);
const warn = (message) => console.log(`    ${c.yellow}!${c.reset}  ${message}`);

function fail(message, detail) {
  console.error(`\n${c.red}Setup failed: ${message}${c.reset}`);
  if (detail) console.error(`${c.dim}${detail}${c.reset}`);
  process.exit(1);
}

/**
 * Quotes arguments that contain spaces.
 *
 * On Windows these commands run through cmd.exe, which re-splits the argument
 * list on whitespace. Without quoting, a project path like
 * "D:\Google Meet Sasta" arrives as three separate arguments and the command
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
    const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
    fail(`${command} ${args.join(' ')} failed`, options.quiet ? output : undefined);
  }
  return result;
}

/** Blocks the main thread briefly without pulling in a timer dependency. */
function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

// ------------------------------------------------------------- prerequisites

heading('Checking prerequisites');

const nodeMajor = Number(process.versions.node.split('.')[0]);
if (nodeMajor < 20) fail(`Node 20 or newer is required (found ${process.versions.node}).`);
ok(`Node ${process.versions.node}`);

try {
  const version = execFileSync('docker', ['--version'], { encoding: 'utf8', shell: onWindows });
  ok(version.trim());
} catch {
  fail(
    'Docker is required but was not found on PATH.',
    'Install Docker Desktop (https://docs.docker.com/get-docker/) and make sure it is running.',
  );
}

if (run('docker', ['info'], { quiet: true, allowFailure: true }).status !== 0) {
  fail('Docker is installed but the daemon is not responding.', 'Start Docker Desktop and run this again.');
}
ok('Docker daemon is running');

// ---------------------------------------------------------------- environment

heading('Preparing .env');

if (fs.existsSync(envPath)) {
  ok('.env already exists, leaving it untouched');
  note('Delete it and re-run for fresh secrets. That invalidates existing sessions.');
} else {
  if (!fs.existsSync(examplePath)) fail('.env.example is missing, so .env cannot be generated.');

  // Distinct random value per secret. LiveKit expects a base64 secret.
  const hex = (bytes) => crypto.randomBytes(bytes).toString('hex');
  const replacements = {
    JWT_SECRET: hex(48),
    JWT_REFRESH_SECRET: hex(48),
    LIVEKIT_API_SECRET: crypto.randomBytes(32).toString('base64'),
    POSTGRES_PASSWORD: hex(18),
    TURN_PASSWORD: hex(18),
  };

  let contents = fs.readFileSync(examplePath, 'utf8');
  for (const [key, value] of Object.entries(replacements)) {
    const pattern = new RegExp(`^${key}=.*$`, 'm');
    contents = pattern.test(contents)
      ? contents.replace(pattern, `${key}=${value}`)
      : `${contents.trimEnd()}\n${key}=${value}\n`;
  }

  // The connection string embeds the password, so it must be rewritten to match.
  const user = /^POSTGRES_USER=(.*)$/m.exec(contents)?.[1]?.trim() || 'orbit';
  const database = /^POSTGRES_DB=(.*)$/m.exec(contents)?.[1]?.trim() || 'orbit';
  contents = contents.replace(
    /^DATABASE_URL=.*$/m,
    `DATABASE_URL=postgresql://${user}:${replacements.POSTGRES_PASSWORD}@127.0.0.1:5432/${database}?schema=public`,
  );

  fs.writeFileSync(envPath, contents);
  ok('.env written with freshly generated secrets');
  note('Keep it out of version control; it is already covered by .gitignore.');
}

// ---------------------------------------------------------------- dependencies

heading('Installing dependencies');
if (fs.existsSync(path.join(root, 'node_modules'))) {
  ok('node_modules present, skipping install');
  note('Run npm install yourself if package.json has changed.');
} else {
  run('npm', ['install']);
  ok('Dependencies installed');
}

// -------------------------------------------------------------- infrastructure

heading('Starting infrastructure');
run('docker', ['compose', 'up', '-d', 'postgres', 'redis', 'livekit']);
ok('postgres, redis and livekit started');

heading('Waiting for containers to become healthy');

const pending = new Set(['orbit-postgres', 'orbit-redis']);
const deadline = Date.now() + 120_000;

while (pending.size > 0 && Date.now() < deadline) {
  for (const service of [...pending]) {
    const result = run('docker', ['inspect', '-f', '{{.State.Health.Status}}', service], {
      quiet: true,
      allowFailure: true,
    });
    if (result.stdout?.trim() === 'healthy') {
      ok(`${service} is healthy`);
      pending.delete(service);
    }
  }
  if (pending.size > 0) sleep(1500);
}

if (pending.size > 0) {
  fail(
    `Timed out waiting for: ${[...pending].join(', ')}`,
    'Inspect them with: docker compose logs postgres redis',
  );
}

// ------------------------------------------------------------------- database

heading('Building the shared package');
run('npm', ['run', 'build:shared']);
ok('@orbit/shared built');

heading('Applying database migrations');

/**
 * On Windows, `prisma generate` cannot replace the query engine DLL while a
 * dev server has it open, and fails with EPERM. That is a re-run inconvenience
 * rather than a broken setup, so a failure is only fatal when no client has
 * been generated yet.
 */
if (run('npm', ['run', 'db:generate'], { allowFailure: true, quiet: true }).status !== 0) {
  const generated = fs.existsSync(path.join(root, 'node_modules', '.prisma', 'client', 'index.js'));
  if (!generated) {
    fail(
      'prisma generate failed and no Prisma client is present.',
      'Stop any running dev server and re-run: npm run setup',
    );
  }
  warn('prisma generate could not update the client (is a dev server running?).');
  note('The existing client is being reused. Re-run setup after stopping dev servers if the schema changed.');
} else {
  ok('Prisma client generated');
}

if (run('npm', ['run', 'db:deploy'], { allowFailure: true }).status !== 0) {
  warn('db:deploy failed; falling back to db:push for a fresh database.');
  run('npm', ['run', 'db:push']);
}
ok('Database schema is up to date');

// ----------------------------------------------------------------------- done

console.log(`
${c.green}Setup complete.${c.reset}

  Start everything:      ${c.cyan}npm run dev${c.reset}
  Then open:             ${c.cyan}http://localhost:3000${c.reset}

  Unit tests:            ${c.cyan}npm test${c.reset}
  End-to-end tests:      ${c.cyan}npm run test:e2e${c.reset}  ${c.dim}(requires npm run dev)${c.reset}
  Stop infrastructure:   ${c.cyan}npm run infra:down${c.reset}
`);
