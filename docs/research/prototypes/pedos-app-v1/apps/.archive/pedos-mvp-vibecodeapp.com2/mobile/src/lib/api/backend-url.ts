export const DEFAULT_DEV_BACKEND_PORT = "3002";

type BackendEnv = Record<string, string | undefined>;

type BackendRuntimeInfo = {
  expoHostUri?: string | null;
  platformHostUri?: string | null;
  webHostname?: string | null;
};

const EXPLICIT_BACKEND_KEYS = [
  "EXPO_PUBLIC_BACKEND_URL",
  "EXPO_PUBLIC_VIBECODE_BACKEND_URL",
] as const;

export function normalizeBackendUrl(url: string): string {
  return url.trim().replace(/\/+$/, "");
}

export function deriveBackendUrlFromHostUri(
  hostUri: string,
  port: string = DEFAULT_DEV_BACKEND_PORT
): string | null {
  const trimmedHostUri = hostUri.trim();
  if (!trimmedHostUri) {
    return null;
  }

  const withoutProtocol = trimmedHostUri.replace(/^[a-z]+:\/\//i, "");
  const hostSegment = withoutProtocol.split("/")[0];
  const hostname = hostSegment?.split(":")[0]?.trim();

  if (!hostname) {
    return null;
  }

  return `http://${hostname}:${port}`;
}

export function resolveBackendUrlFromConfig(
  env: BackendEnv,
  runtimeInfo: BackendRuntimeInfo = {}
): string {
  for (const key of EXPLICIT_BACKEND_KEYS) {
    const explicitUrl = env[key];
    if (explicitUrl?.trim()) {
      return normalizeBackendUrl(explicitUrl);
    }
  }

  const backendPort = env.EXPO_PUBLIC_BACKEND_PORT?.trim() || DEFAULT_DEV_BACKEND_PORT;
  const derivedUrl =
    deriveBackendUrlFromHostUri(runtimeInfo.expoHostUri ?? "", backendPort) ??
    deriveBackendUrlFromHostUri(runtimeInfo.platformHostUri ?? "", backendPort) ??
    (runtimeInfo.webHostname?.trim()
      ? `http://${runtimeInfo.webHostname.trim()}:${backendPort}`
      : null);

  if (derivedUrl) {
    return normalizeBackendUrl(derivedUrl);
  }

  throw new Error(
    "Backend URL is not configured. Set EXPO_PUBLIC_BACKEND_URL or run Expo on the same machine as the backend."
  );
}

export function buildBackendUrl(baseUrl: string, path: string): string {
  const normalizedBaseUrl = normalizeBackendUrl(baseUrl);
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `${normalizedBaseUrl}${normalizedPath}`;
}
