import type { Metadata } from 'next';
import { SiteFooter } from '@/components/site/SiteFooter';
import { SiteHeader } from '@/components/site/SiteHeader';

export const metadata: Metadata = {
  title: 'Help',
  description: 'Troubleshooting for camera, microphone, screen sharing and connection problems in Orbit.',
};

const SECTIONS = [
  {
    heading: 'Joining a meeting',
    items: [
      {
        q: 'Do I need an account to join?',
        a: 'No. Open the meeting link, type a name, and join. An account is only needed to create meetings, and the host can require sign-in for a particular meeting.',
      },
      {
        q: 'Where do I find the meeting code?',
        a: 'It is the last part of the meeting link and looks like abcd-efgh-ijkl. You can paste the whole link into the join box instead — it will pull the code out.',
      },
      {
        q: 'It says the meeting is locked.',
        a: 'The host closed the meeting to new arrivals. Ask them to unlock it; people already inside are unaffected.',
      },
      {
        q: 'I am stuck on "waiting for the host".',
        a: 'The meeting has a waiting room. The host sees your request and can admit you. Nothing from the meeting is visible until they do.',
      },
    ],
  },
  {
    heading: 'Camera and microphone',
    items: [
      {
        q: 'My browser is not asking for permission.',
        a: 'Permission is only requested on the pre-join screen, not when the page loads. If you already refused, click the camera or lock icon in the address bar, allow access, and reload.',
      },
      {
        q: 'It says my camera is already in use.',
        a: 'Another application has the device open — a video call in another tab, or a desktop conferencing app. Close it and press Retry on the pre-join screen.',
      },
      {
        q: 'Can I join without a camera or microphone?',
        a: 'Yes. Turn either off on the pre-join screen and join anyway. You can switch them on later from the control bar.',
      },
      {
        q: 'I cannot choose my speaker.',
        a: 'Only Chromium-based browsers let a web page pick an output device. In Firefox and Safari, change the output in your operating system sound settings.',
      },
    ],
  },
  {
    heading: 'Screen sharing',
    items: [
      {
        q: 'The present button is greyed out.',
        a: 'Either your browser does not support screen capture — that includes all browsers on iPhone and iPad — or the host has limited presenting to hosts only.',
      },
      {
        q: 'Can I share just one window or tab?',
        a: 'Yes. When you press Present, the browser offers your whole screen, an application window, or a single tab. Which options appear depends on the browser.',
      },
      {
        q: 'Can people hear my computer audio?',
        a: 'When sharing a browser tab in Chrome or Edge you can tick "share tab audio". Whole-screen audio sharing depends on the operating system.',
      },
    ],
  },
  {
    heading: 'Connection problems',
    items: [
      {
        q: 'It says "reconnecting".',
        a: 'Your network dropped briefly. Orbit keeps your place for a short grace period and puts you back into the same meeting — you will not appear twice, and your camera and microphone settings are restored.',
      },
      {
        q: 'Video is blurry or freezing.',
        a: 'Quality is reduced automatically to protect audio when bandwidth is tight. Open More → Connection information to see packet loss and latency. Turning your camera off usually restores clear audio immediately.',
      },
      {
        q: 'Nothing connects at all.',
        a: 'Some corporate networks block the UDP traffic WebRTC uses. A TURN relay solves this; if you are self-hosting, enable Coturn as described in the deployment guide.',
      },
      {
        q: 'What happens if the host disconnects?',
        a: 'The meeting continues. If the host does not return within about ninety seconds, host controls pass to a co-host, or to the longest-present participant.',
      },
    ],
  },
  {
    heading: 'Privacy and security',
    items: [
      {
        q: 'Is the meeting encrypted?',
        a: 'Yes. All media is encrypted in transit with DTLS-SRTP, which is mandatory in WebRTC, and signalling runs over TLS in any HTTPS deployment.',
      },
      {
        q: 'Can I be recorded without knowing?',
        a: 'No. Recording must be enabled for the meeting and started deliberately by a host, and every participant is shown a recording indicator for as long as it runs.',
      },
      {
        q: 'Can meeting codes be guessed?',
        a: 'Codes carry about 61 bits of entropy and are generated with a cryptographic random source — never from a counter or a timestamp. Lookups are also rate limited.',
      },
    ],
  },
];

export default function HelpPage() {
  return (
    <div className="flex min-h-dvh flex-col">
      <SiteHeader />

      <main id="main" className="flex-1">
        <div className="mx-auto max-w-3xl px-4 py-16 sm:px-6">
          <h1 className="text-4xl font-semibold tracking-tight">Help</h1>
          <p className="mt-3 text-lg text-ink-600 dark:text-ink-300">
            Answers to the things that actually go wrong in video calls.
          </p>

          <div className="mt-12 space-y-12">
            {SECTIONS.map((section) => (
              <section key={section.heading}>
                <h2 className="text-xl font-semibold tracking-tight">{section.heading}</h2>
                <dl className="mt-5 space-y-5">
                  {section.items.map((item) => (
                    <div
                      key={item.q}
                      className="rounded-xl border border-ink-200/80 bg-white p-5 dark:border-white/10 dark:bg-ink-850"
                    >
                      <dt className="font-medium">{item.q}</dt>
                      <dd className="mt-1.5 text-sm leading-relaxed text-ink-600 dark:text-ink-400">
                        {item.a}
                      </dd>
                    </div>
                  ))}
                </dl>
              </section>
            ))}
          </div>
        </div>
      </main>

      <SiteFooter />
    </div>
  );
}
