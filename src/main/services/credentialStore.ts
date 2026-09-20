import { safeStorage } from 'electron'

import type { Logger } from './logStore'

const ENCRYPTED_PREFIX = 'v1:'
const PLAINTEXT_PREFIX = 'v0:'

export interface CredentialStore {
  /** True when the OS actually provides a keyring (DPAPI / Keychain / libsecret). */
  isEncryptionAvailable(): boolean
  /** Returns an opaque, storable string. */
  encrypt(value: string): string
  /** Reverses {@link encrypt}; returns null when the payload cannot be read. */
  decrypt(stored: string | null): string | null
}

/**
 * Wraps Electron's safeStorage.
 *
 * When no keyring is available (common on bare Linux installs and in WSL) we
 * still have to store *something*, so the value is base64-encoded and tagged as
 * `v0:` — the settings UI reads {@link isEncryptionAvailable} and tells the user
 * plainly that the key is not encrypted. Silently pretending otherwise would be
 * worse than the fallback itself.
 */
export function createCredentialStore(log: Logger): CredentialStore {
  return {
    isEncryptionAvailable: () => {
      try {
        return safeStorage.isEncryptionAvailable()
      } catch {
        return false
      }
    },

    encrypt: (value: string) => {
      try {
        if (safeStorage.isEncryptionAvailable()) {
          return `${ENCRYPTED_PREFIX}${safeStorage.encryptString(value).toString('base64')}`
        }
      } catch (error) {
        log.warn('safeStorage encryption failed, storing the credential unencrypted', error)
      }

      return `${PLAINTEXT_PREFIX}${Buffer.from(value, 'utf8').toString('base64')}`
    },

    decrypt: (stored: string | null) => {
      if (!stored) {
        return null
      }

      if (stored.startsWith(PLAINTEXT_PREFIX)) {
        return Buffer.from(stored.slice(PLAINTEXT_PREFIX.length), 'base64').toString('utf8')
      }

      if (stored.startsWith(ENCRYPTED_PREFIX)) {
        try {
          return safeStorage.decryptString(Buffer.from(stored.slice(ENCRYPTED_PREFIX.length), 'base64'))
        } catch (error) {
          log.error('failed to decrypt a stored credential', error)
          return null
        }
      }

      // Payload written by an older build without the prefix marker.
      try {
        return safeStorage.decryptString(Buffer.from(stored, 'base64'))
      } catch {
        return Buffer.from(stored, 'base64').toString('utf8')
      }
    }
  }
}
