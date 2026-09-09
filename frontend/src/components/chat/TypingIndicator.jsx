export default function TypingIndicator({ users }) {
  if (!users?.length) return <div className="h-5" aria-hidden="true" />;

  const text = users.length === 1
    ? `${users[0]} is typing...`
    : users.length === 2
      ? `${users[0]} and ${users[1]} is typing...`
      : `${users.length} people are typing...`;

  return (
    <div className="flex h-5 items-center gap-2 text-sm text-[#94a3b8]" aria-live="polite">
      <div className="flex gap-1" aria-hidden="true">
        <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-[#94a3b8]" style={{ animationDelay: '0ms' }} />
        <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-[#94a3b8]" style={{ animationDelay: '150ms' }} />
        <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-[#94a3b8]" style={{ animationDelay: '300ms' }} />
      </div>
      <span>{text}</span>
    </div>
  );
}
