import Dockerode from 'dockerode';

let docker: Dockerode | null = null;
const IMAGE_NAME = 'ghcr.io/nanofleet/nanofleet-agent:latest';
const AGENT_LABEL_KEY = 'com.nanofleet.agent-version';
const AGENT_LABEL_LEGACY_KEY = 'agent_version';

async function getDocker(): Promise<Dockerode> {
  if (!docker) {
    const instance = new Dockerode();
    try {
      // Lightweight connectivity check to surface configuration errors early.
      await instance.ping();
    } catch (err) {
      console.error('[Docker] Failed to connect to Docker daemon:', err);
      throw new Error('Docker is not available or misconfigured');
    }
    docker = instance;
  }
  return docker;
}

export async function getAgentImageVersion(): Promise<string | null> {
  try {
    const client = await getDocker();
    const image = client.getImage(IMAGE_NAME);
    const info = await image.inspect();
    const labels = info.Config?.Labels ?? {};
    const version =
      (labels[AGENT_LABEL_KEY] as string | undefined) ??
      (labels[AGENT_LABEL_LEGACY_KEY] as string | undefined);
    return version ?? null;
  } catch (err) {
    console.error(
      `[Docker] Failed to inspect image '${IMAGE_NAME}' in getAgentImageVersion:`,
      err,
    );
    return null;
  }
}

export async function ensureAgentImage(): Promise<string | null> {
  try {
    const client = await getDocker();
    const images = await client.listImages();
    const exists = images.some((img) => img.RepoTags?.includes(IMAGE_NAME) ?? false);

    if (!exists) {
      console.log(`[Docker] Image '${IMAGE_NAME}' not found locally, pulling...`);
      await new Promise<void>((resolve, reject) => {
        client.pull(IMAGE_NAME, (err: Error | null, stream?: NodeJS.ReadableStream) => {
          if (err) return reject(err);
          if (!stream) {
            return reject(new Error('Docker pull did not return a stream'));
          }
          client.modem.followProgress(stream, (err: Error | null) => {
            if (err) return reject(err);
            resolve();
          });
        });
      });
      console.log(`[Docker] Image '${IMAGE_NAME}' pulled successfully`);
    } else {
      console.log(`[Docker] Image '${IMAGE_NAME}' found`);
    }

    return await getAgentImageVersion();
  } catch (err) {
    console.error('[Docker] Error ensuring agent image:', err);
    return null;
  }
}

export { docker };
