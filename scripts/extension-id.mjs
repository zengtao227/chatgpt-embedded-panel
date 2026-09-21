import { createHash } from 'node:crypto';

// Chrome derives an extension's id from the manifest `key`: the first 128 bits of SHA-256 over the
// DER public key, written with the letters a-p. Pinning the key gives every machine the same id, so
// the Native Messaging host can be bound to it before the extension is ever loaded.
export function extensionIdFromManifestKey(base64Key) {
  const digest = createHash('sha256').update(Buffer.from(base64Key, 'base64')).digest('hex').slice(0, 32);
  return [...digest].map((char) => String.fromCharCode(97 + Number.parseInt(char, 16))).join('');
}

export const PANEL_EXTENSION_ID = 'podhehbmgkecchcfmffhfjaakedjgcbe';
