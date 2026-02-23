import { Hono } from 'hono';

import { PACKS_DIR, extractPack, listPacks, validatePack } from '../lib/packs';
import { requireAuth } from '../middleware/auth';

export const packsRoutes = new Hono();

packsRoutes.get('/', requireAuth, async (c) => {
  const packs = await listPacks();

  const packsWithMeta = await Promise.all(
    packs.map(async (packName) => {
      const validation = await validatePack(`${PACKS_DIR}/${packName}`);
      return {
        name: packName,
        valid: validation.valid,
        errors: validation.errors,
      };
    })
  );

  return c.json({ packs: packsWithMeta });
});

packsRoutes.post('/', requireAuth, async (c) => {
  const formData = await c.req.formData();
  const file = formData.get('file') as File | null;

  if (!file) {
    return c.json({ error: 'No file provided' }, 400);
  }

  const packName = file.name.replace('.zip', '').replace(/[^a-zA-Z0-9-_]/g, '-');

  const arrayBuffer = await file.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);

  try {
    const packPath = await extractPack(buffer, packName);

    const validation = await validatePack(packPath);
    if (!validation.valid) {
      return c.json({ error: 'Invalid pack', errors: validation.errors }, 400);
    }

    return c.json({ success: true, packName }, 201);
  } catch (error) {
    console.error('Failed to extract pack:', error);
    return c.json({ error: 'Failed to extract pack' }, 500);
  }
});
