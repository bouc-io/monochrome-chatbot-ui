import { useContext, useCallback } from "react";
import { AuthContext } from "@/auth/authcontext";
import axios from "axios";
import logger from "@/lib/logger";

const log = logger.child("ChatbotAPI");

// Get environment variables from window.ENV (injected at runtime)
declare global {
  interface Window {
    ENV: {
      VITE_OLLAMA_API_URL: string;
      VITE_SSO_SERVER_URL: string;
      VITE_OAUTH_REALM: string;
      VITE_OAUTH_CLIENT_ID: string;
      VITE_API_URL: string;
    };
  }
}

// Function to get environment variable with fallback to import.meta.env
const getEnvVar = (key: keyof Window["ENV"]): string => {
  return window.ENV?.[key] || import.meta.env[key] || "";
};

// Create a dedicated axios instance for chatbot API
const chatbotAxios = axios.create({
  baseURL: getEnvVar("VITE_API_URL"),
  headers: {
    "Content-Type": "application/json",
  },
});

// ============= API Response Interfaces =============

// Chat response from API (v1 format)
export interface ChatResponse {
  id: string;
  title: string;
  summary: string | null;
  user_id: string;
  model_id: string;
  created_at: string;
  updated_at: string;
  metadata?: Record<string, unknown>;
}

// Message response from API (v1 format)
export interface MessageResponse {
  id: string;
  message_group_id: string;
  role: string;
  content: string;
  chat_id: string;
  user_id: string;
  model_id: string | null;
  created_at: string;
  updated_at: string;
  metadata?: Record<string, unknown>;
  prompt_tokens?: number | null;
  completion_tokens?: number | null;
  total_tokens?: number | null;
  feedback?: { rating: string; comment?: string | null } | null;
}

// Paginated response wrapper
export interface PaginatedResponse<T> {
  data: T[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    total_pages: number;
  };
}

// ============= Internal State Interfaces =============

// Internal chat representation for state management
export interface Chat {
  id: string;
  title: string;
  summary: string;
  userId: string;
  modelId: string;
  createdAt: Date;
  updatedAt: Date;
  metadata?: Record<string, unknown>;
}

// Internal message representation for state management
export interface Message {
  id: string;
  messageGroupId: string;
  role: string;
  content: string;
  chatId: string;
  userId: string;
  modelId: string | null;
  createdAt: Date;
  updatedAt: Date;
  metadata?: Record<string, unknown>;
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  feedback?: { rating: string; comment?: string | null } | null;
}

// ============= Request Body Interfaces =============

// Interface for update chat request body (PATCH)
export interface UpdateChatRequest {
  title?: string;
  summary?: string;
}

// Interface for create message request body
export interface CreateMessageRequest {
  role: string;
  content: string;
  metadata?: {
    model_id?: string;
    [key: string]: unknown;
  };
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
}

// Interface for create chat request body
export interface CreateChatRequest {
  title: string;
  model_id: string;
  summary?: string;
}

// ============= Query Parameters =============

export interface ListChatsParams {
  page?: number;
  limit?: number;
  sort?: string;
  order?: "asc" | "desc";
}

export interface ListMessagesParams {
  page?: number;
  limit?: number;
  before?: string;
  after?: string;
}

// ============= Helper Functions =============

// Convert API chat response to internal Chat format
const mapChatResponse = (response: ChatResponse): Chat => ({
  id: response.id,
  title: response.title,
  summary: response.summary || "",
  userId: response.user_id,
  modelId: response.model_id,
  createdAt: new Date(response.created_at),
  updatedAt: new Date(response.updated_at),
  metadata: response.metadata,
});

// Convert API message response to internal Message format
const mapMessageResponse = (response: MessageResponse): Message => ({
  id: response.id,
  messageGroupId: response.message_group_id,
  role: response.role,
  content: response.content,
  chatId: response.chat_id,
  userId: response.user_id,
  modelId: response.model_id,
  createdAt: new Date(response.created_at),
  updatedAt: new Date(response.updated_at),
  metadata: response.metadata,
  promptTokens: response.prompt_tokens ?? undefined,
  completionTokens: response.completion_tokens ?? undefined,
  totalTokens: response.total_tokens ?? undefined,
  feedback: response.feedback ?? null,
});

// ============= Main Hook =============

export const useChatbotApi = () => {
  const authContext = useContext(AuthContext);

  if (!authContext) {
    throw new Error("useChatbotApi must be used within AuthProvider");
  }

  // Helper to get auth headers
  const getAuthHeaders = useCallback(() => {
    const token = authContext.authTokens?.access;
    if (!token) {
      throw new Error("No authentication token available");
    }
    return {
      Authorization: `Bearer ${token}`,
      "x-auth-request-access-token": token,
    };
  }, [authContext.authTokens?.access]);

  // Retry helper with exponential backoff
  const withRetry = useCallback(
    async <T>(
      operation: () => Promise<T>,
      operationName: string,
      maxRetries: number = 3,
    ): Promise<T> => {
      let retryCount = 0;

      while (retryCount < maxRetries) {
        try {
          return await operation();
        } catch (error) {
          retryCount++;
          log.error(
            `Error in ${operationName} (attempt ${retryCount}/${maxRetries}):`,
            error,
          );

          if (retryCount >= maxRetries) {
            log.error(`Max retries reached for ${operationName}`);
            throw error;
          }

          // Wait before retrying (exponential backoff)
          await new Promise((resolve) =>
            setTimeout(resolve, 1000 * retryCount),
          );
        }
      }

      throw new Error(`Failed ${operationName} after maximum retries`);
    },
    [],
  );

  // ============= Chat Operations =============

  const getAllChats = useCallback(
    async (
      params?: ListChatsParams,
    ): Promise<{
      chats: Chat[];
      pagination: PaginatedResponse<ChatResponse>["pagination"];
    }> => {
      log.info("Retrieving all chats for user...", params);

      return withRetry(async () => {
        const headers = getAuthHeaders();

        const response = await chatbotAxios.get<
          PaginatedResponse<ChatResponse>
        >("/v1/chats", {
          headers,
          params: {
            page: params?.page || 1,
            limit: params?.limit || 20,
            sort: params?.sort || "updated_at",
            order: params?.order || "desc",
          },
        });

        log.debug("Chats retrieved successfully:", {
          count: response.data.data.length,
          pagination: response.data.pagination,
        });

        return {
          chats: response.data.data.map(mapChatResponse),
          pagination: response.data.pagination,
        };
      }, "getAllChats");
    },
    [getAuthHeaders, withRetry],
  );

  const getChatById = useCallback(
    async (chatId: string): Promise<Chat> => {
      log.info("Retrieving chat:", chatId);

      return withRetry(async () => {
        const headers = getAuthHeaders();

        const response = await chatbotAxios.get<ChatResponse>(
          `/v1/chats/${chatId}`,
          {
            headers,
          },
        );

        log.debug("Chat retrieved successfully:", {
          chatId,
          data: response.data,
        });

        return mapChatResponse(response.data);
      }, "getChatById");
    },
    [getAuthHeaders, withRetry],
  );

  const createChat = useCallback(
    async (chatData: CreateChatRequest): Promise<Chat> => {
      log.info("Creating new chat:", chatData);

      return withRetry(async () => {
        const headers = getAuthHeaders();

        const response = await chatbotAxios.post<ChatResponse>(
          "/v1/chats",
          chatData,
          {
            headers,
          },
        );

        log.debug("Chat created successfully:", {
          data: response.data,
        });

        return mapChatResponse(response.data);
      }, "createChat");
    },
    [getAuthHeaders, withRetry],
  );

  const updateChat = useCallback(
    async (chatId: string, updateData: UpdateChatRequest): Promise<Chat> => {
      log.info("Updating chat:", chatId, updateData);

      return withRetry(async () => {
        const headers = getAuthHeaders();

        // Use PATCH instead of PUT per new API design
        const response = await chatbotAxios.patch<ChatResponse>(
          `/v1/chats/${chatId}`,
          updateData,
          {
            headers,
          },
        );

        log.debug("Chat updated successfully:", {
          chatId,
          updatedData: response.data,
        });

        return mapChatResponse(response.data);
      }, "updateChat");
    },
    [getAuthHeaders, withRetry],
  );

  const deleteChat = useCallback(
    async (chatId: string): Promise<void> => {
      log.info("Deleting chat:", chatId);

      return withRetry(async () => {
        const headers = getAuthHeaders();

        await chatbotAxios.delete(`/v1/chats/${chatId}`, {
          headers,
        });

        log.debug("Chat deleted successfully:", { chatId });
      }, "deleteChat");
    },
    [getAuthHeaders, withRetry],
  );

  // ============= Message Operations =============

  const getAllMessagesByChat = useCallback(
    async (chatId: string, params?: ListMessagesParams): Promise<Message[]> => {
      log.info("Retrieving all messages for chat:", chatId);

      return withRetry(async () => {
        const headers = getAuthHeaders();

        const response = await chatbotAxios.get<
          PaginatedResponse<MessageResponse>
        >(`/v1/chats/${chatId}/messages`, {
          headers,
          params: {
            page: params?.page || 1,
            limit: params?.limit || 1000,
            before: params?.before,
            after: params?.after,
          },
        });

        log.debug("Messages retrieved successfully:", {
          chatId,
          count: response.data.data.length,
          pagination: response.data.pagination,
        });

        return response.data.data.map(mapMessageResponse);
      }, "getAllMessagesByChat");
    },
    [getAuthHeaders, withRetry],
  );

  const getMessageById = useCallback(
    async (chatId: string, messageId: string): Promise<Message> => {
      log.info("Retrieving message:", messageId, "from chat:", chatId);

      return withRetry(async () => {
        const headers = getAuthHeaders();

        const response = await chatbotAxios.get<MessageResponse>(
          `/v1/chats/${chatId}/messages/${messageId}`,
          {
            headers,
          },
        );

        log.debug("Message retrieved successfully:", {
          chatId,
          messageId,
          data: response.data,
        });

        return mapMessageResponse(response.data);
      }, "getMessageById");
    },
    [getAuthHeaders, withRetry],
  );

  const createMessage = useCallback(
    async (
      chatId: string,
      messageData: CreateMessageRequest,
    ): Promise<Message> => {
      log.info("Creating message in chat:", chatId);

      return withRetry(async () => {
        const headers = getAuthHeaders();

        const response = await chatbotAxios.post<MessageResponse>(
          `/v1/chats/${chatId}/messages`,
          messageData,
          {
            headers,
          },
        );

        log.debug("Message created successfully:", {
          chatId,
          data: response.data,
        });

        return mapMessageResponse(response.data);
      }, "createMessage");
    },
    [getAuthHeaders, withRetry],
  );

  const updateMessage = useCallback(
    async (
      chatId: string,
      messageId: string,
      content: string,
    ): Promise<Message> => {
      log.info("Updating message:", messageId, "in chat:", chatId);

      return withRetry(async () => {
        const headers = getAuthHeaders();

        const response = await chatbotAxios.patch<MessageResponse>(
          `/v1/chats/${chatId}/messages/${messageId}`,
          {
            content,
          },
          {
            headers,
          },
        );

        log.debug("Message updated successfully:", {
          chatId,
          messageId,
          data: response.data,
        });

        return mapMessageResponse(response.data);
      }, "updateMessage");
    },
    [getAuthHeaders, withRetry],
  );

  const deleteMessage = useCallback(
    async (chatId: string, messageId: string): Promise<void> => {
      log.info("Deleting message:", messageId, "from chat:", chatId);

      return withRetry(async () => {
        const headers = getAuthHeaders();

        await chatbotAxios.delete(`/v1/chats/${chatId}/messages/${messageId}`, {
          headers,
        });

        log.debug("Message deleted successfully:", { chatId, messageId });
      }, "deleteMessage");
    },
    [getAuthHeaders, withRetry],
  );

  const submitMessageFeedback = useCallback(
    async (
      chatId: string,
      messageId: string,
      rating: "positive" | "negative",
      comment?: string,
    ): Promise<void> => {
      log.info(
        "Submitting feedback for message:",
        messageId,
        "in chat:",
        chatId,
        { rating },
      );
      const headers = getAuthHeaders();
      await chatbotAxios.post(
        `/v1/chats/${chatId}/messages/${messageId}/feedback`,
        { rating, comment },
        { headers },
      );
      log.debug("Feedback submitted successfully:", {
        chatId,
        messageId,
        rating,
      });
    },
    [getAuthHeaders],
  );

  return {
    // Auth helpers
    getAuthHeaders,
    // Chat operations
    getAllChats,
    getChatById,
    createChat,
    updateChat,
    deleteChat,
    // Message operations
    getAllMessagesByChat,
    getMessageById,
    createMessage,
    updateMessage,
    deleteMessage,
    submitMessageFeedback,
  };
};

export default chatbotAxios;
