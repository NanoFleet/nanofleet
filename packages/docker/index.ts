import Dockerode from 'dockerode';

let docker: Dockerode | null = null;
const IMAGE_NAME = 'ghcr.io/nanofleet/nanofleet-agent:latest';
const AGENT_LABEL_KEY = 'com.nanofleet.agent-version';
const AGENT_LABEL_LEGACY_KEY = 'agent_version';
const GHCR_REPO = 'nanofleet/nanofleet-agent';

// Cache remote version for 5 minutes to avoid hammering GHCR on every GET /api/agents
let remoteVersionCache: { version: string | null; expiresAt: number } | null = null;

export async function getRemoteAgentVersion(): Promise<string | null> {
  const now = Date.now();
  if (remoteVersionCache && now < remoteVersionCache.expiresAt) {
    return remoteVersionCache.version;
  }

  try {
    // Get an anonymous token for GHCR
    const tokenRes = await fetch(
      `https://ghcr.io/token?scope=repository:${GHCR_REPO}:pull&service=ghcr.io`
    );
    if (!tokenRes.ok) throw new Error(`Token fetch failed: ${tokenRes.status}`);
    const { token } = (await tokenRes.json()) as { token: string };

    const headers = { Authorization: `Bearer ${token}` };

    // Fetch :latest — may be an OCI index (multi-arch) or a single manifest
    const indexRes = await fetch(`https://ghcr.io/v2/${GHCR_REPO}/manifests/latest`, {
      headers: {
        ...headers,
        Accept: [
          'application/vnd.oci.image.index.v1+json',
          'application/vnd.oci.image.manifest.v1+json',
          'application/vnd.docker.distribution.manifest.v2+json',
        ].join(','),
      },
    });
    if (!indexRes.ok) throw new Error(`Manifest fetch failed: ${indexRes.status}`);
    const index = (await indexRes.json()) as {
      mediaType?: string;
      manifests?: { digest: string; platform?: { architecture: string; os: string } }[];
      config?: { digest: string };
    };

    // Resolve to a single-arch manifest if we got an index
    let configDigest: string | undefined;
    if (index.manifests) {
      // Pick amd64 first, fall back to first entry
      const entry =
        index.manifests.find(
          (m) => m.platform?.architecture === 'amd64' && m.platform?.os === 'linux'
        ) ?? index.manifests[0];
      if (!entry) throw new Error('Empty manifest index');

      const mRes = await fetch(`https://ghcr.io/v2/${GHCR_REPO}/manifests/${entry.digest}`, {
        headers: { ...headers, Accept: 'application/vnd.oci.image.manifest.v1+json' },
      });
      if (!mRes.ok) throw new Error(`Single manifest fetch failed: ${mRes.status}`);
      const m = (await mRes.json()) as { config?: { digest: string } };
      configDigest = m.config?.digest;
    } else {
      configDigest = index.config?.digest;
    }

    if (!configDigest) throw new Error('Could not resolve config digest');

    // Fetch the config blob to read labels
    const configRes = await fetch(`https://ghcr.io/v2/${GHCR_REPO}/blobs/${configDigest}`, {
      headers,
    });
    if (!configRes.ok) throw new Error(`Config blob fetch failed: ${configRes.status}`);
    const config = (await configRes.json()) as { config?: { Labels?: Record<string, string> } };

    const labels = config.config?.Labels ?? {};
    const version =
      (labels[AGENT_LABEL_KEY] as string | undefined) ??
      (labels[AGENT_LABEL_LEGACY_KEY] as string | undefined) ??
      null;

    remoteVersionCache = { version, expiresAt: now + 5 * 60 * 1000 };
    return version;
  } catch (err) {
    console.error('[Docker] Failed to fetch remote agent version from GHCR:', err);
    remoteVersionCache = { version: null, expiresAt: now + 60 * 1000 }; // retry after 1 min on error
    return null;
  }
}

export async function getDocker(): Promise<Dockerode> {
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

export async function pullAgentImage(): Promise<string | null> {
  try {
    const client = await getDocker();
    console.log(`[Docker] Pulling image '${IMAGE_NAME}'...`);
    await new Promise<void>((resolve, reject) => {
      client.pull(IMAGE_NAME, (err: Error | null, stream?: NodeJS.ReadableStream) => {
        if (err) return reject(err);
        if (!stream) return reject(new Error('Docker pull did not return a stream'));
        client.modem.followProgress(stream, (err: Error | null) => {
          if (err) return reject(err);
          resolve();
        });
      });
    });
    console.log(`[Docker] Image '${IMAGE_NAME}' pulled successfully`);
    return await getAgentImageVersion();
  } catch (err) {
    console.error('[Docker] Error pulling agent image:', err);
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
