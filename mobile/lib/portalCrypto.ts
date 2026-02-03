/**
 * End-to-end encryption utilities for the Chell Portal (Mobile).
 *
 * Uses PBKDF2 for key derivation and AES-256-GCM for encryption.
 * Both desktop and mobile derive the same key from the pairing passphrase
 * and device IDs, allowing them to communicate securely without the
 * relay server being able to read message contents.
 *
 * Uses @noble/ciphers and @noble/hashes for pure JS crypto (works in Expo Go).
 */

import { gcm } from "@noble/ciphers/aes.js";
import { pbkdf2 } from "@noble/hashes/pbkdf2.js";
import { sha256 } from "@noble/hashes/sha2.js";
import * as ExpoCrypto from "expo-crypto";

// Reduced iterations for mobile performance (pure JS is slower than native)
// Still provides reasonable security for a local pairing scenario
const PBKDF2_ITERATIONS = 10_000;
const KEY_LENGTH = 32; // 256 bits = 32 bytes
const IV_LENGTH = 12; // bytes for AES-GCM

const encoder = new TextEncoder();
const decoder = new TextDecoder();

// Simple key wrapper type
export interface EncryptionKey {
  keyBytes: Uint8Array;
}

/**
 * Derives an encryption key from the pairing passphrase and desktop ID.
 * All parties (desktop and all paired mobiles) derive the same key,
 * enabling broadcast-style communication through the relay.
 */
export async function deriveKey(
  passphrase: string,
  desktopId: string
): Promise<EncryptionKey> {
  // Create salt from desktop ID (deterministic, shared by all parties)
  const saltInput = `chell-portal:${desktopId}`;
  const salt = sha256(encoder.encode(saltInput));

  // Derive key using PBKDF2
  const keyBytes = pbkdf2(sha256, encoder.encode(passphrase), salt, {
    c: PBKDF2_ITERATIONS,
    dkLen: KEY_LENGTH,
  });

  return { keyBytes };
}

/**
 * Encrypts a message payload using AES-256-GCM.
 * The message type and timestamp are used as additional authenticated data (AAD)
 * to prevent tampering and replay attacks.
 */
export async function encryptMessage(
  key: EncryptionKey,
  payload: Record<string, unknown>,
  type: string,
  timestamp: number
): Promise<{ iv: string; ciphertext: string }> {
  // Generate random IV using expo-crypto
  const iv = new Uint8Array(ExpoCrypto.getRandomBytes(IV_LENGTH));

  // Create AAD from type and timestamp
  const aad = encoder.encode(`${type}:${timestamp}`);

  // Encrypt payload
  const plaintext = encoder.encode(JSON.stringify(payload));
  const aes = gcm(key.keyBytes, iv, aad);
  const ciphertext = aes.encrypt(plaintext);

  // Return base64-encoded IV and ciphertext (includes auth tag)
  return {
    iv: arrayBufferToBase64(iv),
    ciphertext: arrayBufferToBase64(ciphertext),
  };
}

/**
 * Decrypts a message payload using AES-256-GCM.
 * Verifies the AAD matches the expected type and timestamp.
 */
export async function decryptMessage(
  key: EncryptionKey,
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
  const aes = gcm(key.keyBytes, ivBuffer, aad);
  const plaintext = aes.decrypt(ciphertextBuffer);

  // Parse and return
  return JSON.parse(decoder.decode(plaintext));
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
