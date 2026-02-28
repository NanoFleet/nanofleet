import { eq } from 'drizzle-orm';
import { Hono } from 'hono';

import { docker } from '@nanofleet/docker';
import { DeployChannelPayloadSchema } from '@nanofleet/shared';
import { db } from '../db';
import { agents, channels } from '../db/schema';
import { requireAuth } from '../middleware/auth';

export const channelRoutes = new Hono();

const NETWORK_NAME = 'nanofleet-net';

const CHANNEL_IMAGES: Record<string, string> = {
  telegram: 'ghcr.io/nanofleet/nanofleet-channel-telegram:latest',
};

// ---------------------------------------------------------------------------
// POST /api/agents/:agentId/channels
// ---------------------------------------------------------------------------

channelRoutes.post('/:agentId/channels', requireAuth, async (c) => {
  const agentId = c.req.param('agentId');

  const [agent] = await db.select().from(agents).where(eq(agents.id, agentId)).limit(1);
  if (!agent) return c.json({ error: 'Agent not found' }, 404);

  const body = await c.req.json();
  const parsed = DeployChannelPayloadSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: 'Validation Error', details: parsed.error.issues }, 400);
  }

  const payload = parsed.data;
  const image = CHANNEL_IMAGES[payload.type];
  const channelId = crypto.randomUUID();
  const containerName = `nanofleet-channel-${payload.type}-${agentId.slice(0, 8)}`;

  // Build env vars (sensitive values not stored in DB)
  const agentContainerName = `nanofleet-agent-${agentId}`;
  const env: string[] = [`AGENT_URL=http://${agentContainerName}:4111`];
  const storedEnvVars: Record<string, string> = {
    AGENT_URL: `http://${agentContainerName}:4111`,
  };

  if (payload.type === 'telegram') {
    env.push(`TELEGRAM_BOT_TOKEN=${payload.botToken}`);
    if (payload.allowedUsers) {
      env.push(`ALLOWED_USERS=${payload.allowedUsers}`);
      storedEnvVars.ALLOWED_USERS = payload.allowedUsers;
    }
    if (payload.notificationUserId) {
      env.push(`NOTIFICATION_USER_ID=${payload.notificationUserId}`);
      storedEnvVars.NOTIFICATION_USER_ID = payload.notificationUserId;
    }
  }

  // Pull image if not present
  const images = await docker.listImages();
  const exists = images.some((img) => img.RepoTags?.includes(image) ?? false);
  if (!exists) {
    console.log(`[Channels] Pulling image '${image}'...`);
    await new Promise<void>((resolve, reject) => {
      docker.pull(image, (err: Error | null, stream: NodeJS.ReadableStream) => {
        if (err) return reject(err);
        docker.modem.followProgress(stream, (err: Error | null) => {
          if (err) return reject(err);
          resolve();
        });
      });
    });
  }

  try {
    const container = await docker.createContainer({
      Image: image,
      name: containerName,
      Env: env,
      HostConfig: {
        NetworkMode: NETWORK_NAME,
        RestartPolicy: { Name: 'unless-stopped' },
      },
    });
    await container.start();
  } catch (err) {
    return c.json(
      {
        error: `Failed to start channel container: ${err instanceof Error ? err.message : 'Unknown error'}`,
      },
      500
    );
  }

  await db.insert(channels).values({
    id: channelId,
    agentId,
    type: payload.type,
    image,
    containerName,
    status: 'running',
    envVars: JSON.stringify(storedEnvVars),
  });

  console.log(`[Channels] Channel '${payload.type}' deployed for agent '${agentId}'`);

  return c.json({ id: channelId, type: payload.type, status: 'running' }, 201);
});

// ---------------------------------------------------------------------------
// GET /api/agents/:agentId/channels
// ---------------------------------------------------------------------------

channelRoutes.get('/:agentId/channels', requireAuth, async (c) => {
  const agentId = c.req.param('agentId');

  const agentChannels = await db.select().from(channels).where(eq(channels.agentId, agentId));

  return c.json({
    channels: agentChannels.map((ch) => ({
      ...ch,
      envVars: ch.envVars ? JSON.parse(ch.envVars) : null,
    })),
  });
});

// ---------------------------------------------------------------------------
// DELETE /api/agents/:agentId/channels/:channelId
// ---------------------------------------------------------------------------

channelRoutes.delete('/:agentId/channels/:channelId', requireAuth, async (c) => {
  const { agentId, channelId } = c.req.param();

  const [channel] = await db
    .select()
    .from(channels)
    .where(eq(channels.id, channelId))
    .limit(1);

  if (!channel || channel.agentId !== agentId) {
    return c.json({ error: 'Channel not found' }, 404);
  }

  try {
    const container = docker.getContainer(channel.containerName);
    await container.stop();
    await container.remove();
  } catch (err) {
    console.warn(`[Channels] Failed to stop/remove container '${channel.containerName}':`, err);
  }

  await db.delete(channels).where(eq(channels.id, channelId));

  console.log(`[Channels] Channel '${channel.type}' removed for agent '${agentId}'`);

  return c.json({ success: true });
});
