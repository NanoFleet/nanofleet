import { eq } from 'drizzle-orm';
import { Hono } from 'hono';

import { getDocker, getRemotePluginVersion, pullImage } from '@nanofleet/docker';
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

  const client = await getDocker();

  // Pull image if not present
  const images = await client.listImages();
  const exists = images.some((img) => img.RepoTags?.includes(image) ?? false);
  if (!exists) {
    console.log(`[Channels] Pulling image '${image}'...`);
    await pullImage(image);
  }

  // Fetch version from image label
  const version = await getRemotePluginVersion(image);

  try {
    const container = await client.createContainer({
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
    version,
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

  const client = await getDocker();

  const result = await Promise.all(
    agentChannels.map(async (ch) => {
      let status: 'running' | 'error';
      try {
        const container = client.getContainer(ch.containerName);
        const info = await container.inspect();
        status = info.State.Status === 'running' ? 'running' : 'error';
      } catch {
        status = 'error';
      }
      return { ...ch, status, envVars: ch.envVars ? JSON.parse(ch.envVars) : null };
    })
  );

  return c.json({ channels: result });
});

// ---------------------------------------------------------------------------
// GET /api/channels — all channels across all agents (for the Channels page)
// ---------------------------------------------------------------------------

channelRoutes.get('/', requireAuth, async (c) => {
  const allChannels = await db.select().from(channels);
  const allAgents = await db.select({ id: agents.id, name: agents.name }).from(agents);
  const agentMap = new Map(allAgents.map((a) => [a.id, a.name]));

  const client = await getDocker();

  const result = await Promise.all(
    allChannels.map(async (ch) => {
      let status: 'running' | 'error';
      try {
        const container = client.getContainer(ch.containerName);
        const info = await container.inspect();
        status = info.State.Status === 'running' ? 'running' : 'error';
      } catch {
        status = 'error';
      }
      const remoteVersion = await getRemotePluginVersion(ch.image);
      return {
        ...ch,
        status,
        agentName: agentMap.get(ch.agentId) ?? ch.agentId,
        envVars: ch.envVars ? JSON.parse(ch.envVars) : null,
        remoteVersion,
      };
    })
  );

  return c.json({ channels: result });
});

// ---------------------------------------------------------------------------
// DELETE /api/agents/:agentId/channels/:channelId
// ---------------------------------------------------------------------------

channelRoutes.delete('/:agentId/channels/:channelId', requireAuth, async (c) => {
  const { agentId, channelId } = c.req.param();

  const [channel] = await db.select().from(channels).where(eq(channels.id, channelId)).limit(1);

  if (!channel || channel.agentId !== agentId) {
    return c.json({ error: 'Channel not found' }, 404);
  }

  try {
    const client = await getDocker();
    const container = client.getContainer(channel.containerName);
    await container.stop();
    await container.remove();
  } catch (err) {
    console.warn(`[Channels] Failed to stop/remove container '${channel.containerName}':`, err);
  }

  await db.delete(channels).where(eq(channels.id, channelId));

  console.log(`[Channels] Channel '${channel.type}' removed for agent '${agentId}'`);

  return c.json({ success: true });
});

// ---------------------------------------------------------------------------
// POST /api/channels/:channelId/upgrade
// ---------------------------------------------------------------------------

channelRoutes.post('/upgrade/:channelId', requireAuth, async (c) => {
  const channelId = c.req.param('channelId');

  const [channel] = await db.select().from(channels).where(eq(channels.id, channelId)).limit(1);
  if (!channel) return c.json({ error: 'Channel not found' }, 404);

  const client = await getDocker();

  // Retrieve all env vars (including sensitive ones) from the running container before removing it
  let env: string[] = [];
  try {
    const old = client.getContainer(channel.containerName);
    const info = await old.inspect();
    env = info.Config?.Env ?? [];
    await old.stop();
    await old.remove();
  } catch (err) {
    return c.json(
      {
        error: `Failed to retrieve container config before upgrade: ${err instanceof Error ? err.message : 'Unknown error'}`,
      },
      500
    );
  }

  // Pull latest image
  try {
    await pullImage(channel.image);
  } catch (err) {
    return c.json(
      { error: `Failed to pull image: ${err instanceof Error ? err.message : 'Unknown error'}` },
      500
    );
  }

  try {
    const container = await client.createContainer({
      Image: channel.image,
      name: channel.containerName,
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

  const newVersion = await getRemotePluginVersion(channel.image);

  await db
    .update(channels)
    .set({ version: newVersion ?? channel.version, status: 'running' })
    .where(eq(channels.id, channelId));

  console.log(`[Channels] Channel '${channel.type}' upgraded to ${newVersion ?? 'unknown'}`);

  return c.json({ success: true, version: newVersion ?? channel.version });
});
