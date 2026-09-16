'use client';

import { AVATAR_PRESETS, AVATAR_PRESET_PREFIX, type AvatarPreset } from '@orbit/shared';
import { Check } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Avatar } from '@/components/ui/Avatar';

/**
 * Built-in avatar chooser.
 *
 * Offered before joining, where someone is already deciding how they will
 * appear, rather than buried in a settings page they would visit once. Picking
 * nothing is a valid choice: the initials avatar is deterministic, so a person
 * who skips this still looks the same to everyone, every time.
 */
export function AvatarPicker({
  name,
  value,
  onChange,
}: {
  name: string;
  value: string | null;
  onChange: (value: string | null) => void;
}) {
  const categories = useMemo(() => {
    const grouped = new Map<AvatarPreset['category'], AvatarPreset[]>();
    for (const preset of AVATAR_PRESETS) {
      const list = grouped.get(preset.category) ?? [];
      list.push(preset);
      grouped.set(preset.category, list);
    }
    return [...grouped.entries()];
  }, []);

  const [category, setCategory] = useState<AvatarPreset['category']>(
    categories[0]?.[0] ?? 'People',
  );
  const shown = categories.find(([key]) => key === category)?.[1] ?? [];

  return (
    <div>
      <div className="flex items-center gap-3">
        <Avatar name={name || 'You'} src={value} size="lg" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-ink-100">Your avatar</p>
          <p className="text-xs text-ink-400">
            Shown when your camera is off, in chat, and on the participant list.
          </p>
        </div>
        {value && (
          <button
            type="button"
            onClick={() => onChange(null)}
            className="shrink-0 text-xs font-medium text-brand-400 hover:underline"
          >
            Use initials
          </button>
        )}
      </div>

      <div className="mt-3 flex flex-wrap gap-1" role="tablist" aria-label="Avatar categories">
        {categories.map(([key]) => (
          <button
            key={key}
            role="tab"
            aria-selected={category === key}
            onClick={() => setCategory(key)}
            className={`rounded-lg px-2.5 py-1 text-xs font-medium transition-colors ${
              category === key ? 'bg-white/15 text-white' : 'text-ink-400 hover:text-ink-100'
            }`}
          >
            {key}
          </button>
        ))}
      </div>

      <ul className="mt-2 grid grid-cols-6 gap-2" aria-label={`${category} avatars`}>
        {shown.map((preset) => {
          const id = `${AVATAR_PRESET_PREFIX}${preset.id}`;
          const selected = value === id;
          return (
            <li key={preset.id}>
              <button
                type="button"
                onClick={() => onChange(selected ? null : id)}
                aria-pressed={selected}
                aria-label={preset.label}
                title={preset.label}
                className={`relative flex h-11 w-11 items-center justify-center rounded-full text-xl transition-transform hover:scale-110 ${
                  selected ? 'ring-2 ring-brand-400 ring-offset-2 ring-offset-ink-900' : ''
                }`}
                style={{ backgroundColor: preset.background }}
              >
                <span aria-hidden="true">{preset.glyph}</span>
                {selected && (
                  <span className="absolute -bottom-0.5 -right-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-brand-500">
                    <Check className="h-2.5 w-2.5 text-white" />
                  </span>
                )}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
