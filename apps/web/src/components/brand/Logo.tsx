import clsx from 'clsx';

/**
 * The Orbit mark.
 *
 * An original design: a solid core with an elliptical orbit ring and a
 * satellite dot — participants circling a shared centre. Drawn as inline SVG so
 * it stays crisp, inherits colour, and adds no network request.
 */
export function LogoMark({ className, title = 'Orbit' }: { className?: string; title?: string }) {
  return (
    <svg
      viewBox="0 0 32 32"
      role="img"
      aria-label={title}
      className={clsx('h-8 w-8', className)}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        <linearGradient id="orbit-core" x1="6" y1="6" x2="26" y2="26" gradientUnits="userSpaceOnUse">
          <stop stopColor="#818cf8" />
          <stop offset="1" stopColor="#a855f7" />
        </linearGradient>
      </defs>
      <ellipse
        cx="16"
        cy="16"
        rx="14"
        ry="7"
        transform="rotate(-32 16 16)"
        stroke="currentColor"
        strokeOpacity="0.55"
        strokeWidth="1.75"
      />
      <circle cx="16" cy="16" r="6" fill="url(#orbit-core)" />
      <circle cx="26.2" cy="9.4" r="2.6" fill="currentColor" />
    </svg>
  );
}

export function Logo({
  className,
  wordmarkClassName,
  showWordmark = true,
}: {
  className?: string;
  wordmarkClassName?: string;
  showWordmark?: boolean;
}) {
  return (
    <span className={clsx('inline-flex items-center gap-2', className)}>
      <LogoMark className="h-8 w-8 text-brand-500" />
      {showWordmark && (
        <span className={clsx('text-lg font-semibold tracking-tight', wordmarkClassName)}>Orbit</span>
      )}
    </span>
  );
}
