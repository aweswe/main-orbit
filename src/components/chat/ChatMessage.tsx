import { Message } from '@/types/chat';
import { CodeBlock } from './CodeBlock';
import { Bot, User, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import ReactMarkdown from 'react-markdown';

interface ChatMessageProps {
  message: Message;
}

// Strip code blocks from content since they're displayed separately via CodeBlock component
function stripCodeBlocks(content: string): string {
  // Remove fenced code blocks (```...```)
  return content.replace(/```[\s\S]*?```/g, '').trim();
}

export function ChatMessage({ message }: ChatMessageProps) {
  const isUser = message.role === 'user';
  const isGenerating = message.status === 'generating';

  // For assistant messages with code blocks, strip the code from the markdown content
  const displayContent = !isUser && message.codeBlocks?.length
    ? stripCodeBlocks(message.content)
    : message.content;

  return (
    <div
      className={cn(
        'flex gap-3 animate-slide-up',
        isUser ? 'flex-row-reverse' : 'flex-row'
      )}
    >
      {/* Avatar */}
      <div
        className={cn(
          'flex-shrink-0 w-8 h-8 rounded-lg flex items-center justify-center',
          isUser
            ? 'bg-primary/10 text-primary'
            : 'bg-accent text-accent-foreground'
        )}
      >
        {isUser ? <User className="w-4 h-4" /> : <Bot className="w-4 h-4" />}
      </div>

      {/* Content */}
      <div
        className={cn(
          'flex flex-col gap-2 max-w-[85%]',
          isUser ? 'items-end' : 'items-start'
        )}
      >
        <div
          className={cn(
            'rounded-xl px-4 py-3 max-h-[300px] overflow-y-auto scrollbar-thin',
            isUser
              ? 'bg-primary text-primary-foreground'
              : 'bg-accent text-accent-foreground'
          )}
        >
          {isUser ? (
            <p className="text-sm leading-relaxed whitespace-pre-wrap">
              {message.content}
            </p>
          ) : (
            <div className="text-sm leading-relaxed prose prose-sm prose-invert max-w-none">
              <ReactMarkdown>{displayContent}</ReactMarkdown>
              {isGenerating && (
                <span className="inline-block w-2 h-4 ml-1 bg-current animate-blink" />
              )}
            </div>
          )}
        </div>

        {/* Code Blocks */}
        {message.codeBlocks?.map((block, index) => (
          <CodeBlock key={index} {...block} />
        ))}

        {/* Status indicator for generating */}
        {isGenerating && !message.content && (
          <div className="flex items-center gap-2 text-muted-foreground text-sm">
            <Loader2 className="w-4 h-4 animate-spin" />
            <span>Generating code...</span>
          </div>
        )}
      </div>
    </div>
  );
}
