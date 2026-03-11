import { ProjectFile } from '@/types/chat';

/**
 * smart-edit.ts
 * 
 * Unified Smart Edit Architecture for Orbit.
 * Replaces blunt file context loading with:
 * 1. AST Signatures (Types, Interfaces, Function exports)
 * 2. Bidirectional Import Graphs (Dependencies + Dependents)
 * 3. Surgical JSON Patching (Search/Replace instead of full file rewrites)
 */

export interface ContextNode {
    path: string;
    type: 'target' | 'dependency' | 'dependent';
    content: string; // The AST signature or full content
}

/**
 * Step 1. AST Signatures
 * Strips out function bodies and JSX returns, leaving only:
 * - imports
 * - types & interfaces
 * - function/class signatures with param types
 * - exported constants
 */
export function extractASTSignature(code: string): string {
    const lines = code.split('\n');
    const signatureLines: string[] = [];

    let inCommentBlock = false;
    let braceDepth = 0;

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const trimmed = line.trim();

        // Handle multiline comments
        if (trimmed.startsWith('/*')) inCommentBlock = true;
        if (inCommentBlock) {
            if (trimmed.endsWith('*/')) inCommentBlock = false;
            continue;
        }

        // Ignore single line comments
        if (trimmed.startsWith('//')) continue;

        // Always include imports
        if (trimmed.startsWith('import ') || trimmed.startsWith('export *')) {
            signatureLines.push(line);
            continue;
        }

        // Always include types and interfaces (even multi-line ones)
        if (trimmed.startsWith('type ') || trimmed.startsWith('export type ') ||
            trimmed.startsWith('interface ') || trimmed.startsWith('export interface ')) {
            signatureLines.push(line);

            // If it's a multi-line interface/type, we want to grab its body
            if (trimmed.endsWith('{') || !trimmed.includes(';')) {
                let j = i + 1;
                while (j < lines.length) {
                    signatureLines.push(lines[j]);
                    if (lines[j].trim().startsWith('}') || lines[j].trim().endsWith(';')) break;
                    j++;
                }
                i = j; // skip ahead
            }
            continue;
        }

        // Function signatures (strip bodies)
        const isFunction = (trimmed.startsWith('function ') || trimmed.startsWith('export function ') ||
            trimmed.startsWith('const ') || trimmed.startsWith('export const ')) &&
            (trimmed.includes('=>') || trimmed.includes('('));

        if (isFunction) {
            // Very naive body stripper: find the opening brace and replace everything after it with {...}
            const braceIdx = line.indexOf('{');
            if (braceIdx !== -1) {
                signatureLines.push(line.substring(0, braceIdx) + '{ /* implementation hidden */ }');
            } else {
                signatureLines.push(line);
                // Might be a multi-line parameter list
                let j = i + 1;
                while (j < lines.length) {
                    const l = lines[j];
                    const bIdx = l.indexOf('{');
                    if (bIdx !== -1) {
                        signatureLines.push(l.substring(0, bIdx) + '{ /* implementation hidden */ }');
                        i = j;
                        break;
                    }
                    signatureLines.push(l);
                    j++;
                }
            }
            continue;
        }
    }

    return signatureLines.join('\n');
}

/**
 * Step 2. Bidirectional Import Graph
 * 
 * Given a target file path to edit, returns:
 * - The FULL target file (it needs editing)
 * - The SIGNATURES of all files it imports (what it consumes)
 * - The SIGNATURES of all files that import it (what it provides)
 */
export function buildSmartEditContext(targetFilePath: string, projectFiles: ProjectFile[]): ContextNode[] {
    const contextNodes: ContextNode[] = [];

    // 1. Target file (FULL CONTENT)
    let targetFile = projectFiles.find(f => f.path === targetFilePath || f.path.endsWith('/' + targetFilePath));

    // Fallback heuristic if not exact match (e.g. 'App.tsx' vs 'src/App.tsx')
    if (!targetFile) {
        targetFile = projectFiles.find(f => f.path.includes(targetFilePath));
    }

    if (!targetFile) return [];

    contextNodes.push({
        path: targetFile.path,
        type: 'target',
        content: targetFile.content
    });

    // Extract base name for matching without extension
    const targetBaseName = targetFile.path.split('/').pop()?.replace(/\.[^/.]+$/, "") || targetFile.path;

    for (const file of projectFiles) {
        if (file.path === targetFile.path) continue;

        const content = file.content;

        // 2. Dependencies (What the target imports)
        // Check if the target file imports THIS file
        const fileBaseName = file.path.split('/').pop()?.replace(/\.[^/.]+$/, "") || '';
        const targetImportsThis = new RegExp(`from\\s+['"][^'"]*${fileBaseName}['"]`, 'i').test(targetFile.content);

        if (targetImportsThis) {
            contextNodes.push({
                path: file.path,
                type: 'dependency',
                content: extractASTSignature(content)
            });
            continue; // a file is usually not both
        }

        // 3. Dependents (What imports the target)
        // Check if THIS file imports the target
        const thisImportsTarget = new RegExp(`from\\s+['"][^'"]*${targetBaseName}['"]`, 'i').test(content);

        if (thisImportsTarget) {
            contextNodes.push({
                path: file.path,
                type: 'dependent',
                content: extractASTSignature(content)
            });
        }
    }

    return contextNodes;
}

/**
 * Step 3. Assemble Prompt
 * 
 * Compiles the nodes into the strict Surgical Edit string injection
 */
export function formatSmartEditPrompt(targetFilePath: string, projectFiles: ProjectFile[], userPrompt: string): string {
    const nodes = buildSmartEditContext(targetFilePath, projectFiles);

    if (nodes.length === 0) return userPrompt;

    let contextStr = `\n\n[[SMART EDIT CONTEXT FOR: ${targetFilePath}]]\n`;

    const targetNode = nodes.find(n => n.type === 'target');
    const dependencies = nodes.filter(n => n.type === 'dependency');
    const dependents = nodes.filter(n => n.type === 'dependent');

    if (dependencies.length > 0) {
        contextStr += `\n--- DEPENDENCIES (Files ${targetFilePath} consumes. Signatures Only) ---\n`;
        dependencies.forEach(d => {
            contextStr += `\n// File: ${d.path}\n${d.content}\n`;
        });
    }

    if (dependents.length > 0) {
        contextStr += `\n--- DEPENDENTS (Files that consume ${targetFilePath}. Signatures Only) ---\n`;
        dependents.forEach(d => {
            contextStr += `\n// File: ${d.path}\n${d.content}\n`;
        });
    }

    if (targetNode) {
        contextStr += `\n--- TARGET FILE (Full Code) ---\n`;
        contextStr += `// File: ${targetNode.path}\n${targetNode.content}\n`;
    }

    return `${userPrompt}${contextStr}`;
}
