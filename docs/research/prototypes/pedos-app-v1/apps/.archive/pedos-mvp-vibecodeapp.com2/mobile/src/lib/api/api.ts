import { fetch } from "expo/fetch";
import Constants from "expo-constants";
import { buildBackendUrl, resolveBackendUrlFromConfig } from "./backend-url";

// Response envelope type - all app routes return { data: T }
interface ApiResponse<T> {
  data: T;
}

interface ApiErrorResponse {
  error?: {
    message?: string;
  };
}

function getWebHostname(): string | null {
  if (typeof window === "undefined" || !window.location.hostname) {
    return null;
  }

  return window.location.hostname;
}

export function getBackendUrl(): string {
  return resolveBackendUrlFromConfig(process.env, {
    expoHostUri: Constants.expoConfig?.hostUri ?? null,
    platformHostUri: Constants.platform?.hostUri ?? null,
    webHostname: getWebHostname(),
  });
}

export function buildBackendRequestUrl(path: string): string {
  return buildBackendUrl(getBackendUrl(), path);
}

const request = async <T>(
  url: string,
  options: { method?: string; body?: string } = {}
): Promise<T> => {
  const requestUrl = buildBackendRequestUrl(url);
  let response: Response;

  try {
    response = await fetch(requestUrl, {
      ...options,
      headers: options.body ? { "Content-Type": "application/json" } : undefined,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown network error";
    throw new Error(`Request failed for ${requestUrl}: ${message}`);
  }

  // 1. Handle 204 No Content
  if (response.status === 204) {
    return undefined as T;
  }

  const contentType = response.headers.get("content-type");
  const isJson = contentType?.includes("application/json") ?? false;

  let json: ApiResponse<T> | ApiErrorResponse | undefined;
  if (isJson) {
    json = await response.json();
  }

  if (!response.ok) {
    const errorMessage =
      json && "error" in json && json.error?.message
        ? json.error.message
        : `Request failed with status ${response.status}`;
    throw new Error(`${errorMessage} (${requestUrl})`);
  }

  // 2. JSON responses: parse and unwrap { data }
  if (isJson) {
    return (json as ApiResponse<T>).data;
  }

  // 3. Non-JSON: return undefined
  return undefined as T;
};

export const api = {
  get: <T>(url: string) => request<T>(url),
  post: <T>(url: string, body: any) =>
    request<T>(url, { method: "POST", body: JSON.stringify(body) }),
  put: <T>(url: string, body: any) =>
    request<T>(url, { method: "PUT", body: JSON.stringify(body) }),
  delete: <T>(url: string) => request<T>(url, { method: "DELETE" }),
  patch: <T>(url: string, body: any) =>
    request<T>(url, { method: "PATCH", body: JSON.stringify(body) }),
};
