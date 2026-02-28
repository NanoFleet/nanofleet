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
  try {
    const images = await docker.listImages();
    const exists = images.some((img) => img.RepoTags?.includes(IMAGE_NAME) ?? false);

    if (exists) {
      console.log(`[Docker] Image '${IMAGE_NAME}' found`);
    } else {
      throw new Error(
        `[Docker] Image '${IMAGE_NAME}' not found. Please build nanofleet-agent first.`
      );
    }

    return await getAgentImageVersion();
  } catch (error) {
    console.error('[Docker] Failed to ensure agent image:', error);
    throw error;
  }
}

export { docker };
