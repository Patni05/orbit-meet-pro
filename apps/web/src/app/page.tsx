import {
  Hand,
  Lock,
  MessageSquare,
  MonitorUp,
  Server,
  Smartphone,
  Sparkles,
  Users,
  Video,
} from 'lucide-react';
import type { ReactNode } from 'react';
import { MeetingLauncher } from '@/components/site/MeetingLauncher';
import { SiteFooter } from '@/components/site/SiteFooter';
import { SiteHeader } from '@/components/site/SiteHeader';

const FEATURES = [
  {
    icon: Video,
    title: 'HD video meetings',
    body: 'Adaptive simulcast keeps every face sharp on a good connection and keeps the call alive on a poor one.',
  },
  {
    icon: MonitorUp,
    title: 'Screen sharing',
    body: 'Present a whole screen, a single window, or one browser tab. The layout rearranges itself around what you share.',
  },
  {
    icon: Lock,
    title: 'Secure rooms',
    body: 'Unguessable meeting codes, optional passcodes, a waiting room, and a lock that closes the door mid-meeting.',
  },
  {
    icon: MessageSquare,
    title: 'Realtime chat',
    body: 'Messages arrive instantly, survive a reconnect, and stay with the meeting so nobody loses the link they pasted.',
  },
  {
    icon: Smartphone,
    title: 'Every device',
    body: 'A real mobile layout, not a shrunken desktop one. Works in Chrome, Edge, Firefox and Safari.',
  },
  {
    icon: Server,
    title: 'Self-hostable',
    body: 'Runs on your own servers with open-source infrastructure. No per-seat licence and no vendor lock-in.',
  },
];

const CONTROLS = [
  { icon: Users, label: 'Host and co-host roles' },
  { icon: Hand, label: 'Raise hand, in order' },
  { icon: Sparkles, label: 'Reactions that fade' },
];

export default function LandingPage() {
  return (
    <div className="flex min-h-dvh flex-col">
      <SiteHeader />

      <main id="main" className="flex-1">
        {/* ---------------------------------------------------------- hero */}
        <section className="relative overflow-hidden">
          {/* Decorative orbit arcs, echoing the logo. */}
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 -z-10 overflow-hidden"
          >
            <div className="absolute -right-40 -top-40 h-[34rem] w-[34rem] rounded-full bg-gradient-to-br from-brand-200/50 to-accent-400/25 blur-3xl dark:from-brand-600/20 dark:to-accent-600/10" />
            <div className="absolute -bottom-52 -left-32 h-[28rem] w-[28rem] rounded-full bg-gradient-to-tr from-accent-400/25 to-brand-300/35 blur-3xl dark:from-accent-600/10 dark:to-brand-700/15" />
          </div>

          <div className="mx-auto max-w-6xl px-4 pb-16 pt-16 sm:px-6 sm:pb-24 sm:pt-24">
            <div className="max-w-3xl">
              <p className="inline-flex items-center gap-2 rounded-full border border-brand-200 bg-brand-50 px-3 py-1 text-xs font-medium text-brand-700 dark:border-brand-500/25 dark:bg-brand-500/10 dark:text-brand-300">
                <Sparkles className="h-3.5 w-3.5" />
                Open source · WebRTC · Self-hosted
              </p>

              <h1 className="mt-5 text-4xl font-semibold tracking-tight text-balance sm:text-6xl">
                Meet. Talk.{' '}
                <span className="bg-gradient-to-r from-brand-600 to-accent-500 bg-clip-text text-transparent">
                  Collaborate.
                </span>
              </h1>

              <p className="mt-5 max-w-xl text-lg text-ink-600 dark:text-ink-300">
                Video meetings that start in one click and run on infrastructure you own. Share a link,
                and anyone can join from a browser — no downloads, no accounts required.
              </p>

              <div className="mt-8 max-w-2xl">
                <MeetingLauncher />
                <p className="mt-3 text-sm text-ink-500 dark:text-ink-400">
                  Paste a meeting link or type a code like{' '}
                  <code className="rounded bg-ink-100 px-1.5 py-0.5 font-mono text-xs dark:bg-white/10">
                    abcd-efgh-ijkl
                  </code>
                </p>
              </div>
            </div>

            {/* Abstract product illustration — an original composition, not a screenshot. */}
            <div className="mt-16 rounded-2xl border border-ink-200/70 bg-white/70 p-3 shadow-2xl shadow-brand-900/5 backdrop-blur dark:border-white/10 dark:bg-ink-850/70">
              <div className="rounded-xl bg-ink-950 p-3">
                <div className="mb-3 flex items-center justify-between px-1">
                  <div className="flex items-center gap-2">
                    <span className="h-2.5 w-2.5 rounded-full bg-danger-500/80" />
                    <span className="h-2.5 w-2.5 rounded-full bg-warning-500/80" />
                    <span className="h-2.5 w-2.5 rounded-full bg-success-500/80" />
                  </div>
                  <span className="rounded-full bg-white/10 px-2.5 py-1 text-[11px] font-medium text-ink-200">
                    Weekly sync · 24:16
                  </span>
                </div>

                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                  {[
                    'from-brand-500/35 to-brand-700/25',
                    'from-accent-500/35 to-accent-600/25',
                    'from-emerald-500/30 to-teal-600/25',
                    'from-sky-500/30 to-blue-700/25',
                    'from-rose-500/30 to-pink-600/25',
                    'from-amber-500/30 to-orange-600/25',
                  ].map((gradient, index) => (
                    <div
                      key={gradient}
                      className={`relative aspect-video overflow-hidden rounded-lg bg-gradient-to-br ${gradient} ${
                        index === 0 ? 'ring-2 ring-success-400/70' : ''
                      }`}
                    >
                      <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_35%,rgba(255,255,255,0.18),transparent_60%)]" />
                      <span className="absolute bottom-1.5 left-2 rounded bg-black/40 px-1.5 py-0.5 text-[10px] font-medium text-white/90">
                        {['Priya', 'Marcus', 'Lena', 'Tomás', 'Aisha', 'Jonas'][index]}
                      </span>
                    </div>
                  ))}
                </div>

                <div className="mt-3 flex items-center justify-center gap-2">
                  {[...Array(6)].map((_, index) => (
                    <span
                      key={index}
                      className={`h-9 w-9 rounded-full ${
                        index === 5 ? 'bg-danger-600' : 'bg-white/10'
                      }`}
                    />
                  ))}
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ------------------------------------------------------ features */}
        <section className="border-t border-ink-100 bg-white py-20 dark:border-white/10 dark:bg-ink-900">
          <div className="mx-auto max-w-6xl px-4 sm:px-6">
            <div className="max-w-2xl">
              <h2 className="text-3xl font-semibold tracking-tight sm:text-4xl">
                Everything a meeting actually needs
              </h2>
              <p className="mt-4 text-ink-600 dark:text-ink-300">
                Built around the things that go wrong in real calls: bad networks, blocked cameras,
                people who need to be let in, and the one person who forgets to mute.
              </p>
            </div>

            <div className="mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
              {FEATURES.map((feature) => (
                <FeatureCard key={feature.title} icon={<feature.icon className="h-5 w-5" />} title={feature.title}>
                  {feature.body}
                </FeatureCard>
              ))}
            </div>

            <ul className="mt-10 flex flex-wrap gap-3">
              {CONTROLS.map((control) => (
                <li
                  key={control.label}
                  className="inline-flex items-center gap-2 rounded-full border border-ink-200 px-3.5 py-1.5 text-sm text-ink-600 dark:border-white/10 dark:text-ink-300"
                >
                  <control.icon className="h-4 w-4 text-brand-500" />
                  {control.label}
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* --------------------------------------------------------- close */}
        <section className="bg-gradient-to-br from-brand-600 to-accent-600 py-20">
          <div className="mx-auto max-w-3xl px-4 text-center sm:px-6">
            <h2 className="text-3xl font-semibold tracking-tight text-white sm:text-4xl">
              Start a meeting in one click
            </h2>
            <p className="mx-auto mt-4 max-w-xl text-brand-50">
              No install, no plugin. Create a room, send the link, and talk.
            </p>
            <div className="mx-auto mt-8 max-w-xl rounded-2xl bg-white/10 p-4 backdrop-blur">
              <MeetingLauncher compact />
            </div>
          </div>
        </section>
      </main>

      <SiteFooter />
    </div>
  );
}

function FeatureCard({
  icon,
  title,
  children,
}: {
  icon: ReactNode;
  title: string;
  children: ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-ink-200/80 bg-white p-6 transition-shadow hover:shadow-lg hover:shadow-brand-900/5 dark:border-white/10 dark:bg-ink-850">
      <div className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-brand-50 text-brand-600 dark:bg-brand-500/15 dark:text-brand-300">
        {icon}
      </div>
      <h3 className="mt-4 font-semibold">{title}</h3>
      <p className="mt-2 text-sm leading-relaxed text-ink-600 dark:text-ink-400">{children}</p>
    </div>
  );
}
