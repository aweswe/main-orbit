import { useRef, useEffect } from 'react';
import { Message } from '@/types/chat';
import { ChatMessage } from './ChatMessage';
import { ChatInput } from './ChatInput';
import { Sparkles, Zap, Layers, RefreshCw } from 'lucide-react';

interface ChatPanelProps {
  messages: Message[];
  onSendMessage: (content: string) => void;
  isGenerating: boolean;
}

export function ChatPanel({ messages, onSendMessage, isGenerating }: ChatPanelProps) {
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSuggestionClick = (suggestion: string) => {
    if (!isGenerating) {
      onSendMessage(suggestion);
    }
  };

  return (
    <div className="flex flex-col h-full bg-background">
      {/* Header */}
      <div className="flex-shrink-0 px-6 py-4 border-b border-border">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-primary/10 glow-primary">
            <Sparkles className="w-5 h-5 text-primary" />
          </div>
          <div>
            <h1 className="font-semibold text-foreground">CodeForge AI</h1>
            <p className="text-xs text-muted-foreground">Powered by Lovable AI</p>
          </div>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-6 space-y-6 scrollbar-thin">
        {messages.length === 0 ? (
          <EmptyState onSuggestionClick={handleSuggestionClick} />
        ) : (
          messages.map((message) => (
            <ChatMessage key={message.id} message={message} />
          ))
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="flex-shrink-0 p-4 border-t border-border bg-surface-elevated">
        <ChatInput onSend={onSendMessage} disabled={isGenerating} />
      </div>
    </div>
  );
}

interface EmptyStateProps {
  onSuggestionClick: (suggestion: string) => void;
}

function EmptyState({ onSuggestionClick }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center h-full text-center py-12">
      <div className="p-4 rounded-2xl bg-primary/10 mb-6 glow-primary">
        <Sparkles className="w-10 h-10 text-primary" />
      </div>
      <h2 className="text-xl font-semibold text-foreground mb-2">
        What would you like to build?
      </h2>
      <p className="text-muted-foreground max-w-md mb-8">
        Describe your idea and I'll generate working React code. 
        The AI will auto-fix errors up to 3 times.
      </p>

      {/* Feature badges */}
      <div className="flex gap-3 mb-8">
        <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-accent text-xs text-muted-foreground">
          <Zap className="w-3 h-3" />
          <span>Fast Generation</span>
        </div>
        <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-accent text-xs text-muted-foreground">
          <RefreshCw className="w-3 h-3" />
          <span>Auto-Fix Errors</span>
        </div>
        <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-accent text-xs text-muted-foreground">
          <Layers className="w-3 h-3" />
          <span>Live Preview</span>
        </div>
      </div>

      <div className="flex flex-wrap gap-2 justify-center max-w-lg">
        {SUGGESTIONS.map((suggestion, i) => (
          <button
            key={i}
            onClick={() => onSuggestionClick(suggestion.prompt)}
            className="px-3 py-2 text-sm rounded-lg bg-accent hover:bg-accent/80 hover:glow-border text-foreground transition-all"
          >
            {suggestion.label}
          </button>
        ))}
      </div>
    </div>
  );
}

const SUGGESTIONS = [
  { label: '🎨 Landing page with hero', prompt: 'Create a modern landing page with a hero section, gradient background, feature cards, and a call-to-action button' },
  { label: '✅ Todo app', prompt: 'Build a todo app with the ability to add, complete, and delete tasks. Include a nice UI with animations.' },
  { label: '📊 Dashboard with charts', prompt: 'Create a dashboard with stat cards showing metrics, a line chart, and a recent activity list' },
  { label: '💳 Pricing cards', prompt: 'Design three pricing tier cards (Basic, Pro, Enterprise) with features list and highlighted recommended tier' },
  { label: '🔐 Login form', prompt: 'Create a login form with email and password fields, validation states, and a beautiful dark design' },
  { label: '🎯 Kanban board', prompt: 'Build a Kanban board with three columns (To Do, In Progress, Done) and draggable task cards' },
];
