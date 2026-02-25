import { resolve } from 'node:path';
import Dockerode from 'dockerode';

const docker = new Dockerode();
const IMAGE_NAME = 'nanofleet-nanobot:latest';

async function buildNanobotImage(): Promise<void> {
  const context = resolve(import.meta.dir, '.');
  await new Promise<void>((resolve, reject) => {
    docker.buildImage(
      {
        context: context,
        src: ['Dockerfile', 'entrypoint.sh', 'nanofleet_channel.py'],
      },
      { t: IMAGE_NAME },
      (err: Error | null, stream: NodeJS.ReadableStream | undefined) => {
        if (err) {
          reject(err);
          return;
        }
        if (!stream) {
          resolve();
          return;
        }
        docker.modem.followProgress(
          stream,
          (err: Error | null) => {
            if (err) reject(err);
            else resolve();
          },
          (event: { stream?: string; error?: string }) => {
            if (event.stream) process.stdout.write(event.stream);
          }
        );
      }
    );
  });
}

async function getNanobotVersion(): Promise<string | null> {
  try {
    const image = docker.getImage(IMAGE_NAME);
    const info = await image.inspect();
    return (info.Config?.Labels?.['nanobot_version'] as string | undefined) ?? null;
  } catch {
    return null;
  }
}

export async function ensureNanobotImage(): Promise<string | null> {
  try {
    const images = await docker.listImages();
    const exists = images.some((img) => img.RepoTags?.includes(IMAGE_NAME) ?? false);

    if (exists) {
      console.log(`[Docker] Image '${IMAGE_NAME}' already exists`);
    } else {
      console.log(`[Docker] Building image '${IMAGE_NAME}'...`);
      await buildNanobotImage();
      console.log(`[Docker] Image '${IMAGE_NAME}' built successfully`);
    }

    return await getNanobotVersion();
  } catch (error) {
    console.error('[Docker] Failed to ensure Nanobot image:', error);
    throw error;
  }
}

export { docker };
