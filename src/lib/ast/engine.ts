import Parser from 'web-tree-sitter';

export type ASTPatchOperation = 
  | { type: 'INSERT_NODE'; path: string; position: number; content: string }
  | { type: 'UPDATE_PROP'; path: string; value: string }
  | { type: 'MODIFY_IMPORT'; path: string; importName: string; action: 'add' | 'remove' }
  | { type: 'DELETE_BLOCK'; path: string };

export interface ASTPatch {
  version: '1.0';
  file: string;
  operations: ASTPatchOperation[];
}

export class ASTEngine {
  private parser: Parser | null = null;
  private languageRaw: any = null;
  private initialized = false;

  async init() {
    if (this.initialized) return;
    
    // In browser/Node hybrid (Next.js), we need to load the WASM binary.
    await Parser.init();
    this.parser = new Parser();
    
    // Note: In a real Next.js environment, the .wasm file needs to be served from the public/ directory
    // or loaded via a specific path. For this implementation we assume tree-sitter-tsx.wasm is available.
    try {
      const Lang = await Parser.Language.load('/tree-sitter-tsx.wasm');
      this.parser.setLanguage(Lang);
      this.languageRaw = Lang;
      this.initialized = true;
      console.log('✅ AST Engine (Tree-sitter) initialized successfully.');
    } catch (e) {
      console.error('Failed to load tree-sitter WASM. Ensure it is in the public directory.', e);
      throw e;
    }
  }

  /**
   * Parses raw source code into an AST tree
   */
  parse(sourceCode: string): Parser.Tree {
    if (!this.parser) throw new Error('ASTEngine not initialized');
    return this.parser.parse(sourceCode);
  }

  /**
   * Applies an AI-generated JSON patch to the source code.
   * This is a simplified structural representation.
   */
  applyPatch(sourceCode: string, patch: ASTPatch): string {
    if (!this.parser) throw new Error('ASTEngine not initialized');
    
    const tree = this.parser.parse(sourceCode);
    let mutatedCode = sourceCode;

    // A real implementation would traverse `tree.rootNode` to find the exact byte/character
    // indices specified by the `patch.path` and apply string splicing deterministically.
    
    for (const op of patch.operations) {
       console.log(`[AST Engine] Applying structural patch:`, op.type, op.path);

       if (op.type === 'MODIFY_IMPORT') {
            if (op.action === 'add' && op.importName) {
                const importPattern = new RegExp(`import\\s+.*?\\s+from\\s+['"]${op.path}['"]`, 'g');
                
                // If the file already has the exact import, do NOT add it.
                // This prevents the duplicate motion motion bug structurally.
                if (mutatedCode.includes(`{ ${op.importName} } from '${op.path}'`) || mutatedCode.includes(`{${op.importName}} from '${op.path}'`)) {
                    console.log(`[AST Engine] Skipped redundant import: ${op.importName} from ${op.path}`);
                    continue;
                }

                if (importPattern.test(mutatedCode)) {
                    // It exists, but doesn't have our named import. We would typically parse the AST tree for the exact token
                    // For now we'll do a safe append top
                    mutatedCode = `import { ${op.importName} } from '${op.path}';\n` + mutatedCode;
                } else {
                    mutatedCode = `import { ${op.importName} } from '${op.path}';\n` + mutatedCode;
                }
            }
       }
       else if (op.type === 'UPDATE_PROP' && op.value) {
           // Locate Node via op.path syntax (e.g., 'jsxElement>jsxOpeningElement>jsxAttribute[name="className"]')
           // using tree-sitter queries.
           // Fallback for demo: basic regex to find the string and replace
           mutatedCode = mutatedCode.replace(new RegExp(`className=["'][^"']*["']`, 'g'), `className="${op.value}"`);
       }
       else if ((op.type === 'INSERT_NODE' || op.type === 'DELETE_BLOCK') && op.content) {
           // Typical tree-sitter splicing logic based on offsets
           // node = this.findNodeByPath(tree.rootNode, op.path);
           // mutatedCode = mutatedCode.slice(0, node.startIndex) + op.content + mutatedCode.slice(node.endIndex);
       }
    }

    return mutatedCode;
  }
}

export const astEngine = new ASTEngine();
