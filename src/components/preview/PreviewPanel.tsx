import { useState, useEffect, useRef } from 'react';
import { GenerationState, ProjectFile } from '@/types/chat';
import {
  Monitor,
  Code2,
  Terminal as TerminalIcon,
  Loader2,
  AlertCircle,
  CheckCircle2,
  RefreshCw,
  Maximize2,
  Minimize2,
  Eye,
  FileCode
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Terminal } from '@/components/terminal/Terminal';
import { useWebContainer } from '@/contexts/WebContainerContext';

type ViewMode = 'preview' | 'terminal';

interface PreviewPanelProps {
  files: ProjectFile[];
  generationState: GenerationState;
  activeFilePath: string | null;
  onRetry?: () => void;
  onError?: (error: string) => void;
  isEngineReady: boolean;
}

export function PreviewPanel({
  files,
  generationState,
  activeFilePath,
  onRetry,
  onError,
  isEngineReady
}: PreviewPanelProps) {
  const [viewMode, setViewMode] = useState<ViewMode>('preview');
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const { webcontainer, isBooting } = useWebContainer();

  // Listen for server-ready events from WebContainer
  useEffect(() => {
    if (!webcontainer) return;

    const unsubscribe = webcontainer.on('server-ready', (port, url) => {
      console.log('Server ready at:', url);
      setPreviewUrl(url);
      // Auto-switch to preview when server is ready
      setViewMode('preview');
    });

    return () => {
      // Unsubscribe not directly exposed by API types usually, but cleanup if possible
      // Ideally we keep the listen active
    };
  }, [webcontainer]);


  return (
    <div
      className={cn(
        "flex flex-col h-full w-full bg-slate-950 transition-all duration-300",
        isFullscreen && "fixed inset-0 z-50 border-0"
      )}
    >
      {/* Header Toolbar */}
      <div className="flex-shrink-0 px-4 py-3 border-b border-slate-800 flex items-center justify-between bg-slate-900/95 backdrop-blur">
        <div className="flex items-center gap-3">
          {/* View Mode Toggle */}
          <div className="flex items-center bg-slate-800 rounded-lg p-0.5">
            <button
              onClick={() => setViewMode('preview')}
              className={cn(
                'flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-all duration-200',
                viewMode === 'preview'
                  ? 'bg-blue-600 text-white shadow-sm'
                  : 'text-slate-400 hover:text-slate-200'
              )}
            >
              <Eye className="w-4 h-4" />
              <span>Preview</span>
            </button>
            <button
              onClick={() => setViewMode('terminal')}
              className={cn(
                'flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-all duration-200',
                viewMode === 'terminal'
                  ? 'bg-blue-600 text-white shadow-sm'
                  : 'text-slate-400 hover:text-slate-200'
              )}
            >
              <TerminalIcon className="w-4 h-4" />
              <span>Terminal</span>
            </button>
          </div>

          {!isEngineReady && (
            <div className="flex items-center gap-2 text-xs text-amber-500">
              <Loader2 className="w-3 h-3 animate-spin" />
              Booting Engine...
            </div>
          )}
          {isEngineReady && !previewUrl && (
            <div className="flex items-center gap-2 text-xs text-slate-500">
              Waiting for server...
            </div>
          )}
          {previewUrl && (
            <div className="flex items-center gap-2 text-xs text-green-500">
              <CheckCircle2 className="w-3 h-3" />
              Server On
            </div>
          )}
        </div>

        <div className="flex items-center gap-1">
          <button
            onClick={() => setIsFullscreen(!isFullscreen)}
            className="p-2 rounded-md hover:bg-slate-800 text-slate-400 hover:text-slate-200 transition-all duration-200"
          >
            {isFullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
          </button>
        </div>
      </div>

      {/* Main Content Area */}
      <div className="flex-1 min-h-0 w-full relative overflow-hidden bg-slate-950">

        {/* Helper message if no server is running yet */}
        {!previewUrl && viewMode === 'preview' && (
          <div className="absolute inset-0 flex items-center justify-center text-slate-500 flex-col gap-2">
            <Loader2 className="w-8 h-8 animate-spin opacity-20" />
            {isBooting ? (
              <>
                <p className="text-blue-400">Installing dependencies & starting server...</p>
                <p className="text-xs">This may take a minute</p>
              </>
            ) : !isEngineReady ? (
              <>
                <p>Initializing WebContainer...</p>
                <p className="text-xs">Please wait</p>
              </>
            ) : (
              <>
                <p>Waiting for project generation...</p>
                <p className="text-xs">Enter a prompt to generate an app</p>
              </>
            )}
          </div>
        )}

        <div className={cn("h-full w-full", viewMode === 'preview' ? 'block' : 'hidden')}>
          {previewUrl && (
            <iframe
              ref={iframeRef}
              src={previewUrl}
              className="w-full h-full border-none bg-white"
            />
          )}
        </div>

        <div className={cn("h-full w-full p-2", viewMode === 'terminal' ? 'block' : 'hidden')}>
          <Terminal />
        </div>
      </div>
    </div>
  );
}
