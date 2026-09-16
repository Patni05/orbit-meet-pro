'use client';

/**
 * Browser capability detection.
 *
 * Every feature that is not universally available is checked here once, so the
 * UI can disable a control and explain why rather than letting a click throw.
 * All checks are lazy and safe to call during render on the client.
 */

export interface Capabilities {
  /** getUserMedia exists. Without it there is no meeting at all. */
  userMedia: boolean;
  /** getDisplayMedia — absent on most mobile browsers. */
  screenShare: boolean;
  /** WebRTC peer connections. */
  webrtc: boolean;
  /** setSinkId — output device selection. Chromium only, today. */
  speakerSelection: boolean;
  /** Fullscreen API on elements. */
  fullscreen: boolean;
  /** Picture-in-Picture for video elements. */
  pictureInPicture: boolean;
  /** enumerateDevices for device pickers. */
  deviceEnumeration: boolean;
  /** Clipboard write, for "copy invitation". */
  clipboard: boolean;
  /** navigator.share — the OS share sheet, which is how an invite travels on a phone. */
  webShare: boolean;
  /** Insertable streams / canvas pipeline needed by background blur. */
  backgroundBlur: boolean;
  secureContext: boolean;
  isMobile: boolean;
  isIOS: boolean;
  isSafari: boolean;
  isFirefox: boolean;
}

function detect(): Capabilities {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') {
    return {
      userMedia: false,
      screenShare: false,
      webrtc: false,
      speakerSelection: false,
      fullscreen: false,
      pictureInPicture: false,
      deviceEnumeration: false,
      clipboard: false,
      webShare: false,
      backgroundBlur: false,
      secureContext: false,
      isMobile: false,
      isIOS: false,
      isSafari: false,
      isFirefox: false,
    };
  }

  const ua = navigator.userAgent;
  const isIOS =
    /iPad|iPhone|iPod/.test(ua) ||
    // iPadOS reports itself as a Mac; the touch points give it away.
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const isSafari = /^((?!chrome|android|crios|fxios).)*safari/i.test(ua);
  const isFirefox = /firefox|fxios/i.test(ua);
  const isMobile = isIOS || /Android|Mobile|Tablet/i.test(ua);

  const media = navigator.mediaDevices as MediaDevices | undefined;

  return {
    userMedia: Boolean(media?.getUserMedia),
    // iOS Safari exposes getDisplayMedia on the object but always rejects it.
    screenShare: Boolean(media && 'getDisplayMedia' in media) && !isIOS,
    webrtc: typeof RTCPeerConnection !== 'undefined',
    speakerSelection: typeof HTMLMediaElement !== 'undefined' && 'setSinkId' in HTMLMediaElement.prototype,
    fullscreen:
      typeof document !== 'undefined' &&
      (document.fullscreenEnabled ||
        Boolean((document as Document & { webkitFullscreenEnabled?: boolean }).webkitFullscreenEnabled)),
    pictureInPicture:
      typeof document !== 'undefined' && (document.pictureInPictureEnabled ?? false) && !isFirefox,
    deviceEnumeration: Boolean(media?.enumerateDevices),
    clipboard: Boolean(navigator.clipboard?.writeText),
    webShare: typeof navigator.share === 'function',
    // The blur pipeline needs a worker-friendly canvas path; Safari's support
    // is too inconsistent to offer it there.
    backgroundBlur: typeof window.OffscreenCanvas !== 'undefined' && !isSafari && !isMobile,
    // getUserMedia only works on HTTPS or localhost. This is the single most
    // common reason a meeting fails on a LAN address.
    secureContext: window.isSecureContext,
    isMobile,
    isIOS,
    isSafari,
    isFirefox,
  };
}

let cached: Capabilities | null = null;

export function capabilities(): Capabilities {
  if (!cached) cached = detect();
  return cached;
}

/** Human-readable reason a control is unavailable, or null when it works. */
export function unavailableReason(feature: keyof Capabilities): string | null {
  const caps = capabilities();
  if (caps[feature]) return null;

  switch (feature) {
    case 'screenShare':
      return caps.isIOS
        ? 'Screen sharing is not available in browsers on iPhone or iPad.'
        : 'This browser does not support screen sharing.';
    case 'speakerSelection':
      return 'This browser does not let web pages choose the speaker. Change the output device in your system settings.';
    case 'pictureInPicture':
      return 'Picture-in-picture is not supported in this browser.';
    case 'fullscreen':
      return 'Fullscreen is not available in this browser.';
    case 'backgroundBlur':
      return 'Background blur is not supported on this device.';
    case 'webShare':
      return 'This browser has no share sheet. Copy the link instead.';
    case 'secureContext':
      return 'Camera and microphone need a secure connection (HTTPS), or localhost.';
    case 'userMedia':
    case 'webrtc':
      return 'This browser is too old for video meetings. Try the latest Chrome, Edge, Firefox or Safari.';
    default:
      return 'This feature is not available in your browser.';
  }
}

/** Blocks the meeting entirely when true. */
export function browserUnsupported(): string | null {
  const caps = capabilities();
  if (!caps.webrtc || !caps.userMedia) {
    return 'This browser cannot run video meetings. Please use a recent version of Chrome, Edge, Firefox or Safari.';
  }
  if (!caps.secureContext) {
    return 'Your browser is blocking camera and microphone access because this page is not served over HTTPS. Open the app on localhost, or set up HTTPS.';
  }
  return null;
}
