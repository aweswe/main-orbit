/**
 * Codebase Awareness Engine (Indexer)
 *
 * In a full production environment, this would be an embedded SQLite or Neo4j instance.
 * For the Node.js/WebContainer orchestrator edge, we use an in-memory graph
 * to track relationships dynamically as files change.
 */

export interface ComponentNode {
  id: string; // e.g., 'src/components/ui/button.tsx#Button'
  name: string;
  filePath: string;
  type: 'atom' | 'molecule' | 'organism' | 'layout' | 'hook' | 'page';
  props?: string[]; // Simplified TypeScript prop names extracted via AST
  dependencies: string[]; // Imports used by this component
}

export interface FileNode {
  filePath: string;
  exports: string[];
  imports: { source: string; names: string[] }[];
}

export class CodebaseGraph {
  private files: Map<string, FileNode> = new Map();
  private components: Map<string, ComponentNode> = new Map();

  /**
   * Called by the Indexer Agent every time a file is modified successfully by the Editor Agent
   */
  updateFileIndex(filePath: string, ast: any) {
    console.log(`🔍 [Indexer Agent]: Parsing and updating graph index for ${filePath}...`);
    
    // In actual implementation: use tree-sitter to find ImportDeclarations and ExportDeclarations
    // For now, simulating the indexed node:
    const fileNode: FileNode = {
      filePath,
      exports: ['DummyExport'], // Extract from AST
      imports: [{ source: 'react', names: ['useState'] }] // Extract from AST
    };
    
    this.files.set(filePath, fileNode);
  }

  /**
   * Used by the Reasoner Agent to find all files importing a specific component
   * (e.g., finding all files that use `<Card>` before modifying the Card signature)
   */
  findDependents(targetExportName: string): string[] {
    const dependents: string[] = [];
    for (const [filePath, node] of this.files.entries()) {
       for (const imp of node.imports) {
         if (imp.names.includes(targetExportName)) {
           dependents.push(filePath);
           break;
         }
       }
    }
    return dependents;
  }

  /**
   * Retrieve the UI Registry graph to feed to the Planner/Reasoner
   */
  getComponentRegistrySnapshot() {
     return Array.from(this.components.values());
  }

  registerComponent(component: ComponentNode) {
     this.components.set(component.id, component);
  }
}

export const workspaceGraph = new CodebaseGraph();
