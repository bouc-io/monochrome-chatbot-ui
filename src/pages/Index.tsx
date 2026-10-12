import { useState, useEffect, useRef, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { ChatInput } from "@/components/ChatInput";
import { WelcomeScreen } from "@/components/WelcomeScreen";
import { ChatSidebar } from "@/components/ChatSidebar";
import { ChatHeader } from "@/components/ChatHeader";
import { SidebarProvider, SidebarInset } from "@/components/ui/sidebar";
import { getDefaultModelId } from "@/lib/models";
import { useChatbotApi, Chat } from "@/lib/chatbotApi";
import { useAuth } from "@/auth/authcontext";
import logger from "@/lib/logger";

const log = logger.child("Index");

const Index = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const selectedModel = getDefaultModelId();
  const [thinkEnabled, setThinkEnabled] = useState<boolean>(() => {
    const saved = localStorage.getItem("chatbot_think_enabled");
    return saved !== null ? saved === "true" : true;
  });

  const handleThinkChange = (enabled: boolean) => {
    setThinkEnabled(enabled);
    localStorage.setItem("chatbot_think_enabled", String(enabled));
  };

  const [chats, setChats] = useState<Chat[]>([]);
  const [isLoadingChats, setIsLoadingChats] = useState(true);
  const [isLoadingMoreChats, setIsLoadingMoreChats] = useState(false);
  const [hasMoreChats, setHasMoreChats] = useState(true);
  const [currentChatsPage, setCurrentChatsPage] = useState(1);
  const PAGE_SIZE = 20;
  const { getAllChats, deleteChat, createChat } = useChatbotApi();

  const loadChats = useCallback(async () => {
    log.info("Loading chats...");
    try {
      const { chats: fetchedChats, pagination } = await getAllChats({
        page: 1,
        limit: PAGE_SIZE,
        sort: "updated_at",
        order: "desc",
      });
      setChats(fetchedChats);
      setCurrentChatsPage(1);
      setHasMoreChats(pagination.page < pagination.total_pages);
    } catch (error) {
      log.error("Failed to load chats:", error);
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
        sort: "updated_at",
        order: "desc",
      });
      setChats((prev) => [...prev, ...fetchedChats]);
      setCurrentChatsPage(nextPage);
      setHasMoreChats(pagination.page < pagination.total_pages);
    } catch (error) {
      log.error("Failed to load more chats:", error);
    } finally {
      setIsLoadingMoreChats(false);
    }
  }, [getAllChats, currentChatsPage, hasMoreChats, isLoadingMoreChats]);

  useEffect(() => {
    loadChats();
  }, [loadChats]);

  const handleDeleteChat = useCallback(
    async (chatIdToDelete: string) => {
      log.info(`Deleting chat with ID: ${chatIdToDelete}`);
      try {
        await deleteChat(chatIdToDelete);
        setChats((prevChats) =>
          prevChats.filter((chat) => chat.id !== chatIdToDelete),
        );
        log.info(`Chat ${chatIdToDelete} deleted successfully`);
      } catch (error) {
        log.error(`Failed to delete chat ${chatIdToDelete}:`, error);
      }
    },
    [deleteChat],
  );

  const handleSendMessage = async (message: string) => {
    try {
      const randomNumber = Math.floor(Math.random() * 1000) + 1;
      const newChat = await createChat({
        title: message.slice(0, 50) + (message.length > 50 ? "..." : ""),
        model_id: selectedModel,
        summary: `Chat started: ${message.slice(0, 100)}`,
      });

      log.info("New chat created:", newChat);
      navigate(`/chats/${newChat.id}`, {
        state: { initialMessage: message },
      });
    } catch (error) {
      log.error("Failed to create new chat:", error);
    }
  };

  const handleNewChat = () => {
    // Already on the welcome screen
  };

  return (
    <SidebarProvider>
      <div className="min-h-screen flex w-full bg-background">
        <ChatSidebar
          chats={chats}
          onNewChat={handleNewChat}
          isLoading={isLoadingChats}
          onDeleteChat={handleDeleteChat}
          hasMore={hasMoreChats}
          isLoadingMore={isLoadingMoreChats}
          onLoadMore={loadMoreChats}
        />
        <SidebarInset className="flex flex-col h-screen">
          {/* Fixed Header */}
          <div className="sticky top-0 z-10 bg-background border-b border-border">
            <ChatHeader onNewChat={handleNewChat} />
          </div>

          {/* Welcome Screen */}
          <WelcomeScreen onSuggestionClick={handleSendMessage} />

          {/* Fixed Input Area */}
          <div className="sticky bottom-0 z-10 bg-background">
            <div className="max-w-2xl mx-auto w-full px-4 py-4">
              <ChatInput
                onSend={handleSendMessage}
                disabled={false}
                thinkEnabled={thinkEnabled}
                onThinkChange={handleThinkChange}
              />
            </div>
          </div>
        </SidebarInset>
      </div>
    </SidebarProvider>
  );
};

export default Index;
