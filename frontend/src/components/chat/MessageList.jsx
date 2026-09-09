import { useEffect, useState, useCallback, useRef } from 'react';
import { Virtuoso } from 'react-virtuoso';
import Message from './Message';
import { Loader2 } from 'lucide-react';

export default function MessageList({ messages, currentUser, onLoadMore, hasMore }) {
  const virtuosoRef = useRef(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [firstItemIndex, setFirstItemIndex] = useState(10000); // Sanal liste has index hilesi

  // Messages eklendiğinde (eski mesajlar yüklendiğinde) index'i güncelle
  useEffect(() => {
    if (loadingMore) {
      // Eski mesajlar yüklendiğinde scroll pozisyonunu korumak has index kaydır
      // Bu kısım Virtuoso'nun otomatik yaptığı bir şeydir ama manuel tetikleme gerekebilir
      setLoadingMore(false);
    }
  }, [messages]);

  const handleStartReached = useCallback(() => {
    if (hasMore && !loadingMore) {
      setLoadingMore(true);
      onLoadMore();
      return false; 
    }
  }, [hasMore, loadingMore, onLoadMore]);

  // Messagesı işle and grupla
  const getGroupedMessages = useCallback(() => {
    return messages.map((message, index) => {
      if (message.type === 'system') return { ...message, grouped: false };
      
      const prevMessage = messages[index - 1];
      const shouldGroup =
        prevMessage &&
        prevMessage.type !== 'system' &&
        prevMessage.username === message.username &&
        message.timestamp - prevMessage.timestamp < 5 * 60 * 1000;

      return { ...message, grouped: shouldGroup };
    });
  }, [messages]);

  const groupedMessages = getGroupedMessages();

  // Scroll'u en aşağıya at (New message geldiğinde)
  useEffect(() => {
    if (virtuosoRef.current) {
        // Otomatik takip zaten açık (followOutput)
    }
  }, [messages.length]);

  return (
    <div className="flex-1 px-2 py-4 h-full">
      {groupedMessages.length === 0 ? (
        <div className="flex items-center justify-center h-full text-gray-500">
          <p>No messages yet. Start the conversation!</p>
        </div>
      ) : (
        <Virtuoso
          ref={virtuosoRef}
          style={{ height: '100%' }}
          data={groupedMessages}
          startReached={handleStartReached}
          firstItemIndex={Math.max(0, firstItemIndex - groupedMessages.length)}
          initialTopMostItemIndex={groupedMessages.length - 1}
          followOutput={'auto'} // New message gelince aşağı kaydır
          components={{
            Header: () => loadingMore && (
              <div className="flex justify-center py-2">
                <Loader2 className="w-5 h-5 animate-spin text-gray-400" />
              </div>
            )
          }}
          itemContent={(index, message) => (
            <div className="pb-0.5">
              <Message
                key={message.id}
                message={message}
                isOwn={message.username === currentUser.username}
                userId={currentUser.id}
                grouped={message.grouped}
              />
            </div>
          )}
        />
      )}
    </div>
  );
}