import Dockerode from 'dockerode';

const docker = new Dockerode();

const NETWORK_NAME = 'nanofleet-net';

async function isDockerAvailable(): Promise<boolean> {
  try {
    await docker.ping();
    return true;
  } catch {
    return false;
  }
}

export async function initDockerNetwork(): Promise<void> {
  if (!(await isDockerAvailable())) {
    console.log('[Docker] Docker daemon not available, skipping network creation');
    return;
  }

  try {
    await docker.createNetwork({
      Name: NETWORK_NAME,
      Driver: 'bridge',
      Internal: false,
    });
    console.log(`[Docker] Network '${NETWORK_NAME}' created`);
  } catch (error: unknown) {
    if (error instanceof Error && 'statusCode' in error) {
      const dockerError = error as { statusCode: number };
      if (dockerError.statusCode === 409) {
        console.log(`[Docker] Network '${NETWORK_NAME}' already exists`);
        return;
      }
    }
    console.error('[Docker] Failed to create network:', error);
  }
}

export async function initDockerInfrastructure(): Promise<void> {
  await initDockerNetwork();
}
