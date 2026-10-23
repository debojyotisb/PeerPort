const WINDOWS_RESERVED_NAMES = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(\..*)?$/i;

/**
 * Strips path traversal characters, null bytes, control codes, and Windows reserved device names.
 */
export function sanitizeFileName(name: string): string {
  if (!name || typeof name !== 'string') {
    return 'unnamed_file';
  }

  // Strip path prefixes (both / and \)
  let sanitized = name.replace(/^.*[\\\/]/, '');

  // Strip non-printable / control characters
  sanitized = sanitized.replace(/[\x00-\x1f\x80-\x9f]/g, '');

  // Strip characters forbidden in Windows, Unix, and Mac filesystems: < > : " / \ | ? *
  sanitized = sanitized.replace(/[<>:"/\\|?*]/g, '_');

  // Strip leading and trailing periods/spaces which cause issues on Windows
  sanitized = sanitized.replace(/^[\s.]+|[\s.]+$/g, '');

  // Check for Windows reserved device names
  if (WINDOWS_RESERVED_NAMES.test(sanitized)) {
    sanitized = `safe_${sanitized}`;
  }

  // Enforce reasonable length limit (255 chars is standard across modern filesystems)
  if (sanitized.length > 255) {
    const extIndex = sanitized.lastIndexOf('.');
    if (extIndex > 0 && sanitized.length - extIndex < 10) {
      const ext = sanitized.substring(extIndex);
      sanitized = sanitized.substring(0, 255 - ext.length) + ext;
    } else {
      sanitized = sanitized.substring(0, 255);
    }
  }

  return sanitized || 'unnamed_file';
}

/**
 * Validates file sizes against safe maximum thresholds.
 * @param size File size in bytes
 * @param maxBytes Maximum allowed size in bytes (default 10 GB)
 */
export function isValidFileSize(size: number, maxBytes: number = 10 * 1024 * 1024 * 1024): boolean {
  return Number.isFinite(size) && size >= 0 && size <= maxBytes;
}
