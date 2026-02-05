import { FileSystemTree } from '@webcontainer/api';
import { ProjectFile } from '@/types/chat';

/**
 * Converts a flat list of `ProjectFile` objects into a nested `FileSystemTree`
 * compatible with the WebContainer API.
 * 
 * @param files - Array of ProjectFile objects
 * @returns FileSystemTree structure
 */
export const convertFilesToWebContainerFS = (files: ProjectFile[]): FileSystemTree => {
    const root: FileSystemTree = {};

    files.forEach(file => {
        // Remove leading slash if present
        const path = file.path.startsWith('/') ? file.path.slice(1) : file.path;
        const parts = path.split('/').filter(Boolean);
        let current = root;

        parts.forEach((part, index) => {
            if (index === parts.length - 1) {
                // It's a file
                current[part] = {
                    file: {
                        contents: file.content
                    }
                };
            } else {
                // It's a directory
                if (!current[part]) {
                    current[part] = {
                        directory: {}
                    };
                }

                const entry = current[part];
                if ('directory' in entry) {
                    current = entry.directory;
                } else {
                    // Conflict: path exists as a file but we need it as a directory
                    // In a real FS this is an error, here we ideally shouldn't hit it with valid input
                    console.warn(`Path conflict: ${part} is treated as a directory but exists as a file.`);
                }
            }
        });
    });

    return root;
};
