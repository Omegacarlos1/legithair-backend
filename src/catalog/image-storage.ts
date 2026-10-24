import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { AppError } from '../http/errors.js';

export type SupportedImageMime = 'image/jpeg' | 'image/png' | 'image/webp';

interface StoredImage {
  storageKey: string;
  mimeType: SupportedImageMime;
  sizeBytes: number;
}

export class LocalImageStorage {
  private readonly root: string;

  public constructor(root: string) {
    this.root = resolve(root);
  }

  public async save(productId: string, buffer: Buffer, declaredMime: string): Promise<StoredImage> {
    const detected = detectImage(buffer);
    if (!detected || detected.mimeType !== declaredMime) {
      throw new AppError(415, 'UNSUPPORTED_IMAGE_TYPE', 'Only valid JPEG, PNG, and WebP images are allowed');
    }
    const storageKey = `${productId}/${randomUUID()}.${detected.extension}`;
    const target = this.safePath(storageKey);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, buffer, { flag: 'wx', mode: 0o600 });
    return { storageKey, mimeType: detected.mimeType, sizeBytes: buffer.length };
  }

  public async read(storageKey: string): Promise<Buffer> {
    return readFile(this.safePath(storageKey));
  }

  public async remove(storageKey: string): Promise<void> {
    await rm(this.safePath(storageKey), { force: true });
  }

  private safePath(storageKey: string): string {
    const target = resolve(this.root, storageKey);
    const fromRoot = relative(this.root, target);
    if (fromRoot.startsWith('..') || isAbsolute(fromRoot)) throw new AppError(500, 'IMAGE_STORAGE_ERROR', 'Image storage path is invalid');
    return target;
  }
}

function detectImage(buffer: Buffer): { mimeType: SupportedImageMime; extension: string } | undefined {
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return { mimeType: 'image/png', extension: 'png' };
  }
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return { mimeType: 'image/jpeg', extension: 'jpg' };
  }
  if (buffer.length >= 12 && buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP') {
    return { mimeType: 'image/webp', extension: 'webp' };
  }
  return undefined;
}
