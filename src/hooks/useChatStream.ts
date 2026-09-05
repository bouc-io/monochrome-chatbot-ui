import { useState, useRef, useCallback } from "react";
import logger from "@/lib/logger";

const log = logger.child("ChatStream");

// Get environment variable with fallback to import.meta.env
const getEnvVar = (key: string): string => {
  return (window as any).ENV?.[key] || import.meta.env[key] || "";
};

export interface UseChatStreamOptions {
  chatId: string | null;
  getAuthHeaders: () => Record<string, string>;
  onUserMessageCreated?: (messageId: string) => void;
  onMessageCreated: (
    content: string,
    messageId: string,
    tokenUsage: {
      prompt_tokens: number;
      completion_tokens: number;
      total_tokens: number;
    },
  ) => void;
  onRunCompleted: () => void;
  onRunFailed: (error: string) => void;
}

export interface UseChatStreamResult {
  sendMessage: (
    content: string,
    model_id: string,
    think?: boolean,
  ) => Promise<void>;
  streamingTokens: string;
  streamingThinking: string;
  isStreaming: boolean;
  error: string | null;
  cancel: () => void;
}

export const useChatStream = ({
  chatId,
  getAuthHeaders,
  onUserMessageCreated,
  onMessageCreated,
  onRunCompleted,
  onRunFailed,
}: UseChatStreamOptions): UseChatStreamResult => {
  const [streamingTokens, setStreamingTokens] = useState("");
  const [streamingThinking, setStreamingThinking] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const abortControllerRef = useRef<AbortController | null>(null);
  const tokensRef = useRef("");
  const thinkingRef = useRef("");

  const cancel = useCallback(() => {
    if (abortControllerRef.current) {
      log.info("Cancelling chat stream");
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
  }, []);

  const sendMessage = useCallback(
    async (content: string, model_id: string, think: boolean = true) => {
      if (!chatId) {
        log.warn("sendMessage called without chatId");
        return;
      }

      // Cancel any in-progress stream
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }

      const abortController = new AbortController();
      abortControllerRef.current = abortController;

      // Reset streaming state
      tokensRef.current = "";
      thinkingRef.current = "";
      setStreamingTokens("");
      setStreamingThinking("");
      setIsStreaming(true);
      setError(null);

      try {
        const headers = getAuthHeaders();
        const baseUrl = getEnvVar("VITE_API_URL");

        log.info("Opening SSE stream", { chatId, model_id });

        const response = await fetch(`${baseUrl}/v1/chats/${chatId}/stream`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "text/event-stream",
            ...headers,
          },
          body: JSON.stringify({ content, model_id, think }),
          signal: abortController.signal,
          credentials: "include",
        });

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const reader = response.body?.getReader();
        if (!reader) throw new Error("No readable stream available");

        const decoder = new TextDecoder();
        let buffer = "";
        let currentEventType = "message";
        let currentData = "";

        // SSE parsing loop — same approach as useRunStream in monochrome-agent-ui
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";

          for (const line of lines) {
            if (line.startsWith("event:")) {
              currentEventType = line.slice(6).trim();
            } else if (line.startsWith("data:")) {
              currentData += line.slice(5).trim();
            } else if (line === "") {
              // Blank line = end of one SSE event
              if (currentData) {
                try {
                  const parsed = JSON.parse(currentData);
                  // Fall back to parsed.type for generic "message" events
                  const eventType =
                    currentEventType === "message" && parsed.type
                      ? parsed.type
                      : currentEventType;

                  log.debug("SSE event received:", eventType, parsed);

                  switch (eventType) {
                    case "user_message.created":
                      onUserMessageCreated?.(parsed.message_id as string);
                      break;

                    case "run.status":
                      // Already streaming — nothing extra to do
                      break;

                    case "message.token": {
                      const token = (parsed.token as string) || "";
                      tokensRef.current += token;
                      setStreamingTokens(tokensRef.current);
                      break;
                    }

                    case "message.thinking_token": {
                      const token = (parsed.token as string) || "";
                      thinkingRef.current += token;
                      setStreamingThinking(thinkingRef.current);
                      break;
                    }

                    case "message.created": {
                      const content = (parsed.content as string) || "";
                      const messageId = (parsed.message_id as string) || "";
                      const tokenUsage = {
                        prompt_tokens: (parsed.prompt_tokens as number) || 0,
                        completion_tokens:
                          (parsed.completion_tokens as number) || 0,
                        total_tokens: (parsed.total_tokens as number) || 0,
                      };
                      // Clear streaming buffers before notifying caller
                      tokensRef.current = "";
                      thinkingRef.current = "";
                      setStreamingTokens("");
                      setStreamingThinking("");
                      onMessageCreated(content, messageId, tokenUsage);
                      break;
                    }

                    case "run.completed":
                      log.info("SSE stream completed");
                      setIsStreaming(false);
                      onRunCompleted();
                      abortController.abort();
                      break;

                    case "run.failed": {
                      const errMsg =
                        (parsed.error as string) || "Stream failed";
                      log.error("SSE stream failed:", errMsg);
                      setError(errMsg);
                      setIsStreaming(false);
                      onRunFailed(errMsg);
                      abortController.abort();
                      break;
                    }

                    case "distill.triggered":
                      log.info("Distillation triggered");
                      break;

                    default:
                      log.warn("Unknown SSE event:", eventType, parsed);
                  }
                } catch {
                  log.warn(
                    "Failed to parse SSE data:",
                    currentData.slice(0, 200),
                  );
                }
              }
              currentEventType = "message";
              currentData = "";
            }
          }
        }
      } catch (err: any) {
        if (err.name === "AbortError") {
          log.info("SSE stream aborted");
          return;
        }
        log.error("SSE stream error:", err);
        const errMsg = err.message || "Stream connection failed";
        setError(errMsg);
        setIsStreaming(false);
        onRunFailed(errMsg);
      } finally {
        abortControllerRef.current = null;
      }
    },
    [
      chatId,
      getAuthHeaders,
      onUserMessageCreated,
      onMessageCreated,
      onRunCompleted,
      onRunFailed,
    ],
  );

  return {
    sendMessage,
    streamingTokens,
    streamingThinking,
    isStreaming,
    error,
    cancel,
  };
};
