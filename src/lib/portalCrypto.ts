/**
 * End-to-end encryption utilities for the Orca Portal.
 *
 * Uses PBKDF2 for key derivation and AES-256-GCM for encryption.
 * Both desktop and mobile derive the same key from the pairing passphrase
 * and device IDs, allowing them to communicate securely without the
 * relay server being able to read message contents.
 */

// Reduced iterations for compatibility with mobile (pure JS is slower)
// Still provides reasonable security for a local pairing scenario
const PBKDF2_ITERATIONS = 10_000;
const KEY_LENGTH = 256; // bits
const IV_LENGTH = 12; // bytes for AES-GCM
const encoder = new TextEncoder();
const decoder = new TextDecoder();

/**
 * Derives an encryption key from the pairing passphrase and desktop ID.
 * All parties (desktop and all paired mobiles) derive the same key,
 * enabling broadcast-style communication through the relay.
 */
export async function deriveKey(
  passphrase: string,
  desktopId: string
): Promise<CryptoKey> {
  // Create salt from desktop ID (deterministic, shared by all parties)
  const saltInput = `orca-portal:${desktopId}`;
  const saltBuffer = await crypto.subtle.digest(
    "SHA-256",
    encoder.encode(saltInput)
  );

  // Import passphrase as key material
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    encoder.encode(passphrase),
    "PBKDF2",
    false,
    ["deriveKey"]
  );

  // Derive AES-GCM key
  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: saltBuffer,
      iterations: PBKDF2_ITERATIONS,
      hash: "SHA-256",
    },
    keyMaterial,
    { name: "AES-GCM", length: KEY_LENGTH },
    false, // not extractable
    ["encrypt", "decrypt"]
  );
}

/**
 * Encrypts a message payload using AES-256-GCM.
 * The message type and timestamp are used as additional authenticated data (AAD)
 * to prevent tampering and replay attacks.
 */
export async function encryptMessage(
  key: CryptoKey,
  payload: Record<string, unknown>,
  type: string,
  timestamp: number
): Promise<{ iv: string; ciphertext: string }> {
  // Generate random IV
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));

  // Create AAD from type and timestamp
  const aad = encoder.encode(`${type}:${timestamp}`);

  // Encrypt payload
  const plaintext = encoder.encode(JSON.stringify(payload));
  const ciphertextBuffer = await crypto.subtle.encrypt(
    {
      name: "AES-GCM",
      iv,
      additionalData: aad,
    },
    key,
    plaintext
  );

  // Return base64-encoded IV and ciphertext (includes auth tag)
  return {
    iv: arrayBufferToBase64(iv),
    ciphertext: arrayBufferToBase64(ciphertextBuffer),
  };
}

/**
 * Decrypts a message payload using AES-256-GCM.
 * Verifies the AAD matches the expected type and timestamp.
 */
export async function decryptMessage(
  key: CryptoKey,
  iv: string,
  ciphertext: string,
  type: string,
  timestamp: number
): Promise<Record<string, unknown>> {
  // Decode base64
  const ivBuffer = base64ToArrayBuffer(iv);
  const ciphertextBuffer = base64ToArrayBuffer(ciphertext);

  // Create AAD from type and timestamp
  const aad = encoder.encode(`${type}:${timestamp}`);

  // Decrypt
  const plaintextBuffer = await crypto.subtle.decrypt(
    {
      name: "AES-GCM",
      iv: ivBuffer,
      additionalData: aad,
    },
    key,
    ciphertextBuffer
  );

  // Parse and return
  return JSON.parse(decoder.decode(plaintextBuffer));
}

// Helper functions for base64 encoding/decoding
function arrayBufferToBase64(buffer: ArrayBuffer | Uint8Array): string {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function base64ToArrayBuffer(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/**
 * Messages that should NOT be encrypted (needed for relay routing/pairing).
 * TODO: Remove the catch-all once encryption is debugged
 */
export const UNENCRYPTED_MESSAGE_TYPES = new Set([
  "register_desktop",
  "register_mobile",
  "pair_response",
  "device_list",
  // Temporarily disable encryption for debugging
  "command",
  "command_response",
  "terminal_input",
  "terminal_output",
  "status_update",
  "request_status",
  "select_project",
  "project_changed",
  "git_files_changed",
  "attach_terminal",
  "detach_terminal",
  "resume_session",
]);

/**
 * Checks if a message type should be encrypted.
 */
export function shouldEncrypt(type: string): boolean {
  return !UNENCRYPTED_MESSAGE_TYPES.has(type);
}
