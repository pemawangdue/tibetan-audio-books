type ConfigKey =
  | "VITE_AUTH_MODE"
  | "VITE_COGNITO_USER_POOL_ID"
  | "VITE_COGNITO_CLIENT_ID"
  | "VITE_API_URL"
  | "VITE_USE_MOCK_API";

export interface RuntimeConfig {
  VITE_AUTH_MODE?: string;
  VITE_COGNITO_USER_POOL_ID?: string;
  VITE_COGNITO_CLIENT_ID?: string;
  VITE_API_URL?: string;
  VITE_USE_MOCK_API?: string | boolean;
}

declare global {
  interface Window {
    APP_CONFIG?: RuntimeConfig;
  }
}

function readConfig(key: ConfigKey): string | undefined {
  const runtime = window.APP_CONFIG?.[key];
  if (runtime !== undefined && runtime !== null && String(runtime).trim() !== "") {
    return String(runtime);
  }
  const builtIn = import.meta.env[key];
  if (builtIn !== undefined && builtIn !== null && String(builtIn).trim() !== "") {
    return String(builtIn);
  }
  return undefined;
}

function readFlag(key: "VITE_USE_MOCK_API"): boolean {
  const value = readConfig(key);
  if (value === undefined) return false;
  return value.toLowerCase() === "true";
}

export const authMode = readConfig("VITE_AUTH_MODE") ?? "cognito";
export const mockAuthEnabled = authMode === "mock";
export const cognitoUserPoolId = readConfig("VITE_COGNITO_USER_POOL_ID");
export const cognitoClientId = readConfig("VITE_COGNITO_CLIENT_ID");
export const apiUrl = (readConfig("VITE_API_URL") ?? "").replace(/\/$/, "");
export const mockApiEnabled = readFlag("VITE_USE_MOCK_API");
