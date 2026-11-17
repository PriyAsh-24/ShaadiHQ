const DEFAULT_API_BASE_URL = "http://localhost:8080";

function getApiBaseUrl(configuredUrl = process.env.NEXT_PUBLIC_API_URL, environment = process.env.NODE_ENV) {
  const configuredBaseUrl = (configuredUrl || "").trim().replace(/\/+$/, "");
  if (!configuredBaseUrl && environment === "production") {
    throw new Error("NEXT_PUBLIC_API_URL must be set to the Go API URL before building for production.");
  }
  return configuredBaseUrl || DEFAULT_API_BASE_URL;
}

module.exports = { getApiBaseUrl };
