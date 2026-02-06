import { ProjectFile, GenerationState } from '@/types/chat';
import { ProjectPlan } from '@/types/pipeline';
import { FileTree } from './FileTree';
import { PreviewPanel } from '@/components/preview/PreviewPanel';
import { cn } from '@/lib/utils';
import { useEffect, useState } from 'react';
import { useProjectExport } from '@/hooks/useProjectExport';
import { Download } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useWebContainer } from '@/contexts/WebContainerContext';
import { convertFilesToWebContainerFS } from '@/lib/webcontainer/file-system';
import { terminalService } from '@/lib/terminal-service';

interface ProjectWorkspaceProps {
    files: ProjectFile[];
    generationState: GenerationState;
    currentPlan: ProjectPlan | null;
    activeFilePath: string | null;
    onFileSelect: (path: string) => void;
    onRetry?: () => void;
    onError?: (error: string) => void;
    disableAutoBoot?: boolean;
}

export function ProjectWorkspace({
    files,
    generationState,
    currentPlan,
    activeFilePath,
    onFileSelect,
    onRetry,
    onError,
    disableAutoBoot
}: ProjectWorkspaceProps) {
    const { exportProject } = useProjectExport();
    const { webcontainer, isLoading: isEngineLoading, runCommand } = useWebContainer();
    const [isBooting, setIsBooting] = useState(false);

    const isGenerating = generationState.status === 'generating' || generationState.status === 'building';

    // File Sync Effect: Whenever 'files' changes, sync to WebContainer FS
    useEffect(() => {
        // Skip if streaming pipeline is active (it handles its own writes)
        if (disableAutoBoot) return;
        if (!webcontainer || files.length === 0) return;

        const syncFiles = async () => {
            const root = convertFilesToWebContainerFS(files);
            await webcontainer.mount(root);
        };

        syncFiles();
    }, [webcontainer, files, disableAutoBoot]);

    // Auto-Install & Auto-Boot Effect
    useEffect(() => {
        if (disableAutoBoot) return;
        if (!webcontainer || !files.length) return;
        if (isBooting) return;

        // ... rest of the legacy boot code (unchanged inside the function)
        const packageJsonFile = files.find(f => f.path === 'package.json');
        if (!packageJsonFile) return;

        const bootId = `boot-${packageJsonFile.content.length}-${packageJsonFile.content.substring(0, 20).replace(/\s/g, '')}`;
        if (sessionStorage.getItem(bootId)) return;

        const bootSequence = async () => {
            terminalService.log('📦 [AUTO-INSTALL] Found package.json. Starting boot sequence...');
            setIsBooting(true);
            sessionStorage.setItem(bootId, 'true');

            try {
                terminalService.log('Running `npm install`...');
                const installProcess = await webcontainer.spawn('npm', ['install']);
                installProcess.output.pipeTo(new WritableStream({
                    write(data) {
                        terminalService.write(data);
                    }
                }));

                const installExit = await installProcess.exit;
                if (installExit !== 0) {
                    terminalService.error(`Install failed with code ${installExit}`);
                    onError?.('Dependency installation failed');
                    sessionStorage.removeItem(bootId);
                    setIsBooting(false);
                    return;
                }
                terminalService.success('Dependencies installed.');

                terminalService.log('Starting dev server (`npm run dev`)...');
                const devProcess = await webcontainer.spawn('npm', ['run', 'dev']);
                devProcess.output.pipeTo(new WritableStream({
                    write(data) {
                        terminalService.write(data);
                    }
                }));
            } catch (e) {
                terminalService.error(`Boot Error: ${e}`);
                onError?.('Failed to auto-boot project');
                sessionStorage.removeItem(bootId);
            } finally {
                setIsBooting(false);
            }
        };

        bootSequence();
    }, [webcontainer, files, isBooting, disableAutoBoot, onError]);

    return (
        <div className="flex h-full w-full bg-slate-950 overflow-hidden">
            {/* File Explorer Sidebar */}
            <div className="w-64 flex-shrink-0 flex flex-col border-r border-slate-800">
                <div className="px-4 py-3 border-b border-slate-800 bg-slate-900/50 flex items-center justify-between">
                    <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Explorer</span>
                    <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6 text-slate-400 hover:text-primary hover:bg-primary/10 transition-colors"
                        onClick={() => exportProject(files, currentPlan)}
                        disabled={files.length === 0 || isGenerating}
                        title="Download Project ZIP"
                    >
                        <Download className="w-4 h-4" />
                    </Button>
                </div>
                <FileTree
                    files={files}
                    activeFilePath={activeFilePath}
                    onFileSelect={onFileSelect}
                    isGenerating={isGenerating}
                    hideHeader={true}
                />
            </div>

            {/* Main Stage (Engine) */}
            <div className="flex-1 min-w-0 bg-slate-900 flex flex-col relative">
                <PreviewPanel
                    files={files}
                    generationState={generationState}
                    onRetry={onRetry}
                    onError={onError}
                    activeFilePath={activeFilePath}
                    isEngineReady={!isEngineLoading}
                />
            </div>
        </div>
    );
}
