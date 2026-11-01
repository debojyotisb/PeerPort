import { describe, it, expect, vi } from 'vitest';
import { computeSha256, computeSha256Fallback, bufferToHex, isValidSha256 } from '../src/integrity.js';

describe('Cryptographic Integrity Verification & Pure JS Fallback', () => {
  it('computes accurate SHA-256 for a known string buffer', async () => {
    // SHA-256 of "PeerPort" is 73c36908b1727dde11da268d832c80b9cbcf0717f78aaf68382532aa10177e18
    const data = new TextEncoder().encode('PeerPort');
    const hash = await computeSha256(data);

    expect(isValidSha256(hash)).toBe(true);
    expect(hash.length).toBe(64);
    expect(hash).toBe('73c36908b1727dde11da268d832c80b9cbcf0717f78aaf68382532aa10177e18');
  });

  it('verifies standard NIST SHA-256 test vectors', () => {
    // 1. Empty string
    const empty = new Uint8Array(0);
    expect(computeSha256Fallback(empty)).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'
    );

    // 2. "abc"
    const abc = new TextEncoder().encode('abc');
    expect(computeSha256Fallback(abc)).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'
    );

    // 3. Multi-block string
    const multi = new TextEncoder().encode(
      'abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq'
    );
    expect(computeSha256Fallback(multi)).toBe(
      '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1'
    );
  });

  it('produces identical output between Web Crypto and Pure JS fallback across multi-kilobyte payload', async () => {
    const payload = new Uint8Array(128 * 1024); // 128 KiB
    for (let i = 0; i < payload.length; i++) {
      payload[i] = (i * 31 + 17) % 256;
    }

    const webCryptoHash = await computeSha256(payload);
    const pureJsHash = computeSha256Fallback(payload);

    expect(pureJsHash).toBe(webCryptoHash);
  });

  it('falls back to pure JS seamlessly when crypto.subtle is unavailable or rejects', async () => {
    const testData = new TextEncoder().encode('InsecureOriginTest');
    const expected = computeSha256Fallback(testData);

    // Mock subtle.digest rejecting as it does in insecure origins or unsupported browsers
    const digestSpy = vi.spyOn(globalThis.crypto.subtle, 'digest').mockRejectedValueOnce(
      new Error('DOMException: The operation is not supported in an insecure context')
    );

    const fallbackResult = await computeSha256(testData);
    expect(fallbackResult).toBe(expected);
    expect(digestSpy).toHaveBeenCalled();

    digestSpy.mockRestore();
  });

  it('validates 64-character lowercase hex strings', () => {
    expect(isValidSha256('765c9c1b181e18bf9ba8e718870aa006c6e73dbd61b369ec23fb1531e075c3db')).toBe(true);
    expect(isValidSha256('invalid_hash')).toBe(false);
    expect(isValidSha256('12345')).toBe(false);
  });
});
