// hooks/useSandpackErrorHandler.ts
import { useEffect, useState } from 'react';
import { useSandpack } from '@codesandbox/sandpack-react';

interface SyntaxError {
    file: string;
    line: number;
    column: number;
    message: string;
}

/**
 * Hook that monitors Sandpack for syntax errors and triggers auto-healing
 */
export function useSandpackErrorHandler(
    onSyntaxError?: (error: SyntaxError) => Promise<void>
) {
    const { sandpack } = useSandpack();
    const [syntaxErrors, setSyntaxErrors] = useState<SyntaxError[]>([]);
    const [isHealing, setIsHealing] = useState(false);

    useEffect(() => {
        if (!sandpack) return;

        const { listen } = sandpack;

        // Listen for errors from Sandpack
        const unsubscribe = listen((message) => {
            if (message.type === 'error') {
                const error = parseError(message);

                if (error && isSyntaxError(error)) {
                    console.error('🔴 Syntax error detected:', error);
                    setSyntaxErrors(prev => [...prev, error]);

                    // Trigger auto-healing if callback provided
                    if (onSyntaxError && !isHealing) {
                        setIsHealing(true);
                        onSyntaxError(error)
                            .then(() => {
                                console.log('✅ File regenerated successfully');
                                setSyntaxErrors(prev => prev.filter(e => e.file !== error.file));
                            })
                            .catch(err => {
                                console.error('❌ Auto-healing failed:', err);
                            })
                            .finally(() => {
                                setIsHealing(false);
                            });
                    }
                }
            }
        });

        return () => unsubscribe();
    }, [sandpack, onSyntaxError, isHealing]);

    return {
        syntaxErrors,
        isHealing,
        clearErrors: () => setSyntaxErrors([]),
    };
}

/**
 * Parse Sandpack error message into structured format
 */
function parseError(message: any): SyntaxError | null {
    try {
        const errorText = message.error || message.message || '';

        // Parse format: /hooks/useFeatures.ts: Unexpected token (25:35)
        const match = errorText.match(/(.+?):\s*(.+?)\s*\((\d+):(\d+)\)/);

        if (match) {
            return {
                file: match[1].replace(/^\//, ''), // Remove leading slash
                message: match[2],
                line: parseInt(match[3]),
                column: parseInt(match[4]),
            };
        }

        // Alternative format: SyntaxError: /hooks/useFeatures.ts (25:35)
        const match2 = errorText.match(/SyntaxError:\s*(.+?)\s*\((\d+):(\d+)\)/);

        if (match2) {
            return {
                file: match2[1].replace(/^\//, ''),
                message: 'Syntax error',
                line: parseInt(match2[2]),
                column: parseInt(match2[3]),
            };
        }

        return null;
    } catch (e) {
        console.error('Failed to parse error:', e);
        return null;
    }
}

/**
 * Check if error is a syntax error (vs runtime error)
 */
function isSyntaxError(error: SyntaxError): boolean {
    const syntaxKeywords = [
        'unexpected token',
        'unexpected end of input',
        'missing',
        'expected',
        'illegal',
        'invalid',
        'unterminated',
    ];

    const msg = error.message.toLowerCase();
    return syntaxKeywords.some(keyword => msg.includes(keyword));
}

/**
 * React component that displays syntax errors with regenerate button
 */
export function SyntaxErrorDisplay({
    errors,
    isHealing,
    onRegenerate,
}: {
    errors: SyntaxError[];
    isHealing: boolean;
    onRegenerate: (error: SyntaxError) => void;
}) {
    if (errors.length === 0) return null;

    return (
        <div className= "bg-red-50 border-l-4 border-red-500 p-4 mb-4" >
        <div className="flex items-start" >
            <div className="flex-shrink-0" >
                <svg
            className="h-5 w-5 text-red-400"
    viewBox = "0 0 20 20"
    fill = "currentColor"
        >
        <path
              fillRule="evenodd"
    d = "M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z"
    clipRule = "evenodd"
        />
        </svg>
        </div>
        < div className = "ml-3 flex-1" >
            <h3 className="text-sm font-medium text-red-800" >
                Syntax Error{ errors.length > 1 ? 's' : '' } Detected
                    </h3>
                    < div className = "mt-2 text-sm text-red-700" >
                        <ul className="list-disc list-inside space-y-1" >
                        {
                            errors.map((error, idx) => (
                                <li key= { idx } >
                                <code className="text-xs bg-red-100 px-1 rounded" >
                            { error.file }: { error.line }: { error.column }
                            </code>
                  { ' - '}
                  { error.message }
                                </li>
                            ))
                        }
                            </ul>
                            </div>
                            < div className = "mt-4" >
                                <button
              onClick={ () => errors.forEach(onRegenerate) }
    disabled = { isHealing }
    className = "inline-flex items-center px-3 py-2 border border-transparent text-sm leading-4 font-medium rounded-md text-white bg-red-600 hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-red-500 disabled:opacity-50"
        >
    {
        isHealing?(
                <>
        <svg
                    className="animate-spin -ml-1 mr-2 h-4 w-4 text-white"
    fill = "none"
    viewBox = "0 0 24 24"
        >
        <circle
                      className="opacity-25"
    cx = "12"
    cy = "12"
    r = "10"
    stroke = "currentColor"
    strokeWidth = "4"
        />
        <path
                      className="opacity-75"
    fill = "currentColor"
    d = "M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
        />
        </svg>
                  Regenerating...
    </>
              ) : (
        'Fix Automatically'
    )
}
</button>
    </div>
    </div>
    </div>
    </div>
  );
}
