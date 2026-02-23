import { resolve } from 'node:path';
import Dockerode from 'dockerode';

const docker = new Dockerode();
const IMAGE_NAME = 'nanofleet-nanobot:latest';

export async function ensureNanobotImage(): Promise<void> {
  try {
    const images = await docker.listImages();
    const exists = images.some((img) => img.RepoTags?.includes(IMAGE_NAME) ?? false);

    if (exists) {
      console.log(`[Docker] Image '${IMAGE_NAME}' already exists`);
      return;
    }

    console.log(`[Docker] Building image '${IMAGE_NAME}'...`);

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

    console.log(`[Docker] Image '${IMAGE_NAME}' built successfully`);
  } catch (error) {
    console.error('[Docker] Failed to ensure Nanobot image:', error);
    throw error;
  }
}

export { docker };
