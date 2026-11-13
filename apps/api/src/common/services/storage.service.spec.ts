import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdtempSync } from 'node:fs';
import { Readable } from 'node:stream';
import { ErrorCode } from '@candle/shared';
import { AppError } from '../errors/app-error';
import { LocalStorageService, UploadPolicy, sniffMime } from './storage.service';
import { AppLogger } from './logger.service';
import type { AppConfig } from '../../config/configuration';

const PNG_HEAD = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);
const JPEG_HEAD = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00]);

function serviceIn(tmp: string): LocalStorageService {
  const config = { STORAGE_LOCAL_DIR: tmp } as AppConfig;
  return new LocalStorageService(new AppLogger(), config);
}

const imagePolicy: UploadPolicy = {
  maxBytes: 1024,
  allowedMimeTypes: ['image/png', 'image/jpeg'],
  prefix: 'avatars',
};

describe('sniffMime', () => {
  it('detects PNG and JPEG from magic bytes', () => {
    expect(sniffMime(PNG_HEAD)?.mime).toBe('image/png');
    expect(sniffMime(JPEG_HEAD)?.mime).toBe('image/jpeg');
  });

  it('returns null for unknown bytes', () => {
    expect(sniffMime(Buffer.from('hello world, not a file'))).toBeNull();
  });
});

describe('LocalStorageService', () => {
  it('stores a valid file and discards the client filename', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'candle-storage-'));
    const svc = serviceIn(tmp);
    const stored = await svc.save(Readable.from([PNG_HEAD]), imagePolicy);
    expect(stored.key).toMatch(/^avatars\/[0-9a-f-]+\.png$/);
    expect(stored.mimeType).toBe('image/png');
    expect(stored.sizeBytes).toBe(PNG_HEAD.length);
  });

  it('rejects files over the size limit', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'candle-storage-'));
    const svc = serviceIn(tmp);
    const big = Buffer.alloc(2048, 0);
    await expect(svc.save(Readable.from([big]), imagePolicy)).rejects.toMatchObject({
      code: ErrorCode.FILE_TOO_LARGE,
    });
  });

  it('rejects files whose sniffed MIME is not allow-listed', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'candle-storage-'));
    const svc = serviceIn(tmp);
    const pdfHead = Buffer.from([0x25, 0x50, 0x44, 0x46, 0x2d]);
    await expect(
      svc.save(Readable.from([pdfHead]), { ...imagePolicy, allowedMimeTypes: ['image/png'] })
    ).rejects.toMatchObject({ code: ErrorCode.UNSUPPORTED_FILE_TYPE });
  });

  it('rejects unidentifiable bytes regardless of claimed type', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'candle-storage-'));
    const svc = serviceIn(tmp);
    await expect(
      svc.save(Readable.from([Buffer.from('definitely-not-an-image')]), imagePolicy)
    ).rejects.toMatchObject({ code: ErrorCode.UNSUPPORTED_FILE_TYPE });
  });

  it('refuses path traversal in resolveLocalPath', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'candle-storage-'));
    const svc = serviceIn(tmp);
    expect(() => svc.resolveLocalPath('../etc/passwd')).toThrow(AppError);
    expect(() => svc.resolveLocalPath('/abs/path')).toThrow(AppError);
  });
});
