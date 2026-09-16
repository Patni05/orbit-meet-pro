'use client';

import { avatarColorFor, findAvatarPreset, initialsFrom } from '@orbit/shared';
import clsx from 'clsx';
import { useState } from 'react';

/**
 * Participant avatar.
 *
 * Renders, in order of preference: a chosen built-in preset, an uploaded
 * photo, then initials with a colour derived from the person's identity — so
 * somebody who picks nothing still looks the same on every device without
 * anything being stored for them.
 */
export function Avatar({
  name,
  src,
  seed,
  size = 'md',
  className,
}: {
  name: string;
  src?: string | null;
  /** Stable key for colour selection; defaults to the name. */
  seed?: string;
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl' | '2xl';
  className?: string;
}) {
  const [broken, setBroken] = useState(false);

  const sizes = {
    xs: 'h-6 w-6 text-[10px]',
    sm: 'h-8 w-8 text-xs',
    md: 'h-10 w-10 text-sm',
    lg: 'h-14 w-14 text-lg',
    xl: 'h-20 w-20 text-2xl',
    '2xl': 'h-28 w-28 text-4xl',
  } as const;

  // The glyph sits a little smaller than the circle so it never touches the edge.
  const glyphSizes = {
    xs: 'text-[11px]',
    sm: 'text-sm',
    md: 'text-lg',
    lg: 'text-2xl',
    xl: 'text-4xl',
    '2xl': 'text-5xl',
  } as const;

  const initials = initialsFrom(name);
  const background = avatarColorFor(seed ?? name);

  // A preset is data, not a URL, so it cannot fail to load or leak a request.
  const preset = findAvatarPreset(src);
  if (preset) {
    return (
      <span
        aria-hidden="true"
        style={{ backgroundColor: preset.background }}
        className={clsx(
          'inline-flex shrink-0 select-none items-center justify-center rounded-full leading-none',
          sizes[size],
          className,
        )}
      >
        <span className={glyphSizes[size]}>{preset.glyph}</span>
      </span>
    );
  }

  if (src && !broken) {
    return (
      <img
        src={src}
        alt=""
        onError={() => setBroken(true)}
        className={clsx('shrink-0 rounded-full object-cover', sizes[size], className)}
      />
    );
  }

  return (
    <span
      aria-hidden="true"
      style={{ backgroundColor: background }}
      className={clsx(
        'inline-flex shrink-0 select-none items-center justify-center rounded-full font-semibold text-white',
        sizes[size],
        className,
      )}
    >
      {initials}
    </span>
  );
}
