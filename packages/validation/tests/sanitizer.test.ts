import { describe, it, expect } from 'vitest';
import { sanitizeFileName, isValidFileSize } from '../src/sanitizer.js';

describe('Sanitizer Security Controls', () => {
  it('strips directory traversal prefixes (../ and ..\\)', () => {
    expect(sanitizeFileName('../../etc/shadow')).toBe('shadow');
    expect(sanitizeFileName('..\\..\\Windows\\System32\\cmd.exe')).toBe('cmd.exe');
    expect(sanitizeFileName('/root/secret.pdf')).toBe('secret.pdf');
  });

  it('strips forbidden characters and control codes', () => {
    expect(sanitizeFileName('photo<1>:test?.jpg')).toBe('photo_1__test_.jpg');
    expect(sanitizeFileName('file\x00with\x1fnull.txt')).toBe('filewithnull.txt');
  });

  it('neutralizes Windows reserved device names', () => {
    expect(sanitizeFileName('CON.txt')).toBe('safe_CON.txt');
    expect(sanitizeFileName('NUL')).toBe('safe_NUL');
    expect(sanitizeFileName('com1.dat')).toBe('safe_com1.dat');
  });

  it('safely handles empty or missing names', () => {
    expect(sanitizeFileName('')).toBe('unnamed_file');
    expect(sanitizeFileName(null as any)).toBe('unnamed_file');
  });

  it('validates file sizes within safe bounds', () => {
    expect(isValidFileSize(1024)).toBe(true);
    expect(isValidFileSize(0)).toBe(true);
    expect(isValidFileSize(-5)).toBe(false);
    expect(isValidFileSize(Infinity)).toBe(false);
    expect(isValidFileSize(100 * 1024 * 1024 * 1024, 10 * 1024 * 1024 * 1024)).toBe(false);
  });
});

