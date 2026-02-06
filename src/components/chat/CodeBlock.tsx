import { useState } from 'react';
import { Highlight, themes } from 'prism-react-renderer';
import { Check, Copy, File } from 'lucide-react';
import { cn } from '@/lib/utils';

interface CodeBlockProps {
  code: string;
  language: string;
  filename?: string;
}

export function CodeBlock({ code, language, filename }: CodeBlockProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="w-full rounded-lg overflow-hidden border border-border bg-code-bg">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2 bg-accent/50 border-b border-border">
        <div className="flex items-center gap-2 text-muted-foreground text-sm">
          <File className="w-4 h-4" />
          <span className="font-mono">{filename || language}</span>
        </div>
        <button
          onClick={handleCopy}
          className={cn(
            'p-1.5 rounded-md transition-colors',
            'hover:bg-accent text-muted-foreground hover:text-foreground'
          )}
        >
          {copied ? (
            <Check className="w-4 h-4 text-success" />
          ) : (
            <Copy className="w-4 h-4" />
          )}
        </button>
      </div>

      {/* Code */}
      <Highlight theme={themes.nightOwl} code={code.trim()} language={language}>
        {({ className, style, tokens, getLineProps, getTokenProps }) => (
          <pre
            className={cn(className, 'p-4 overflow-x-auto text-sm scrollbar-thin')}
            style={{ ...style, background: 'transparent' }}
          >
            {tokens.map((line, i) => (
              <div key={i} {...getLineProps({ line })} className="table-row">
                <span className="table-cell pr-4 text-muted-foreground/50 select-none text-right w-8">
                  {i + 1}
                </span>
                <span className="table-cell">
                  {line.map((token, key) => (
                    <span key={key} {...getTokenProps({ token })} />
                  ))}
                </span>
              </div>
            ))}
          </pre>
        )}
      </Highlight>
    </div>
  );
}
