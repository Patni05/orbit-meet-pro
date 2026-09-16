/**
 * Network-origin helpers.
 *
 * Kept in one place with tests because the pattern below is easy to get subtly
 * wrong — a dropped backslash turns `\d` into a literal "d" and the expression
 * silently matches nothing, which shows up much later as an unexplained CORS
 * rejection rather than as an obvious error.
 */

/** Loopback and RFC1918 hosts, as `URL.hostname` reports them. */
const PRIVATE_HOST =
  /^(localhost|127\.\d{1,3}\.\d{1,3}\.\d{1,3}|10\.\d{1,3}\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}|\[::1\])$/;

/** True for a hostname that can only be reached from the local network. */
export function isPrivateHost(hostname: string): boolean {
  return PRIVATE_HOST.test(hostname);
}

/**
 * True when an origin points somewhere on the local network.
 *
 * Callers use this to relax cross-origin rules during development so the app
 * can be opened from a phone on the same Wi-Fi. It is always combined with an
 * environment check — production never consults it.
 */
export function isPrivateOrigin(origin: string): boolean {
  try {
    return isPrivateHost(new URL(origin).hostname);
  } catch {
    return false;
  }
}
