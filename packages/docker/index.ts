import Dockerode from 'dockerode';

const docker = new Dockerode();
const IMAGE_NAME = 'ghcr.io/nanofleet/nanofleet-agent:latest';

export async function getAgentImageVersion(): Promise<string | null> {
  try {
    const image = docker.getImage(IMAGE_NAME);
    const info = await image.inspect();
    return (info.Config?.Labels?.['agent_version'] as string | undefined) ?? null;
  } catch {
    return null;
  }
}

export async function ensureAgentImage(): Promise<string | null> {
  const images = await docker.listImages();
  const exists = images.some((img) => img.RepoTags?.includes(IMAGE_NAME) ?? false);

  if (!exists) {
    console.log(`[Docker] Image '${IMAGE_NAME}' not found locally, pulling...`);
    await new Promise<void>((resolve, reject) => {
      docker.pull(IMAGE_NAME, (err: Error | null, stream: NodeJS.ReadableStream) => {
        if (err) return reject(err);
        docker.modem.followProgress(stream, (err: Error | null) => {
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
}

export { docker };
