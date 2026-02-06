import { ProjectFile } from '@/types/chat';
import {
    File,
    ChevronRight,
    ChevronDown,
    Folder,
    Type,
    Component,
    Wrench,
    Database,
    Globe,
    Layout
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { motion, AnimatePresence } from 'framer-motion';
import { useState } from 'react';

interface FileTreeProps {
    files: ProjectFile[];
    activeFilePath: string | null;
    onFileSelect: (path: string) => void;
    isGenerating?: boolean;
    hideHeader?: boolean;
}

const getFileIcon = (path: string) => {
    if (path === 'App.tsx') return <Layout className="w-4 h-4 text-cyan-400" />;
    if (path.includes('types/')) return <Type className="w-4 h-4 text-purple-400" />;
    if (path.includes('components/')) return <Component className="w-4 h-4 text-blue-400" />;
    if (path.includes('utils/')) return <Wrench className="w-4 h-4 text-yellow-400" />;
    if (path.includes('services/')) return < Globe className="w-4 h-4 text-emerald-400" />;
    if (path.includes('store/')) return <Database className="w-4 h-4 text-orange-400" />;
    return <File className="w-4 h-4 text-slate-400" />;
};

export function FileTree({ files, activeFilePath, onFileSelect, isGenerating, hideHeader = false }: FileTreeProps) {
    // Group files by folder
    const folders: Record<string, ProjectFile[]> = {};
    const rootFiles: ProjectFile[] = [];

    files.forEach(file => {
        if (file.path.includes('/')) {
            const folderName = file.path.split('/')[0];
            if (!folders[folderName]) folders[folderName] = [];
            folders[folderName].push(file);
        } else {
            rootFiles.push(file);
        }
    });

    return (
        <div className="flex flex-col h-full bg-slate-950/50 border-r border-slate-800 overflow-y-auto custom-scrollbar select-none">
            {!hideHeader && (
                <div className="px-4 py-3 border-b border-slate-800 bg-slate-900/50 flex items-center justify-between">
                    <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Explorer</span>
                    {isGenerating && (
                        <div className="flex gap-1">
                            <motion.div
                                animate={{ opacity: [0.3, 1, 0.3] }}
                                transition={{ repeat: Infinity, duration: 1.5 }}
                                className="w-1.5 h-1.5 rounded-full bg-primary"
                            />
                        </div>
                    )}
                </div>
            )}

            <div className="py-2">
                {Object.entries(folders).map(([folderName, folderFiles]) => (
                    <FolderItem
                        key={folderName}
                        name={folderName}
                        files={folderFiles}
                        activeFilePath={activeFilePath}
                        onFileSelect={onFileSelect}
                    />
                ))}

                {rootFiles.map((file) => (
                    <FileItem
                        key={file.path}
                        file={file}
                        isActive={activeFilePath === file.path}
                        onSelect={() => onFileSelect(file.path)}
                    />
                ))}

                {files.length === 0 && (
                    <div className="px-4 py-8 text-center text-slate-600 italic text-sm">
                        No files planned yet...
                    </div>
                )}
            </div>
        </div>
    );
}

function FolderItem({ name, files, activeFilePath, onFileSelect }: {
    name: string;
    files: ProjectFile[];
    activeFilePath: string | null;
    onFileSelect: (path: string) => void;
}) {
    const [isOpen, setIsOpen] = useState(true);

    return (
        <div className="mb-0.5">
            <div
                onClick={() => setIsOpen(!isOpen)}
                className="flex items-center gap-1.5 px-3 py-1 hover:bg-slate-800/50 cursor-pointer group transition-colors"
            >
                <div className="flex-shrink-0">
                    {isOpen ? <ChevronDown className="w-3.5 h-3.5 text-slate-500" /> : <ChevronRight className="w-3.5 h-3.5 text-slate-500" />}
                </div>
                <Folder className="w-4 h-4 text-blue-400 fill-blue-400/10" />
                <span className="text-sm text-slate-300 font-medium group-hover:text-white transition-colors">
                    {name}
                </span>
            </div>

            <AnimatePresence initial={false}>
                {isOpen && (
                    <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        className="overflow-hidden"
                    >
                        {files.map(file => (
                            <FileItem
                                key={file.path}
                                file={file}
                                isActive={activeFilePath === file.path}
                                onSelect={() => onFileSelect(file.path)}
                                depth={1}
                            />
                        ))}
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
}

function FileItem({ file, isActive, onSelect, depth = 0 }: {
    file: ProjectFile;
    isActive: boolean;
    onSelect: () => void;
    depth?: number;
}) {
    return (
        <motion.div
            whileHover={{ scale: 1.01 }}
            whileTap={{ scale: 0.98 }}
            onClick={onSelect}
            className={cn(
                "flex items-center gap-2 py-1 px-3 cursor-pointer transition-colors relative",
                isActive ? "bg-primary/20 text-white" : "hover:bg-slate-800/50 text-slate-400",
                depth > 0 && "pl-8"
            )}
        >
            {isActive && (
                <motion.div
                    layoutId="active-file-indicator"
                    className="absolute left-0 top-0 bottom-0 w-1 bg-primary"
                />
            )}
            <div className="flex-shrink-0">
                {getFileIcon(file.path)}
            </div>
            <span className={cn(
                "text-sm truncate transition-colors",
                isActive ? "font-semibold text-white" : "group-hover:text-slate-200"
            )}>
                {file.path.split('/').pop()}
            </span>
        </motion.div>
    );
}
