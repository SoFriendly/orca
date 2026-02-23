# E2E Encryption Implementation Status

## What Was Done

### 1. Created Crypto Utilities
- **Desktop**: `src/lib/portalCrypto.ts` - Uses Web Crypto API (native)
- **Mobile**: `mobile/lib/portalCrypto.ts` - Uses @noble/ciphers and @noble/hashes (pure JS)

### 2. Encryption Scheme
- **Key Derivation**: PBKDF2 with SHA-256, 10,000 iterations (reduced from 100k for mobile performance)
- **Salt**: SHA-256 hash of `orca-portal:{desktopId}`
- **Encryption**: AES-256-GCM with 12-byte random IV
- **AAD**: `{messageType}:{timestamp}` for replay protection

### 3. Integration Points

**Desktop (`src/stores/portalStore.ts`)**:
- Added `encryptionKey: CryptoKey | null` to state
- Key derived on WebSocket connect using `pairingPassphrase` + `deviceId`
- Key re-derived when passphrase regenerated
- `sendMessage()` encrypts outgoing messages (if key exists and message type requires it)
- `handleMessage()` decrypts incoming encrypted messages

**Mobile (`mobile/lib/websocket.ts`)**:
- Added `encryptionKey: EncryptionKey | null` to OrcaWebSocket class
- `setEncryptionKey(passphrase, desktopId)` method to derive key
- `sendAsync()` encrypts outgoing messages
- `onmessage` handler decrypts incoming encrypted messages

**Mobile (`mobile/stores/connectionStore.ts`)**:
- Derives key after successful pairing (in `pair_response` handler)
- Saves passphrase to SecureStore for reconnection
- Loads saved passphrase on reconnect and derives key

### 4. Message Format
```typescript
// Encrypted message
{
  type: string;           // Plaintext (for routing)
  id: string;             // Plaintext (for request/response matching)
  sessionToken?: string;  // Plaintext (for relay routing)
  timestamp: number;
  encrypted: {
    iv: string;           // Base64, 12 bytes
    ciphertext: string;   // Base64, encrypted payload + auth tag
  }
}
```

### 5. Persistence Fixes
- Desktop now persists `pairingCode` and `pairingPassphrase` so mobile can reconnect after restart
- Mobile saves passphrase to SecureStore per portal

### 6. Relay Updates
- Added `EncryptedPayload` type to `workers/relay/src/types.ts`
- Relay passes through `encrypted` field without modification
- Fixed: Relay now clears `linkedMobiles` when passphrase changes (prevents stale devices)

---

## Current State: ENCRYPTION DISABLED

Encryption is temporarily disabled in both `portalCrypto.ts` files by adding all message types to `UNENCRYPTED_MESSAGE_TYPES`. This was done to verify basic communication works (it does).

---

## What's Left to Fix

### Primary Issue: Key/Encryption Mismatch
Desktop (Web Crypto) and Mobile (@noble) produce incompatible results. Possible causes:

1. **PBKDF2 Output Mismatch**
   - Web Crypto and @noble/hashes may produce different key bytes
   - Need to log and compare derived keys on both sides

2. **AES-GCM Format Differences**
   - Auth tag handling might differ
   - Web Crypto appends 16-byte tag; @noble should too, but verify

### Debug Steps
1. Add logging to export/print first 8 bytes of derived key on both sides
2. Use a test passphrase and desktopId to verify PBKDF2 produces identical output
3. If keys match, test encryption/decryption with known plaintext
4. If keys don't match, investigate PBKDF2 parameter differences

### Alternative Approaches
1. **Use same library on both sides**: Could use @noble on desktop too (but loses native performance)
2. **Use Web Crypto polyfill on mobile**: `react-native-quick-crypto` requires native build (no Expo Go)
3. **Simpler encryption**: Use a library that's known to be cross-platform compatible

---

## Files Modified

### Desktop
- `src/lib/portalCrypto.ts` - NEW (crypto utilities)
- `src/stores/portalStore.ts` - Modified (encryption integration)

### Mobile
- `mobile/lib/portalCrypto.ts` - NEW (crypto utilities using @noble)
- `mobile/lib/websocket.ts` - Modified (encryption integration)
- `mobile/stores/connectionStore.ts` - Modified (key derivation on pair/reconnect)

### Relay
- `workers/relay/src/types.ts` - Modified (added EncryptedPayload type)
- `workers/relay/src/session.ts` - Modified (clear devices on passphrase change)

### Dependencies Added (Mobile)
- `@noble/ciphers` - AES-GCM implementation
- `@noble/hashes` - PBKDF2 and SHA-256
- `expo-crypto` - Random bytes generation

---

## To Re-enable Encryption

1. Fix the key derivation / encryption compatibility
2. Remove the extra message types from `UNENCRYPTED_MESSAGE_TYPES` in both:
   - `src/lib/portalCrypto.ts`
   - `mobile/lib/portalCrypto.ts`
3. Keep only: `register_desktop`, `register_mobile`, `pair_response`, `device_list`
