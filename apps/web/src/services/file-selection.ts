import { FileMetadata } from '@peerport/shared-types';
import { sanitizeFileName } from '@peerport/validation';

export type FileCategory = 'photo' | 'video' | 'audio' | 'document' | 'archive' | 'file';

export function categorizeFile(file: File | { name: string; mimeType?: string }): FileCategory {
  const mime = ('type' in file ? file.type : file.mimeType) || '';
  const ext = file.name.split('.').pop()?.toLowerCase() || '';

  if (mime.startsWith('image/') || ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'heic'].includes(ext)) {
    return 'photo';
  }
  if (mime.startsWith('video/') || ['mp4', 'mkv', 'mov', 'webm', 'avi'].includes(ext)) {
    return 'video';
  }
  if (mime.startsWith('audio/') || ['mp3', 'wav', 'flac', 'aac', 'ogg', 'm4a'].includes(ext)) {
    return 'audio';
  }
  if (
    mime.includes('pdf') ||
    mime.includes('word') ||
    mime.includes('document') ||
    ['pdf', 'doc', 'docx', 'txt', 'md', 'xls', 'xlsx', 'ppt', 'pptx'].includes(ext)
  ) {
    return 'document';
  }
  if (['zip', 'rar', '7z', 'tar', 'gz'].includes(ext)) {
    return 'archive';
  }
  return 'file';
}

export function formatBytes(bytes: number, decimals = 1): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} ${sizes[i]}`;
}

export function createFileMetadata(file: File, id?: string): FileMetadata {
  return {
    id: id || `file_${Math.random().toString(36).substring(2, 10)}`,
    name: sanitizeFileName(file.name),
    size: file.size,
    mimeType: file.type || 'application/octet-stream',
    lastModified: file.lastModified
  };
}

/**
 * Triggers a download of a Blob using native browser download mechanics.
 */
export function triggerFileDownload(blob: Blob, fileName: string): void {
  const safeName = sanitizeFileName(fileName);
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = safeName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);

  // Revoke object URL after delay
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
