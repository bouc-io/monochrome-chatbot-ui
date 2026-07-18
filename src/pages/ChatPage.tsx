
import { useState, useEffect, useRef, useCallback } from "react";
import { useParams, useNavigate, useLocation } from "react-router-dom";
import { ChatMessage } from "@/components/ChatMessage";
import { ChatInput } from "@/components/ChatInput";
import { TypingIndicator } from "@/components/TypingIndicator";
import { ChatSidebar } from "@/components/ChatSidebar";
import { ChatHeader } from "@/components/ChatHeader";
import { KeyboardShortcutsHelp } from "@/components/KeyboardShortcutsHelp";
import { ScrollArea } from "@/components/ui/scroll-area";
import { SidebarProvider, SidebarInset } from "@/components/ui/sidebar";
import { getAvailableModels } from "@/lib/models";
import { useChatbotApi, Chat } from "@/lib/chatbotApi";
import { useChatStream } from "@/hooks/useChatStream";
import logger from '@/lib/logger';

const log = logger.child('ChatPage');

interface DisplayMessage {
  text: string;
  isBot: boolean;
  timestamp: Date;
  tokenUsage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
  messageId?: string;
  initialFeedback?: 'positive' | 'negative';
}

const ChatPage = () => {
  const { chatId } = useParams<{ chatId: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const availableModels = getAvailableModels();

  // Get model from localStorage or default to first model
  const getInitialModel = () => {
    const savedModel = localStorage.getItem('selectedModel');
    if (savedModel && availableModels.find(m => m.id === savedModel)) {
      return savedModel;
    }
    return availableModels[0]?.id || "llama3.2";
  };

  const [selectedModel, setSelectedModel] = useState(getInitialModel());
  const [thinkEnabled, setThinkEnabled] = useState<boolean>(() => {
    const saved = localStorage.getItem('chatbot_think_enabled');
    return saved !== null ? saved === 'true' : true;
  });
  const [messages, setMessages] = useState<DisplayMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isChatLoading, setIsChatLoading] = useState(true);
  const [chatTitle, setChatTitle] = useState<string>("");
  const [chats, setChats] = useState<Chat[]>([]);
  const [isLoadingChats, setIsLoadingChats] = useState(true);
  const [isLoadingMoreChats, setIsLoadingMoreChats] = useState(false);
  const [hasMoreChats, setHasMoreChats] = useState(true);
  const [currentChatsPage, setCurrentChatsPage] = useState(1);
  const PAGE_SIZE = 20;
  const [error, setError] = useState<string | null>(null);
  const [autoScroll, setAutoScroll] = useState(true);
  const [highlightedMessageIndex, setHighlightedMessageIndex] = useState<number | null>(null);
  const [showShortcutsHelp, setShowShortcutsHelp] = useState(false);

  const {
    getAllChats,
    getChatById,
    getAllMessagesByChat,
    deleteChat,
    deleteMessage,
    updateChat,
    getAuthHeaders,
  } = useChatbotApi();

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messageIdsRef = useRef<(string | null)[]>([]);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const searchRef = useRef<{ open: () => void }>(null);
  // Stable ref so SSE callbacks can call the latest updateChatTimestamp without stale closure
  const updateChatTimestampRef = useRef<(id: string) => Promise<void>>(() => Promise.resolve());

  // ── SSE streaming hook ────────────────────────────────────────────────────

  const handleUserMessageCreated = useCallback((messageId: string) => {
    messageIdsRef.current.push(messageId);
    log.info('User message saved to database', { messageId });
  }, []);

  const handleMessageCreated = useCallback((
    content: string,
    messageId: string,
    tokenUsage: { prompt_tokens: number; completion_tokens: number; total_tokens: number }
  ) => {
    setMessages(prev => [...prev, {
      text: content,
      isBot: true,
      timestamp: new Date(),
      tokenUsage: tokenUsage.total_tokens > 0 ? tokenUsage : undefined,
      messageId,
    }]);
    messageIdsRef.current.push(messageId);
    log.info('Assistant message received', { messageId, total_tokens: tokenUsage.total_tokens });
  }, []);

  const handleRunCompleted = useCallback(() => {
    setIsLoading(false);
    if (chatId) {
      updateChatTimestampRef.current(chatId);
    }
  }, [chatId]);

  const handleRunFailed = useCallback((errMsg: string) => {
    log.error('SSE run failed:', errMsg);
    setMessages(prev => [...prev, {
      text: "Sorry, I encountered an error while processing your request.",
      isBot: true,
      timestamp: new Date(),
    }]);
    setIsLoading(false);
  }, []);

  const { sendMessage, streamingTokens, streamingThinking, isStreaming, cancel } = useChatStream({
    chatId: chatId ?? null,
    getAuthHeaders,
    onUserMessageCreated: handleUserMessageCreated,
    onMessageCreated: handleMessageCreated,
    onRunCompleted: handleRunCompleted,
    onRunFailed: handleRunFailed,
  });

  // ── Global keyboard shortcuts ─────────────────────────────────────────────

  useEffect(() => {
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      if (e.key === "/" && document.activeElement?.tagName !== "TEXTAREA" && document.activeElement?.tagName !== "INPUT") {
        e.preventDefault();
        inputRef.current?.focus();
      }
      if ((e.ctrlKey || e.metaKey) && e.key === "n") {
        e.preventDefault();
        handleNewChat();
      }
      if ((e.ctrlKey || e.metaKey) && e.key === "f") {
        e.preventDefault();
        searchRef.current?.open();
      }
      if (e.key === "?" && document.activeElement?.tagName !== "TEXTAREA" && document.activeElement?.tagName !== "INPUT") {
        e.preventDefault();
        setShowShortcutsHelp(true);
      }
    };

    window.addEventListener("keydown", handleGlobalKeyDown);
    return () => window.removeEventListener("keydown", handleGlobalKeyDown);
  }, []);

  // Save selected model to localStorage whenever it changes
  useEffect(() => {
    localStorage.setItem('selectedModel', selectedModel);
  }, [selectedModel]);

  const scrollToBottom = () => {
    if (autoScroll) {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, isLoading, autoScroll, streamingTokens]);

  // ── Chat data loading ─────────────────────────────────────────────────────

  const loadChats = useCallback(async () => {
    log.info('Loading chats...');
    try {
      const { chats: fetchedChats, pagination } = await getAllChats({
        page: 1,
        limit: PAGE_SIZE,
        sort: 'updated_at',
        order: 'desc',
      });
      setChats(fetchedChats);
      setCurrentChatsPage(1);
      setHasMoreChats(pagination.page < pagination.total_pages);
    } catch (error) {
      log.error('Failed to load chats:', error);
      setChats([]);
      setHasMoreChats(false);
    } finally {
      setIsLoadingChats(false);
    }
  }, [getAllChats]);

  const loadMoreChats = useCallback(async () => {
    if (isLoadingMoreChats || !hasMoreChats) return;
    setIsLoadingMoreChats(true);
    try {
      const nextPage = currentChatsPage + 1;
      const { chats: fetchedChats, pagination } = await getAllChats({
        page: nextPage,
        limit: PAGE_SIZE,
        sort: 'updated_at',
        order: 'desc',
      });
      setChats(prev => [...prev, ...fetchedChats]);
      setCurrentChatsPage(nextPage);
      setHasMoreChats(pagination.page < pagination.total_pages);
    } catch (error) {
      log.error('Failed to load more chats:', error);
    } finally {
      setIsLoadingMoreChats(false);
    }
  }, [getAllChats, currentChatsPage, hasMoreChats, isLoadingMoreChats]);

  const updateChatTimestamp = useCallback(async (chatIdStr: string) => {
    try {
      const currentChat = chats.find(chat => chat.id === chatIdStr);
      if (!currentChat) return;

      const updatedChat = await updateChat(chatIdStr, {
        title: currentChat.title,
        summary: currentChat.summary
      });

      setChats(prevChats => {
        const updatedChats = prevChats.map(chat =>
          chat.id === chatIdStr ? updatedChat : chat
        );
        return updatedChats.sort((a, b) =>
          new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
        );
      });

      log.info(`Chat ${chatIdStr} timestamp updated`);
    } catch (error) {
      log.error(`Failed to update chat ${chatIdStr} timestamp:`, error);
    }
  }, [chats, updateChat]);

  // Keep the ref in sync with the latest updateChatTimestamp callback
  useEffect(() => {
    updateChatTimestampRef.current = updateChatTimestamp;
  }, [updateChatTimestamp]);

  const loadChat = useCallback(async (id: string) => {
    if (!id) return;

    setIsChatLoading(true);
    setError(null);

    try {
      log.info(`Loading chat ${id}...`);

      const chat = await getChatById(id);
      setChatTitle(chat.title || "Untitled Chat");

      const chatMessages = await getAllMessagesByChat(id);

      const sortedMessages = chatMessages.sort((a, b) =>
        new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
      );

      const displayMessages: DisplayMessage[] = sortedMessages.map(msg => ({
        text: msg.content,
        isBot: msg.role === 'assistant',
        timestamp: new Date(msg.createdAt),
        tokenUsage: msg.role === 'assistant' && msg.totalTokens
          ? { prompt_tokens: msg.promptTokens ?? 0, completion_tokens: msg.completionTokens ?? 0, total_tokens: msg.totalTokens }
          : undefined,
        messageId: msg.id,
        initialFeedback: msg.feedback?.rating === 'positive' || msg.feedback?.rating === 'negative'
          ? (msg.feedback.rating as 'positive' | 'negative')
          : undefined,
      }));

      messageIdsRef.current = sortedMessages.map(msg => msg.id);

      setMessages(displayMessages);
      log.info(`Chat ${id} loaded with ${displayMessages.length} messages`);

    } catch (error) {
      log.error('Failed to load chat:', error);
      setError('Failed to load chat. Please try again.');
      setChatTitle("Error Loading Chat");
      setMessages([]);
    } finally {
      setIsChatLoading(false);
    }
  }, [getChatById, getAllMessagesByChat]);

  useEffect(() => {
    loadChats();
  }, [loadChats]);

  useEffect(() => {
    if (chatId) {
      loadChat(chatId);
    } else {
      setIsChatLoading(false);
    }
  }, [chatId, loadChat]);

  // Handle initial message from navigation state - only run once per navigation
  useEffect(() => {
    const state = location.state as { initialMessage?: string; selectedModel?: string } | null;
    if (state?.initialMessage && chatId) {
      log.info('Processing initial message from navigation state');
      if (state.selectedModel) {
        setSelectedModel(state.selectedModel);
      }
      handleSendMessage(state.initialMessage);
      navigate(location.pathname, { replace: true });
    }
  }, [chatId]); // Only depend on chatId to prevent infinite loops

  // ── Chat actions ──────────────────────────────────────────────────────────

  const handleDeleteChat = useCallback(async (chatIdToDelete: string) => {
    log.info(`Deleting chat with ID: ${chatIdToDelete}`);

    try {
      await deleteChat(chatIdToDelete);
      setChats(prevChats => prevChats.filter(chat => chat.id !== chatIdToDelete));

      if (chatId === chatIdToDelete) {
        navigate('/');
      }

      log.info(`Chat ${chatIdToDelete} deleted successfully`);
    } catch (error) {
      log.error(`Failed to delete chat ${chatIdToDelete}:`, error);
    }
  }, [deleteChat, chatId, navigate]);

  const handleThinkChange = (enabled: boolean) => {
    setThinkEnabled(enabled);
    localStorage.setItem('chatbot_think_enabled', String(enabled));
  };

  const handleSendMessage = async (message: string) => {
    if (!chatId) return;

    // Optimistically show the user message in the UI
    setMessages(prev => [...prev, {
      text: message,
      isBot: false,
      timestamp: new Date()
    }]);
    setIsLoading(true);

    // Triggers POST /v1/chats/:chatId/stream and reads back the SSE response.
    // The server saves user + assistant messages to DB.
    // Callbacks update local state as events arrive.
    await sendMessage(message, selectedModel, thinkEnabled);
  };

  const handleStopGeneration = () => {
    cancel();
    // Commit whatever partial content was streaming as a truncated message
    if (streamingTokens) {
      setMessages(prev => [...prev, {
        text: streamingTokens + "\n\n*[Generation stopped]*",
        isBot: true,
        timestamp: new Date()
      }]);
    }
    setIsLoading(false);
  };

  const handleNewChat = () => {
    navigate('/');
  };

  const handleModelChange = (modelId: string) => {
    setSelectedModel(modelId);
    log.info(`Model changed to: ${modelId}`);
  };

  const handleResubmit = async (messageIndex: number) => {
    if (!chatId) return;

    const messageToResubmit = messages[messageIndex];
    if (!messageToResubmit || messageToResubmit.isBot) return;

    log.info(`Resubmitting message at index ${messageIndex}`);

    // Delete orphaned messages from DB: the user message at messageIndex and all messages
    // after it. The server will save a fresh copy of the user message via sendMessage below.
    const idsToDelete = messageIdsRef.current.slice(messageIndex).filter(Boolean) as string[];
    await Promise.all(
      idsToDelete.map(id => deleteMessage(chatId, id).catch(err =>
        log.error(`Failed to delete message ${id} during resubmit:`, err)
      ))
    );

    // Truncate local state to everything before the resubmit point
    setMessages(messages.slice(0, messageIndex));
    messageIdsRef.current = messageIdsRef.current.slice(0, messageIndex);

    setIsLoading(true);

    // Re-show the user message optimistically
    setMessages(prev => [...prev, {
      text: messageToResubmit.text,
      isBot: false,
      timestamp: new Date()
    }]);

    await sendMessage(messageToResubmit.text, selectedModel, thinkEnabled);
  };

  // ── Render ────────────────────────────────────────────────────────────────

  if (error) {
    return (
      <SidebarProvider>
        <div className="min-h-screen flex w-full bg-white">
          <ChatSidebar
            chats={chats}
            onNewChat={handleNewChat}
            selectedModel={selectedModel}
            onModelChange={handleModelChange}
            isLoading={isLoadingChats}
            onDeleteChat={handleDeleteChat}
          />
          <SidebarInset className="flex flex-col h-screen">
            <div className="sticky top-0 z-10 bg-white border-b border-border">
              <ChatHeader onNewChat={handleNewChat} />
            </div>
            <div className="flex-1 flex items-center justify-center">
              <div className="text-center">
                <h2 className="text-xl font-semibold text-red-600 mb-2">Error</h2>
                <p className="text-gray-600">{error}</p>
              </div>
            </div>
          </SidebarInset>
        </div>
      </SidebarProvider>
    );
  }

  return (
    <SidebarProvider>
      <div className="min-h-screen flex w-full bg-white">
        <ChatSidebar
          chats={chats}
          onNewChat={handleNewChat}
          selectedModel={selectedModel}
          onModelChange={handleModelChange}
          isLoading={isLoadingChats}
          onDeleteChat={handleDeleteChat}
          hasMore={hasMoreChats}
          isLoadingMore={isLoadingMoreChats}
          onLoadMore={loadMoreChats}
        />
        <SidebarInset className="flex flex-col h-screen">
          {/* Fixed Header */}
          <div className="sticky top-0 z-10 bg-white">
            <ChatHeader
              ref={searchRef}
              onNewChat={handleNewChat}
              autoScroll={autoScroll}
              onAutoScrollToggle={() => setAutoScroll(!autoScroll)}
              messages={messages}
              onHighlightMessage={setHighlightedMessageIndex}
            />
            <div className="flex items-center justify-between p-4 border-b border-border bg-background">
              <h1 className="text-lg font-semibold text-foreground">
                {isChatLoading ? "Loading..." : chatTitle}
              </h1>
            </div>
          </div>

          {/* Scrollable Messages Area */}
          <div className="flex-1 overflow-hidden">
            <ScrollArea className="h-full">
              <div className="max-w-4xl mx-auto w-full px-4 py-4">
                {isChatLoading ? (
                  <div className="flex items-center justify-center py-8">
                    <TypingIndicator />
                  </div>
                ) : (
                  <div className="flex flex-col space-y-4">
                    {messages.map((message, index) => (
                      <div
                        key={index}
                        className={`transition-all duration-300 ${highlightedMessageIndex === index ? 'ring-2 ring-primary rounded-lg' : ''}`}
                        ref={highlightedMessageIndex === index ? (el) => el?.scrollIntoView({ behavior: 'smooth', block: 'center' }) : undefined}
                      >
                        <ChatMessage
                          message={message.text}
                          isBot={message.isBot}
                          timestamp={message.timestamp}
                          onResubmit={!message.isBot ? () => handleResubmit(index) : undefined}
                          tokenUsage={message.tokenUsage}
                          messageId={message.messageId}
                          chatId={chatId}
                          initialFeedback={message.initialFeedback}
                        />
                      </div>
                    ))}
                    {isLoading && (
                      <div className="flex w-full justify-start">
                        <div className="max-w-[80%] rounded-2xl px-4 py-3 shadow-sm bg-gray-100 dark:bg-gray-700">
                          {/* Typing indicator */}
                          <div className="flex items-center gap-2 mb-2">
                            <div className="flex space-x-1">
                              {[0, 1, 2].map((i) => (
                                <div
                                  key={i}
                                  className="w-2 h-2 bg-gray-400 dark:bg-gray-500 rounded-full animate-bounce"
                                  style={{
                                    animationDelay: `${i * 0.15}s`,
                                    animationDuration: "0.6s",
                                  }}
                                />
                              ))}
                            </div>
                            <span className="text-xs text-muted-foreground ml-1">AI is thinking...</span>
                          </div>
                          {/* Streaming content */}
                          {streamingTokens && (
                            <div className="prose prose-sm dark:prose-invert max-w-none text-sm leading-relaxed text-gray-900 dark:text-white">
                              {streamingThinking && (
                                <div className="mb-2 text-xs text-muted-foreground italic">
                                  Reasoning: {streamingThinking.slice(0, 100)}...
                                </div>
                              )}
                              {streamingTokens}
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                    <div ref={messagesEndRef} />
                  </div>
                )}
              </div>
            </ScrollArea>
          </div>

          {/* Fixed Input Area */}
          <div className="sticky bottom-0 z-10 bg-white">
            <div className="max-w-4xl mx-auto w-full px-4 py-4">
              <ChatInput
                onSend={handleSendMessage}
                disabled={isLoading || isChatLoading}
                inputRef={inputRef}
                isStreaming={isLoading}
                onStop={handleStopGeneration}
                thinkEnabled={thinkEnabled}
                onThinkChange={handleThinkChange}
              />
            </div>
          </div>
        </SidebarInset>
      </div>

      <KeyboardShortcutsHelp
        isOpen={showShortcutsHelp}
        onClose={() => setShowShortcutsHelp(false)}
      />
    </SidebarProvider>
  );
};

export default ChatPage;
