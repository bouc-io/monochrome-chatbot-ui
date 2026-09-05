import logger from "./logger";

const log = logger.child("Models");

// Function to get environment variable with fallback to import.meta.env
const getEnvVar = (key: string): string => {
  return (
    (window as { ENV?: Record<string, string> }).ENV?.[key] ||
    import.meta.env[key] ||
    ""
  );
};

const DEFAULT_MODEL_ID = "llama3.2";

/**
 * The model used for every chat. Model selection is server-side; the UI simply
 * forwards this identifier with API calls.
 */
export const getDefaultModelId = (): string => {
  const modelId = getEnvVar("VITE_DEFAULT_MODEL");
  if (!modelId) {
    log.debug(`VITE_DEFAULT_MODEL not set, using "${DEFAULT_MODEL_ID}"`);
    return DEFAULT_MODEL_ID;
  }
  return modelId;
};
