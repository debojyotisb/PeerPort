/**
 * Computes a SHA-256 digest over an ArrayBuffer or Uint8Array using the Web Crypto API.
 * Works seamlessly in all modern browsers and Node.js 18+.
 */
export async function computeSha256(data: ArrayBuffer | Uint8Array): Promise<string> {
  const cryptoObj = typeof globalThis.crypto !== 'undefined' ? globalThis.crypto : undefined;
  
  if (!cryptoObj || !cryptoObj.subtle) {
    throw new Error('Web Crypto API (crypto.subtle) is not available in this environment');
  }

  const buffer = data instanceof Uint8Array ? data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) : data;
  const hashBuffer = await cryptoObj.subtle.digest('SHA-256', buffer as ArrayBuffer);
  
  return bufferToHex(hashBuffer);
}

/**
 * Converts an ArrayBuffer to a lowercase hexadecimal string.
 */
export function bufferToHex(buffer: ArrayBuffer): string {
  const byteArray = new Uint8Array(buffer);
  let hexString = '';
  for (let i = 0; i < byteArray.length; i++) {
    const hex = byteArray[i].toString(16).padStart(2, '0');
    hexString += hex;
  }
  return hexString;
}

/**
 * Validates whether a given string is a valid 64-character lowercase hexadecimal SHA-256 hash.
 */
export function isValidSha256(hash: string): boolean {
  return /^[a-f0-9]{64}$/i.test(hash);
}
