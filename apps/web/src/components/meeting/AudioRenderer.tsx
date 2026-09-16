'use client';

import { memo } from 'react';
import { useAudioElement } from '@/hooks/useTrackElement';
import { useRoomStore } from '@/lib/room-store';

/**
 * Remote audio.
 *
 * Audio elements live here, outside the video grid, so switching layout,
 * paging the grid or collapsing a tile never interrupts what you are hearing.
 * The local microphone is deliberately not rendered — playing your own audio
 * back is an echo.
 */
export const AudioRenderer = memo(function AudioRenderer({
  outputDeviceId,
}: {
  outputDeviceId?: string;
}) {
  const order = useRoomStore((state) => state.order);
  const selfIdentity = useRoomStore((state) => state.selfIdentity);

  return (
    <div aria-hidden="true" className="sr-only">
      {order
        .filter((identity) => identity !== selfIdentity)
        .map((identity) => (
          <ParticipantAudio key={identity} identity={identity} outputDeviceId={outputDeviceId} />
        ))}
    </div>
  );
});

const ParticipantAudio = memo(function ParticipantAudio({
  identity,
  outputDeviceId,
}: {
  identity: string;
  outputDeviceId?: string;
}) {
  const micTrack = useRoomStore((state) => state.tracks[identity]?.microphone);
  const screenAudioTrack = useRoomStore((state) => state.tracks[identity]?.screenAudio);

  const micRef = useAudioElement(micTrack, outputDeviceId);
  const screenRef = useAudioElement(screenAudioTrack, outputDeviceId);

  return (
    <>
      <audio ref={micRef} autoPlay playsInline />
      {screenAudioTrack && <audio ref={screenRef} autoPlay playsInline />}
    </>
  );
});
