import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { createWriteStream, promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { AppError } from '../errors/app-error';
import { AppLogger } from './logger.service';
import { CONFIG } from '../../config/config.module';
import type { AppConfig } from '../../config/configuration';

/**
 * StorageService interface + local-disk implementation — blueprint §10.
 *
 * Rules enforced here (and ONLY here — business code never touches
 * disk or S3 directly):
 *  1. Size limit per call (policy lives in config).
 *  2. MIME sniffed from file BYTES, never from extension/client header.
 *  3. Extension allow-list matched to the sniffed MIME.
 *  4. Stored name is uuid + safe extension; client filename discarded.
 *  5. No user-controlled paths: everything stays under the storage root.
 *  6. Files are private; access is via short-lived signed URLs (Phase 1).
 *
 * Phase 0 ships the LOCAL implementation (dev only). The S3-compatible
 * implementation plugs in behind this interface for prod — no caller changes.
 */

export interface StoredFile {
  /** Opaque storage key, e.g. "avatars/3f9a….png". */
  key: string;
  sizeBytes: number;
  mimeType: string;
}

export interface UploadPolicy {
  /** Max bytes for this upload class (avatars, lesson media, …). */
  maxBytes: number;
  /** Allowed MIME types, sniffed from bytes. */
  allowedMimeTypes: string[];
  /** Bucket prefix, e.g. "avatars". */
  prefix: string;
}

export abstract class StorageService {
  abstract save(stream: Readable, policy: UploadPolicy): Promise<StoredFile>;
  abstract delete(key: string): Promise<void>;
  /** Absolute path only for the local dev implementation (tests/dev tools). */
  abstract resolveLocalPath?(key: string): string;
}

/** Minimal magic-byte MIME sniffing (PNG, JPEG, GIF, WebP, PDF). */
const MAGIC: Array<{ mime: string; ext: string; bytes: number[]; mask?: number[] }> = [
  { mime: 'image/png', ext: 'png', bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] },
  { mime: 'image/jpeg', ext: 'jpg', bytes: [0xff, 0xd8, 0xff] },
  { mime: 'image/gif', ext: 'gif', bytes: [0x47, 0x49, 0x46, 0x38] },
  { mime: 'image/webp', ext: 'webp', bytes: [0x52, 0x49, 0x46, 0x46] },
  { mime: 'application/pdf', ext: 'pdf', bytes: [0x25, 0x50, 0x44, 0x46] },
];

export function sniffMime(head: Buffer): { mime: string; ext: string } | null {
  for (const m of MAGIC) {
    if (m.bytes.every((b, i) => head[i] === b)) return { mime: m.mime, ext: m.ext };
  }
  return null;
}

@Injectable()
export class LocalStorageService extends StorageService {
  private readonly root: string;

  constructor(
    private readonly logger: AppLogger,
    @Inject(CONFIG) config: AppConfig
  ) {
    super();
    // Contain everything under the configured dir; resolve once at boot.
    this.root = resolve(config.STORAGE_LOCAL_DIR);
  }

  override async save(stream: Readable, policy: UploadPolicy): Promise<StoredFile> {
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of stream) {
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array);
      size += buf.length;
      if (size > policy.maxBytes) throw AppError.fileTooLarge();
      chunks.push(buf);
    }
    const body = Buffer.concat(chunks);
    const sniffed = sniffMime(body.subarray(0, 16));
    if (!sniffed) throw AppError.unsupportedFileType('Could not determine file type.');
    if (!policy.allowedMimeTypes.includes(sniffed.mime)) {
      throw AppError.unsupportedFileType();
    }

    const key = `${policy.prefix}/${randomUUID()}.${sniffed.ext}`;
    const dest = this.safePath(key);
    await fs.mkdir(join(this.root, policy.prefix), { recursive: true });
    // Write via temp file then rename — never a partial file at the final key.
    const tmp = join(tmpdir(), `candle-upload-${randomUUID()}`);
    await pipeline(Readable.from([body]), createWriteStream(tmp));
    await fs.rename(tmp, dest);
    this.logger.info('File stored', { key, sizeBytes: size, mimeType: sniffed.mime });
    return { key, sizeBytes: size, mimeType: sniffed.mime };
  }

  override async delete(key: string): Promise<void> {
    await fs.unlink(this.safePath(key)).catch(() => undefined);
  }

  override resolveLocalPath(key: string): string {
    return this.safePath(key);
  }

  /** Rejects any key that escapes the storage root (no ../, no absolutes). */
  private safePath(key: string): string {
    if (key.includes('..') || key.startsWith('/') || key.includes('\0')) {
      throw AppError.unsupportedFileType('Invalid storage key.');
    }
    const dest = resolve(this.root, key);
    if (dest !== this.root && !dest.startsWith(this.root + sep)) {
      throw AppError.unsupportedFileType('Invalid storage key.');
    }
    return dest;
  }
}
