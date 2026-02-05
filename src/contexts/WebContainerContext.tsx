import React, { createContext, useContext, useEffect, useState, useRef, useCallback } from 'react';
import { WebContainer } from '@webcontainer/api';
import { getWebContainer } from '@/lib/webcontainer/instance';
import { ActionRunner } from '@/lib/runtime/action-runner';
import { ProjectFile } from '@/types/chat';
import { convertFilesToWebContainerFS } from '@/lib/webcontainer/file-system';

interface WebContainerContextType {
    webcontainer: WebContainer | null;
    isLoading: boolean;
    error: Error | null;
    writeFile: (path: string, content: string) => Promise<void>;
    readFile: (path: string) => Promise<string>;
    runCommand: (command: string, args: string[]) => Promise<any>;
    // NEW: Auto-boot methods
    mountFiles: (files: ProjectFile[]) => Promise<void>;
    runBootSequence: (files: ProjectFile[], onOutput?: (output: string) => void) => Promise<boolean>;
    isBooting: boolean;
}

const WebContainerContext = createContext<WebContainerContextType | null>(null);

export const useWebContainer = () => {
    const context = useContext(WebContainerContext);
    if (!context) {
        throw new Error('useWebContainer must be used within a WebContainerProvider');
    }
    return context;
};

export const WebContainerProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const [webcontainer, setWebContainer] = useState<WebContainer | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [isBooting, setIsBooting] = useState(false);
    const [error, setError] = useState<Error | null>(null);
    const actionRunnerRef = useRef<ActionRunner | null>(null);

    useEffect(() => {
        const init = async () => {
            try {
                const instance = await getWebContainer();
                setWebContainer(instance);
                setIsLoading(false);
            } catch (err) {
                setError(err instanceof Error ? err : new Error('Failed to initialize WebContainer'));
                setIsLoading(false);
            }
        };
        init();
    }, []);

    const writeFile = async (path: string, content: string) => {
        if (!webcontainer) throw new Error('WebContainer not initialized');
        await webcontainer.fs.writeFile(path, content);
    };

    const readFile = async (path: string) => {
        if (!webcontainer) throw new Error('WebContainer not initialized');
        const content = await webcontainer.fs.readFile(path, 'utf-8');
        return content;
    };

    const runCommand = async (cmd: string, args: string[]) => {
        if (!webcontainer) throw new Error('WebContainer not initialized');
        return await webcontainer.spawn(cmd, args);
    };

    // NEW: Mount all files to WebContainer filesystem
    const mountFiles = useCallback(async (files: ProjectFile[]) => {
        if (!webcontainer) throw new Error('WebContainer not initialized');
        const fsTree = convertFilesToWebContainerFS(files);
        await webcontainer.mount(fsTree);
        console.log(`✅ Mounted ${files.length} files to WebContainer`);
    }, [webcontainer]);

    // NEW: Run full boot sequence (mount files → npm install → npm run dev)
    const runBootSequence = useCallback(async (
        files: ProjectFile[],
        onOutput?: (output: string) => void
    ): Promise<boolean> => {
        if (!webcontainer) {
            onOutput?.('❌ WebContainer not initialized');
            return false;
        }

        setIsBooting(true);

        // Create ActionRunner with output callback
        const runner = new ActionRunner(webcontainer, {
            onOutput: (output) => {
                console.log(output);
                onOutput?.(output);
            },
        });
        actionRunnerRef.current = runner;

        try {
            const success = await runner.runBootSequence(files);
            return success;
        } finally {
            setIsBooting(false);
        }
    }, [webcontainer]);

    return (
        <WebContainerContext.Provider value={{
            webcontainer,
            isLoading,
            error,
            writeFile,
            readFile,
            runCommand,
            mountFiles,
            runBootSequence,
            isBooting
        }}>
            {children}
        </WebContainerContext.Provider>
    );
};
