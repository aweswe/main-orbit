/**
 * Streaming Action Parser for Orbit
 * 
 * Parses <orbitArtifact> and <orbitAction> tags from streaming LLM responses.
 * Ported from Bolt.new's message-parser.ts pattern.
 * 
 * Usage:
 *   const parser = new StreamingActionParser({
 *     onActionOpen: (action) => console.log('Started:', action),
 *     onActionComplete: (action) => actionRunner.queueAction(action),
 *     onArtifactOpen: (artifact) => console.log('Artifact:', artifact.title),
 *   });
 *   
 *   // Call parse() with each streaming chunk
 *   for await (const chunk of stream) {
 *     parser.parse(messageId, chunk);
 *   }
 */

export type OrbitActionType = 'file' | 'shell';

export interface OrbitAction {
    type: OrbitActionType;
    content: string;
    path?: string;  // For file actions
}

export interface OrbitArtifact {
    id: string;
    title: string;
}

export interface ParsedAction extends OrbitAction {
    actionId: string;
    artifactId: string;
}

export interface ParserCallbacks {
    onArtifactOpen?: (artifact: OrbitArtifact) => void;
    onArtifactClose?: (artifact: OrbitArtifact) => void;
    onActionOpen?: (action: ParsedAction) => void;
    onActionComplete?: (action: ParsedAction) => void;
    onText?: (text: string) => void;  // Non-action text (explanations, etc.)
}

// Tag constants (lowercase for matching)
const ARTIFACT_TAG_OPEN = '<orbitartifact';
const ARTIFACT_TAG_CLOSE = '</orbitartifact>';
const ACTION_TAG_OPEN = '<orbitaction';
const ACTION_TAG_CLOSE = '</orbitaction>';

interface ParserState {
    position: number;
    insideArtifact: boolean;
    insideAction: boolean;
    currentArtifact?: OrbitArtifact;
    currentAction: Partial<OrbitAction>;
    actionId: number;
    buffer: string;  // Accumulates incomplete tags
}

export class StreamingActionParser {
    #states = new Map<string, ParserState>();
    #callbacks: ParserCallbacks;

    constructor(callbacks: ParserCallbacks = {}) {
        this.#callbacks = callbacks;
    }

    /**
     * Parse a chunk of streaming content.
     * Call this for each chunk received from the LLM.
     * Returns any non-action text content.
     */
    parse(messageId: string, input: string): string {
        let state = this.#states.get(messageId);

        if (!state) {
            state = {
                position: 0,
                insideArtifact: false,
                insideAction: false,
                currentAction: { content: '' },
                actionId: 1,
                buffer: '',
            };
            this.#states.set(messageId, state);
        }

        const fullInput = state.buffer + input;
        state.buffer = '';

        let output = '';
        let i = 0;

        while (i < fullInput.length) {
            const lowerInput = fullInput.toLowerCase();

            if (state.insideArtifact) {
                const currentArtifact = state.currentArtifact!;

                if (state.insideAction) {
                    // Looking for </orbitAction>
                    const closeIndex = lowerInput.indexOf(ACTION_TAG_CLOSE, i);

                    if (closeIndex !== -1) {
                        state.currentAction.content = (state.currentAction.content || '') + fullInput.slice(i, closeIndex);

                        let content = (state.currentAction.content || '').trim();
                        if (state.currentAction.type === 'file') {
                            content += '\n';
                        }
                        state.currentAction.content = content;

                        const completedAction: ParsedAction = {
                            type: state.currentAction.type as OrbitActionType,
                            content: state.currentAction.content.replace(/\\?\$\{/g, '${').replace(/\\`/g, '`'),
                            path: state.currentAction.path,
                            actionId: String(state.actionId - 1),
                            artifactId: currentArtifact.id,
                        };

                        this.#callbacks.onActionComplete?.(completedAction);
                        console.log(`[Parser] Action complete: ${completedAction.type} ${completedAction.path || ''}`);

                        state.insideAction = false;
                        state.currentAction = { content: '' };
                        i = closeIndex + ACTION_TAG_CLOSE.length;
                    } else {
                        // Check for partial close tag
                        const lastLt = fullInput.lastIndexOf('<', fullInput.length - 1);
                        if (lastLt >= i && ACTION_TAG_CLOSE.startsWith(lowerInput.slice(lastLt))) {
                            state.currentAction.content = (state.currentAction.content || '') + fullInput.slice(i, lastLt);
                            state.buffer = fullInput.slice(lastLt);
                            i = fullInput.length;
                        } else {
                            state.currentAction.content = (state.currentAction.content || '') + fullInput.slice(i);
                            i = fullInput.length;
                        }
                    }
                } else {
                    // Look for <orbitAction or </orbitArtifact>
                    const actionOpenIndex = lowerInput.indexOf(ACTION_TAG_OPEN, i);
                    const artifactCloseIndex = lowerInput.indexOf(ARTIFACT_TAG_CLOSE, i);

                    if (actionOpenIndex !== -1 && (artifactCloseIndex === -1 || actionOpenIndex < artifactCloseIndex)) {
                        const openTagEnd = fullInput.indexOf('>', actionOpenIndex);

                        if (openTagEnd !== -1) {
                            state.insideAction = true;
                            state.currentAction = this.#parseActionTag(fullInput, actionOpenIndex, openTagEnd);

                            const actionData: ParsedAction = {
                                type: state.currentAction.type as OrbitActionType,
                                content: '',
                                path: state.currentAction.path,
                                actionId: String(state.actionId++),
                                artifactId: currentArtifact.id,
                            };

                            this.#callbacks.onActionOpen?.(actionData);
                            console.log(`[Parser] Action open: ${actionData.type} ${actionData.path || ''}`);
                            i = openTagEnd + 1;
                        } else {
                            state.buffer = fullInput.slice(actionOpenIndex);
                            i = fullInput.length;
                        }
                    } else if (artifactCloseIndex !== -1) {
                        this.#callbacks.onArtifactClose?.(currentArtifact);
                        state.insideArtifact = false;
                        state.currentArtifact = undefined;
                        i = artifactCloseIndex + ARTIFACT_TAG_CLOSE.length;
                    } else {
                        // Check for partial tags
                        const lastLt = fullInput.lastIndexOf('<', fullInput.length - 1);
                        if (lastLt >= i) {
                            const suffix = lowerInput.slice(lastLt);
                            if (ACTION_TAG_OPEN.startsWith(suffix) || ARTIFACT_TAG_CLOSE.startsWith(suffix)) {
                                state.buffer = fullInput.slice(lastLt);
                                i = fullInput.length;
                                continue;
                            }
                        }
                        i = fullInput.length;
                    }
                }
            } else {
                // Not inside artifact - look for <orbitArtifact
                const artifactOpenIndex = lowerInput.indexOf(ARTIFACT_TAG_OPEN, i);

                if (artifactOpenIndex !== -1) {
                    if (artifactOpenIndex > i) {
                        const textContent = fullInput.slice(i, artifactOpenIndex);
                        output += textContent;
                        this.#callbacks.onText?.(textContent);
                    }

                    const openTagEnd = fullInput.indexOf('>', artifactOpenIndex);

                    if (openTagEnd !== -1) {
                        const artifactTag = fullInput.slice(artifactOpenIndex, openTagEnd + 1);
                        const artifactId = this.#extractAttribute(artifactTag, 'id') || `artifact-${Date.now()}`;
                        const artifactTitle = this.#extractAttribute(artifactTag, 'title') || 'Untitled';

                        state.insideArtifact = true;
                        state.currentArtifact = { id: artifactId, title: artifactTitle };

                        this.#callbacks.onArtifactOpen?.(state.currentArtifact);
                        console.log(`[Parser] Artifact open: ${state.currentArtifact.title}`);
                        i = openTagEnd + 1;
                    } else {
                        state.buffer = fullInput.slice(artifactOpenIndex);
                        i = fullInput.length;
                    }
                } else {
                    // Check for partial <orbitArtifact
                    const lastLt = fullInput.lastIndexOf('<', fullInput.length - 1);
                    if (lastLt >= i && ARTIFACT_TAG_OPEN.startsWith(lowerInput.slice(lastLt))) {
                        const textContent = fullInput.slice(i, lastLt);
                        output += textContent;
                        this.#callbacks.onText?.(textContent);
                        state.buffer = fullInput.slice(lastLt);
                        i = fullInput.length;
                    } else {
                        const textContent = fullInput.slice(i);
                        output += textContent;
                        this.#callbacks.onText?.(textContent);
                        i = fullInput.length;
                    }
                }
            }
        }

        return output;
    }

    /**
     * Reset parser state for a message
     */
    reset(messageId?: string) {
        if (messageId) {
            this.#states.delete(messageId);
        } else {
            this.#states.clear();
        }
    }

    #parseActionTag(input: string, openIndex: number, endIndex: number): Partial<OrbitAction> {
        const tag = input.slice(openIndex, endIndex + 1);
        const type = this.#extractAttribute(tag, 'type') as OrbitActionType;
        const path = this.#extractAttribute(tag, 'path');

        return {
            type: type || 'file',
            path,
            content: '',
        };
    }

    #extractAttribute(tag: string, name: string): string | undefined {
        const match = tag.match(new RegExp(`${name}="([^"]*)"`, 'i'));
        return match ? match[1] : undefined;
    }

    /**
     * Helper to strip ANSI escape codes and terminal control sequences from output
     */
    static stripAnsi(text: string): string {
        if (!text) return '';

        // Remove ANSI escape codes
        // eslint-disable-next-line no-control-regex
        let clean = text.replace(/[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g, '');

        // Remove common terminal control characters that cause noise in web UI
        // \b (backspace), \r (carriage return), \x07 (bell), \x0c (form feed)
        // eslint-disable-next-line no-control-regex
        clean = clean.replace(/[\b\r\x07\x0c]/g, '');

        return clean;
    }
}

/**
 * Helper to convert ParsedAction to the format ActionRunner expects
 */
export function actionToRunnerFormat(action: ParsedAction): {
    type: 'file' | 'shell';
    path?: string;
    content: string;
} {
    return {
        type: action.type,
        path: action.path,
        content: action.content,
    };
}
