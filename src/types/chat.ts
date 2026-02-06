export type MessageRole = 'user' | 'assistant';

export type MessageStatus = 'pending' | 'generating' | 'complete' | 'error';

export interface CodeBlock {
  language: string;
  code: string;
  filename?: string;
}

export interface Message {
  id: string;
  role: MessageRole;
  content: string;
  codeBlocks?: CodeBlock[];
  status: MessageStatus;
  timestamp: Date;
}

export interface GenerationState {
  status: 'idle' | 'generating' | 'building' | 'ready' | 'error';
  error?: string;
  retryCount?: number;
}

export interface ProjectFile {
  path: string;
  content: string;
  language: string;
}

export interface ProjectState {
  files: ProjectFile[];
  activeFile: string;
  dependencies: string[];
}

// Patch-based editing types
export interface CodePatch {
  file: string;
  operation: 'replace' | 'insert' | 'delete';
  search: string;
  replace?: string;
  context?: string;
}

export interface EditorResponse {
  explanation: string;
  patches: CodePatch[];
}

export type RequestIntent = 'generate' | 'edit';

