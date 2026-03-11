/**
 * Utility to parse WebContainer terminal streams for common build and syntactical errors.
 */

export interface ParsedError {
    type: 'typescript' | 'vite' | 'eslint' | 'npm' | 'vitest' | 'database' | 'unknown';
    file?: string;
    line?: number;
    message: string;
    raw: string;
}

export function parseTerminalError(output: string): ParsedError | null {
    if (!output) return null;

    const lowerOutput = output.toLowerCase();

    // We only care if it's an actual error that breaks the build
    if (!lowerOutput.includes('error') && !lowerOutput.includes('failed to parse')) {
        return null;
    }

    // 1. Match Vite/ESBuild Syntax Errors
    // e.g. [vite] Internal server error: Failed to parse source for import analysis because the content contains invalid JS syntax.
    // src/components/Header.tsx:15:20
    const viteMatch = output.match(/\[vite\].*?error[\s\S]*?(src\/[^:]+\.tsx?):(\d+):(\d+)/i);
    if (viteMatch) {
        return {
            type: 'vite',
            file: viteMatch[1],
            line: parseInt(viteMatch[2], 10),
            message: 'Syntax error during Vite build',
            raw: output
        };
    }

    // 2. Match standard TypeScript type errors
    // e.g. src/App.tsx(10,5): error TS2322: Type 'string' is not assignable to type 'number'.
    const tsMatch = output.match(/(src\/[^:]+\.tsx?)\((\d+),\d+\):\s*error\s*(TS\d+:.*)/i);
    if (tsMatch) {
        return {
            type: 'typescript',
            file: tsMatch[1],
            line: parseInt(tsMatch[2], 10),
            message: tsMatch[3].trim(),
            raw: output
        };
    }

    // 3. Match npm install errors (e.g. "No matching version found for X")
    const npmMatch = output.match(/npm error.*?(notarget|code E404|code ETARGET)[\s\S]*?(No matching version found for|Not Found - GET)[^\n]*([^\n]+)/i);
    // Alternatively, just catch any generic npm error block
    const genericNpmMatch = output.match(/npm error[\s\S]{10,200}/i);

    if (npmMatch || genericNpmMatch) {
        return {
            type: 'npm',
            file: 'package.json', // The likely culprit
            message: 'Failed to install dependencies. A package version may not exist.',
            raw: output
        };
    }

    // 4. Roadmap Item 4: Match Vitest test failures
    // e.g. FAIL  src/App.test.tsx > App component > renders headline
    // AssertionError: expected "Hello" to be "World"
    const vitestMatch = output.match(/FAIL\s+(src\/[A-Za-z0-9_.\-\/]+\.test\.tsx?)[\s\S]*?(AssertionError|Error):([^\n]+)/i);
    if (vitestMatch) {
        return {
            type: 'vitest',
            file: vitestMatch[1],
            message: `UI Test Failed: ${vitestMatch[3].trim()}`,
            raw: output
        };
    }

    // 3. Match generic file path patterns near an "Error" keyword
    const genericFileMatch = output.match(/(src\/[a-zA-Z0-9_\-\/]+\.tsx?)/);
    if (genericFileMatch && lowerOutput.includes('error')) {
        return {
            type: 'unknown',
            file: genericFileMatch[1],
            message: 'An error occurred in this file preventing compilation.',
            raw: output
        };
    }

    return null;
}
