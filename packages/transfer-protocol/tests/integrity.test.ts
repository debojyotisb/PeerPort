import { describe, it, expect } from 'vitest';
import { computeSha256, bufferToHex, isValidSha256 } from '../src/integrity.js';

describe('Cryptographic Integrity Verification', () => {
  it('computes accurate SHA-256 for a known string buffer', async () => {
    // SHA-256 of "PeerPort" is 73c36908b1727dde11da268d832c80b9cbcf0717f78aaf68382532aa10177e18
    const data = new TextEncoder().encode('PeerPort');
    const hash = await computeSha256(data);

    expect(isValidSha256(hash)).toBe(true);
    expect(hash.length).toBe(64);
    expect(hash).toBe('73c36908b1727dde11da268d832c80b9cbcf0717f78aaf68382532aa10177e18');
  });

  it('validates 64-character lowercase hex strings', () => {
    expect(isValidSha256('765c9c1b181e18bf9ba8e718870aa006c6e73dbd61b369ec23fb1531e075c3db')).toBe(true);
    expect(isValidSha256('invalid_hash')).toBe(false);
    expect(isValidSha256('12345')).toBe(false);
  });
});
