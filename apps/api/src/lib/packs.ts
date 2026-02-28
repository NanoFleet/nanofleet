import { mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, relative, resolve, sep } from 'node:path';

export const PACKS_DIR = resolve(homedir(), '.nanofleet', 'packs');

const ALLOWED_EXTENSIONS = new Set(['.md', '.json', '.py', '.txt', '.csv', '.yaml', '.yml']);
const MAX_TOTAL_SIZE = 50 * 1024 * 1024;
const MAX_ENTRIES = 100;
const MAX_RATIO = 100;

export async function ensurePacksDir(): Promise<void> {
  await mkdir(PACKS_DIR, { recursive: true });
}

export async function extractPack(zipBuffer: Buffer, packName: string): Promise<string> {
  const targetDir = resolve(PACKS_DIR, packName);

  try {
    await rm(targetDir, { recursive: true, force: true });
  } catch {}

  await mkdir(targetDir, { recursive: true });

  const AdmZip = require('adm-zip');
  const zip = new AdmZip(zipBuffer);
  const entries = zip.getEntries();

  if (entries.length > MAX_ENTRIES) {
    throw new Error(`[SECURITY] Too many files: ${entries.length} (max: ${MAX_ENTRIES})`);
  }

  let totalExtractedSize = 0;

  for (const entry of entries) {
    if (entry.isDirectory) continue;
    if (entry.entryName.startsWith('__MACOSX/') || entry.entryName.startsWith('._')) continue;

    const ext = entry.entryName.toLowerCase().split('.').pop() ?? '';
    if (!ext || !ALLOWED_EXTENSIONS.has(`.${ext}`)) {
      throw new Error(`[SECURITY] Disallowed extension: .${ext} (${entry.entryName})`);
    }

    if (entry.header.compressedSize > 0) {
      const ratio = entry.header.size / entry.header.compressedSize;
      if (ratio > MAX_RATIO) {
        throw new Error(
          `[SECURITY] Suspicious compression ratio: ${ratio.toFixed(0)}:1 (${entry.entryName})`
        );
      }
    }

    totalExtractedSize += entry.header.size;
    if (totalExtractedSize > MAX_TOTAL_SIZE) {
      throw new Error(
        `[SECURITY] Total uncompressed size exceeds ${MAX_TOTAL_SIZE / 1024 / 1024} MB`
      );
    }

    const entryName = entry.entryName;
    const targetPath = join(targetDir, entryName);
    const resolvedPath = resolve(targetPath);

    const targetDirResolved = resolve(targetDir);
    if (!resolvedPath.startsWith(targetDirResolved + sep) && resolvedPath !== targetDirResolved) {
      throw new Error(`[SECURITY] Zip Slip attempt detected: ${entryName}`);
    }

    const parentDir = resolve(resolvedPath, '..');
    if (!parentDir.startsWith(targetDirResolved)) {
      throw new Error(`[SECURITY] Parent directory outside bounds: ${entryName}`);
    }

    await mkdir(parentDir, { recursive: true });

    const data = entry.getData();
    await writeFile(resolvedPath, data);
  }

  return targetDir;
}

export async function validatePack(
  packPath: string
): Promise<{ valid: boolean; errors: string[] }> {
  const errors: string[] = [];

  try {
    const manifestPath = resolve(packPath, 'manifest.json');
    const soulPath = resolve(packPath, 'SOUL.md');

    try {
      await stat(manifestPath);
    } catch {
      errors.push('manifest.json not found');
    }

    try {
      await stat(soulPath);
    } catch {
      errors.push('SOUL.md not found');
    }
  } catch (error) {
    errors.push(`Validation error: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }

  return { valid: errors.length === 0, errors };
}

export async function getRequiredEnvVars(packPath: string): Promise<string[]> {
  const manifestPath = resolve(packPath, 'manifest.json');

  try {
    const content = await readFile(manifestPath, 'utf-8');
    const manifest = JSON.parse(content);
    return manifest.requiredEnvVars || [];
  } catch {
    return [];
  }
}

export async function listPacks(): Promise<string[]> {
  await ensurePacksDir();

  const entries = await readdir(PACKS_DIR, { withFileTypes: true });
  return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);
}

