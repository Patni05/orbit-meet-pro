'use client';

import { avatarColorFor, findAvatarPreset, initialsFrom } from '@orbit/shared';
import clsx from 'clsx';
import { useState } from 'react';

export type AvatarSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl' | '2xl' | '3xl';

/**
 * Participant avatar.
 *
 * Renders, in order of preference: a chosen built-in preset, an uploaded
 * photo, then initials with a colour derived from the person's identity — so
 * somebody who picks nothing still looks the same on every device without
 * anything being stored for them.
 *
 * Sizes are deliberately generous. An avatar is what a participant *is* on
 * screen whenever their camera is off, which on a phone is most of the time,
 * and the previous scale left a 40px circle standing in for a whole person.
 * Every step is also a round number of pixels at the default root size, so a
 * circle never lands on a half pixel and renders soft.
 *
 * The ring and inner highlight do the "clean" work: a hairline in the
 * surface's own colour separates the circle from whatever sits behind it —
 * video, a dark tile, a coloured panel — without implying a border, and the
 * subtle top highlight keeps a flat colour from looking like a hole.
 */
export function Avatar({
  name,
  src,
  seed,
  size = 'md',
  className,
  ring = true,
  fill = false,
}: {
  name: string;
  src?: string | null;
  /** Stable key for colour selection; defaults to the name. */
  seed?: string;
  size?: AvatarSize;
  className?: string;
  /** Hairline separator. Turn off where the avatar sits on its own. */
  ring?: boolean;
  /**
   * Fill the parent instead of taking a fixed size, sizing the initials and
   * glyph from the nearest `@container`.
   *
   * A video tile is as big as the participant count makes it, not as big as
   * the viewport, so a tile avatar picked from a fixed scale is either lost in
   * a two-person call or clipped in a twelve-person one. Filling lets one
   * component be right at every tile size.
   */
  fill?: boolean;
}) {
  const [broken, setBroken] = useState(false);

  const sizes = {
    xs: 'h-7 w-7 text-[11px]',
    sm: 'h-10 w-10 text-sm',
    md: 'h-14 w-14 text-base',
    lg: 'h-20 w-20 text-2xl',
    xl: 'h-28 w-28 text-4xl',
    '2xl': 'h-40 w-40 text-6xl',
    '3xl': 'h-56 w-56 text-7xl',
  } as const;

  // The glyph sits a little smaller than the circle so it never touches the edge.
  const glyphSizes = {
    xs: 'text-sm',
    sm: 'text-xl',
    md: 'text-3xl',
    lg: 'text-[2.75rem]',
    xl: 'text-6xl',
    '2xl': 'text-8xl',
    '3xl': 'text-9xl',
  } as const;

  const shell = clsx(
    'inline-flex shrink-0 select-none items-center justify-center rounded-full leading-none',
    ring && 'ring-1 ring-inset ring-white/15',
    fill ? 'h-full w-full text-[13cqw]' : sizes[size],
    className,
  );
  const glyphClass = fill ? 'text-[22cqw]' : glyphSizes[size];

  const initials = initialsFrom(name);
  const background = avatarColorFor(seed ?? name);

  // A preset is data, not a URL, so it cannot fail to load or leak a request.
  const preset = findAvatarPreset(src);
  if (preset) {
    return (
      <span aria-hidden="true" style={{ backgroundColor: preset.background }} className={shell}>
        <span className={clsx(glyphClass, 'drop-shadow-sm')}>{preset.glyph}</span>
      </span>
    );
  }

  if (src && !broken) {
    return (
      <img
        src={src}
        alt=""
        onError={() => setBroken(true)}
        className={clsx(
          'shrink-0 rounded-full object-cover',
          ring && 'ring-1 ring-inset ring-white/15',
          fill ? 'h-full w-full' : sizes[size],
          className,
        )}
      />
    );
  }

  return (
    <span
      aria-hidden="true"
      style={{
        // A flat fill reads as a hole at large sizes; the highlight gives the
        // circle just enough form to sit on top of the tile instead of in it.
        backgroundImage: `linear-gradient(160deg, rgb(255 255 255 / 0.18), rgb(255 255 255 / 0) 55%), linear-gradient(${background}, ${background})`,
      }}
      className={clsx(shell, 'font-semibold tracking-wide text-white')}
    >
      {initials}
    </span>
  );
}
