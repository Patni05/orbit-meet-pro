import {
  AccessToken,
  EgressClient,
  EncodedFileOutput,
  EncodedFileType,
  RoomServiceClient,
  TrackSource,
  type EgressInfo,
  type ParticipantInfo,
} from 'livekit-server-sdk';
import type { MeetingSettings, ParticipantRole } from '@orbit/shared';
import { env } from '../config/env';
import { logger } from './logger';
import { serviceUnavailable, withTimeout } from './errors';
import { ERROR_CODES } from '@orbit/shared';

/**
 * LiveKit SFU integration.
 *
 * The API key and secret exist only in this process. The browser never sees
 * them — it receives a short-lived participant token whose grants are derived
 * from the caller's verified role and the meeting's policy.
 */

const roomService = new RoomServiceClient(env.LIVEKIT_URL, env.LIVEKIT_API_KEY, env.LIVEKIT_API_SECRET);
const egressClient = new EgressClient(env.LIVEKIT_URL, env.LIVEKIT_API_KEY, env.LIVEKIT_API_SECRET);

/** Room name in the SFU. The meeting code is unique and already high-entropy. */
export function roomNameFor(meetingCode: string): string {
  return `orbit-${meetingCode}`;
}

export interface ParticipantMetadata {
  role: ParticipantRole;
  participantId: string;
  userId: string | null;
  avatarUrl: string | null;
  isGuest: boolean;
}

export function canShareScreen(role: ParticipantRole, settings: Pick<MeetingSettings, 'screenShareMode'>): boolean {
  if (settings.screenShareMode === 'EVERYONE') return true;
  return role === 'HOST' || role === 'COHOST';
}

/**
 * Mints the participant token.
 *
 * Screen-share permission is encoded in `canPublishSources`, so a participant
 * who is not allowed to present is refused by the SFU itself — hiding the
 * button in the UI is presentation, this is the actual enforcement.
 */
export async function createParticipantToken(params: {
  meetingCode: string;
  identity: string;
  displayName: string;
  role: ParticipantRole;
  settings: MeetingSettings;
  metadata: ParticipantMetadata;
}): Promise<string> {
  const allowScreenShare = canShareScreen(params.role, params.settings);

  const sources = [TrackSource.CAMERA, TrackSource.MICROPHONE];
  if (allowScreenShare) {
    sources.push(TrackSource.SCREEN_SHARE, TrackSource.SCREEN_SHARE_AUDIO);
  }

  const token = new AccessToken(env.LIVEKIT_API_KEY, env.LIVEKIT_API_SECRET, {
    identity: params.identity,
    name: params.displayName,
    ttl: env.LIVEKIT_TOKEN_TTL_SECONDS,
    metadata: JSON.stringify(params.metadata),
  });

  token.addGrant({
    room: roomNameFor(params.meetingCode),
    roomJoin: true,
    canPublish: true,
    canSubscribe: true,
    canPublishData: true,
    canPublishSources: sources,
    canUpdateOwnMetadata: false,
    /**
     * Deliberately false for every participant, including hosts: moderation
     * goes through the API so it can be authorized and audited. Hosts never
     * hold SFU admin rights in the browser.
     */
    roomAdmin: false,
    roomCreate: false,
  });

  return token.toJwt();
}

export async function updateParticipantMetadata(
  meetingCode: string,
  identity: string,
  metadata: ParticipantMetadata,
  settings: MeetingSettings,
): Promise<void> {
  const allowScreenShare = canShareScreen(metadata.role, settings);
  const sources = [TrackSource.CAMERA, TrackSource.MICROPHONE];
  if (allowScreenShare) sources.push(TrackSource.SCREEN_SHARE, TrackSource.SCREEN_SHARE_AUDIO);

  try {
    await roomService.updateParticipant(roomNameFor(meetingCode), identity, {
      metadata: JSON.stringify(metadata),
      permission: {
        canPublish: true,
        canSubscribe: true,
        canPublishData: true,
        canPublishSources: sources,
        hidden: false,
        recorder: false,
        canUpdateMetadata: false,
        agent: false,
        canSubscribeMetrics: false,
      },
    });
  } catch (error) {
    // The participant may simply not be connected yet; the token already
    // carries the right grants, so this is a best-effort live update.
    logger.debug({ err: error, identity }, 'updateParticipant failed (participant likely offline)');
  }
}

export async function listRoomParticipants(meetingCode: string): Promise<ParticipantInfo[]> {
  try {
    return await roomService.listParticipants(roomNameFor(meetingCode));
  } catch {
    return [];
  }
}

/** Server-side mute. Mutes every published track of the requested kind. */
export async function muteParticipantTracks(
  meetingCode: string,
  identity: string,
  kind: 'audio' | 'video',
): Promise<number> {
  const room = roomNameFor(meetingCode);
  let muted = 0;
  try {
    const participants = await roomService.listParticipants(room);
    const target = participants.find((p) => p.identity === identity);
    if (!target) return 0;

    for (const track of target.tracks) {
      const isAudio = track.type === 0; // TrackType.AUDIO
      const wantAudio = kind === 'audio';
      // Never silently kill a screen share when asked to mute the camera.
      const isScreen = track.source === TrackSource.SCREEN_SHARE || track.source === TrackSource.SCREEN_SHARE_AUDIO;
      if (isScreen) continue;
      if (isAudio === wantAudio && !track.muted) {
        await roomService.mutePublishedTrack(room, identity, track.sid, true);
        muted += 1;
      }
    }
  } catch (error) {
    logger.warn({ err: error, identity, kind }, 'mute via SFU failed');
  }
  return muted;
}

/** Stops a participant's screen share by muting its published track. */
export async function stopParticipantScreenShare(meetingCode: string, identity: string): Promise<boolean> {
  const room = roomNameFor(meetingCode);
  try {
    const participants = await roomService.listParticipants(room);
    const target = participants.find((p) => p.identity === identity);
    if (!target) return false;
    let stopped = false;
    for (const track of target.tracks) {
      if (track.source === TrackSource.SCREEN_SHARE || track.source === TrackSource.SCREEN_SHARE_AUDIO) {
        await roomService.mutePublishedTrack(room, identity, track.sid, true);
        stopped = true;
      }
    }
    return stopped;
  } catch (error) {
    logger.warn({ err: error, identity }, 'stop screen share via SFU failed');
    return false;
  }
}

export async function removeParticipant(meetingCode: string, identity: string): Promise<void> {
  try {
    await roomService.removeParticipant(roomNameFor(meetingCode), identity);
  } catch (error) {
    logger.debug({ err: error, identity }, 'removeParticipant failed (already gone)');
  }
}

/** Disconnects everyone. Used when the host ends the meeting for all. */
export async function deleteRoom(meetingCode: string): Promise<void> {
  try {
    await roomService.deleteRoom(roomNameFor(meetingCode));
  } catch (error) {
    logger.debug({ err: error, meetingCode }, 'deleteRoom failed (room likely empty)');
  }
}

export async function checkLivekit(): Promise<'ok' | 'error'> {
  try {
    // Bounded: an unreachable SFU must not hold the health endpoint open for
    // the full HTTP timeout, or orchestrators will kill a healthy API.
    await withTimeout(roomService.listRooms(), 2000, 'livekit listRooms');
    return 'ok';
  } catch (error) {
    logger.debug({ err: error }, 'livekit health check failed');
    return 'error';
  }
}

export async function countActiveRooms(): Promise<number> {
  try {
    const rooms = await roomService.listRooms();
    return rooms.length;
  } catch {
    return 0;
  }
}

/**
 * Recording via LiveKit Egress.
 *
 * Requires the egress service to be running (see infrastructure/livekit).
 * When it is not available the API reports it honestly instead of pretending
 * a recording started.
 */
export async function startRoomRecording(params: {
  meetingCode: string;
  meetingId: string;
}): Promise<{ egressId: string; fileLocation: string }> {
  if (!env.RECORDING_ENABLED) {
    throw serviceUnavailable(
      ERROR_CODES.RECORDING_UNAVAILABLE,
      'Recording is not enabled on this server.',
    );
  }

  const filepath = `${env.RECORDING_OUTPUT_DIR}/${params.meetingCode}-{time}.mp4`;
  const output = new EncodedFileOutput({ fileType: EncodedFileType.MP4, filepath });

  try {
    const info: EgressInfo = await egressClient.startRoomCompositeEgress(roomNameFor(params.meetingCode), output, {
      layout: 'grid',
    });
    return { egressId: info.egressId, fileLocation: filepath };
  } catch (error) {
    logger.error({ err: error, meetingId: params.meetingId }, 'failed to start egress');
    throw serviceUnavailable(
      ERROR_CODES.RECORDING_UNAVAILABLE,
      'The recording service is unavailable right now.',
    );
  }
}

export async function stopRoomRecording(egressId: string): Promise<EgressInfo | null> {
  try {
    return await egressClient.stopEgress(egressId);
  } catch (error) {
    logger.error({ err: error, egressId }, 'failed to stop egress');
    return null;
  }
}

export { roomService, egressClient };
