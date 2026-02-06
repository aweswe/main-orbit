import { useState, useRef, useEffect, KeyboardEvent } from 'react';
import { Send, Sparkles } from 'lucide-react';
import { cn } from '@/lib/utils';

interface ChatInputProps {
  onSend: (message: string) => void;
  disabled?: boolean;
  placeholder?: string;
}

export function ChatInput({ onSend, disabled, placeholder }: ChatInputProps) {
  const [value, setValue] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Auto-resize textarea
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 200)}px`;
    }
  }, [value]);

  const handleSend = () => {
    if (value.trim() && !disabled) {
      onSend(value.trim());
      setValue('');
    }
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="relative">
      <div
        className={cn(
          'flex items-end gap-2 p-3 rounded-xl border transition-all duration-200',
          'bg-accent/50 border-border',
          'focus-within:border-primary/50 focus-within:glow-border',
          disabled && 'opacity-50'
        )}
      >
        <div className="flex-shrink-0 p-1.5 text-primary">
          <Sparkles className="w-5 h-5" />
        </div>

        <textarea
          ref={textareaRef}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder || 'Describe what you want to build...'}
          disabled={disabled}
          rows={1}
          className={cn(
            'flex-1 bg-transparent resize-none outline-none',
            'text-foreground placeholder:text-muted-foreground',
            'text-sm leading-relaxed scrollbar-thin'
          )}
        />

        <button
          onClick={handleSend}
          disabled={disabled || !value.trim()}
          className={cn(
            'flex-shrink-0 p-2 rounded-lg transition-all duration-200',
            'bg-primary text-primary-foreground',
            'hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed',
            value.trim() && !disabled && 'glow-primary'
          )}
        >
          <Send className="w-4 h-4" />
        </button>
      </div>

      <p className="mt-2 text-center text-xs text-muted-foreground">
        Press <kbd className="px-1.5 py-0.5 rounded bg-accent font-mono">Enter</kbd> to send,{' '}
        <kbd className="px-1.5 py-0.5 rounded bg-accent font-mono">Shift+Enter</kbd> for new line
      </p>
    </div>
  );
}
