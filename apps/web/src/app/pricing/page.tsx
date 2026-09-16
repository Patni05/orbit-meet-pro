import { Check, Server } from 'lucide-react';
import Link from 'next/link';
import type { Metadata } from 'next';
import { SiteFooter } from '@/components/site/SiteFooter';
import { SiteHeader } from '@/components/site/SiteHeader';
import { Button } from '@/components/ui/primitives';

export const metadata: Metadata = {
  title: 'Pricing',
  description: 'Orbit is open source and free to self-host. Pay only for the servers you run it on.',
};

const TIERS = [
  {
    name: 'Self-hosted',
    price: 'Free',
    cadence: 'forever',
    description: 'Run Orbit on your own infrastructure. The whole thing, no feature gates.',
    features: [
      'Unlimited meetings and participants',
      'Every feature: chat, screen sharing, waiting room, recording',
      'Your data stays on your servers',
      'PostgreSQL, Redis, LiveKit and Coturn — all open source',
      'Community support',
    ],
    cta: { label: 'Get started', href: '/signup' },
    highlighted: true,
  },
  {
    name: 'Team',
    price: 'Your hosting bill',
    cadence: 'per month',
    description: 'The same software on a server you rent. A small VPS comfortably handles a team.',
    features: [
      'Everything in Self-hosted',
      'Roughly 1 vCPU per 25 concurrent participants',
      'TURN relay for restrictive networks',
      'Server-side recording via LiveKit Egress',
      'Scales horizontally behind one Redis',
    ],
    cta: { label: 'Read the deployment guide', href: '/help' },
    highlighted: false,
  },
];

export default function PricingPage() {
  return (
    <div className="flex min-h-dvh flex-col">
      <SiteHeader />

      <main id="main" className="flex-1">
        <section className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-20">
          <div className="max-w-2xl">
            <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">
              No per-seat pricing. Ever.
            </h1>
            <p className="mt-4 text-lg text-ink-600 dark:text-ink-300">
              Orbit is open source. There is no licence to buy and no meeting minutes to meter — the
              only cost is the server you choose to run it on.
            </p>
          </div>

          <div className="mt-12 grid gap-6 lg:grid-cols-2">
            {TIERS.map((tier) => (
              <div
                key={tier.name}
                className={`rounded-2xl border p-7 ${
                  tier.highlighted
                    ? 'border-brand-500/40 bg-gradient-to-b from-brand-50 to-white shadow-lg dark:from-brand-500/10 dark:to-ink-850'
                    : 'border-ink-200/80 bg-white dark:border-white/10 dark:bg-ink-850'
                }`}
              >
                <h2 className="text-lg font-semibold">{tier.name}</h2>
                <p className="mt-3 flex items-baseline gap-2">
                  <span className="text-4xl font-semibold tracking-tight">{tier.price}</span>
                  <span className="text-sm text-ink-500 dark:text-ink-400">{tier.cadence}</span>
                </p>
                <p className="mt-3 text-sm text-ink-600 dark:text-ink-400">{tier.description}</p>

                <ul className="mt-6 space-y-3">
                  {tier.features.map((feature) => (
                    <li key={feature} className="flex items-start gap-2.5 text-sm">
                      <Check className="mt-0.5 h-4 w-4 shrink-0 text-brand-500" />
                      <span className="text-ink-700 dark:text-ink-300">{feature}</span>
                    </li>
                  ))}
                </ul>

                <Link href={tier.cta.href} className="mt-7 block">
                  <Button fullWidth variant={tier.highlighted ? 'primary' : 'secondary'}>
                    {tier.cta.label}
                  </Button>
                </Link>
              </div>
            ))}
          </div>

          <div className="mt-10 flex items-start gap-3 rounded-2xl border border-ink-200/80 bg-ink-50 p-5 dark:border-white/10 dark:bg-white/5">
            <Server className="mt-0.5 h-5 w-5 shrink-0 text-brand-500" />
            <p className="text-sm text-ink-600 dark:text-ink-400">
              <span className="font-medium text-ink-900 dark:text-ink-100">Why so little?</span> Media
              never passes through a vendor. Your participants connect to your own SFU, so the bill is
              bandwidth and CPU rather than a subscription.
            </p>
          </div>
        </section>
      </main>

      <SiteFooter />
    </div>
  );
}
