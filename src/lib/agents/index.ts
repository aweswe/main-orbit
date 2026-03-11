import { generateObject } from 'ai';
import { z } from 'zod';
import { getModel } from '../llm'; // Abstract LLM getter logic
import { ASTPatch } from '../ast/engine';

/**
 * 1. PLANNER AGENT
 * Translates intent into a strict, acyclic graph of execution steps.
 */
export const PlannerAgent = {
  async plan(prompt: string, currentContext: string) {
    console.log('🤖 [Planner Agent]: Synthesizing execution graph...');
    const result = await generateObject({
      model: getModel(),
      system: 'You are the Planner Agent. Decompose user requests into strict execution sequences. Do NOT generate code.',
      prompt: `Prompt: ${prompt}\n\nContext:\n${currentContext}`,
      schema: z.object({
        tasks: z.array(z.object({
          id: z.string(),
          type: z.enum(['install_dependency', 'add_file', 'edit_file', 'supabase_migration']),
          description: z.string(),
          target_file: z.string().optional()
        }))
      })
    });
    return result.object.tasks;
  }
};

/**
 * 2. REASONER AGENT
 * Takes a specific task, queries the Codebase Awareness graph, and outputs a UI Composition Graph 
 * instead of raw React components, ensuring components strictly align with Shadcn/Registry.
 */
export const ReasonerAgent = {
  async constructCompositionGraph(task: any, uiRegistrySchema: any) {
    console.log(`🧠 [Reasoner Agent]: Finding layout dependencies for ${task.id}...`);
    // Output a Component Composition Graph instead of raw arbitrary strings
    const result = await generateObject({
        model: getModel(),
        system: 'You are the Reasoner Agent. Construct logical Component Composition Graphs using ONLY registered UI atoms/molecules. Output the graph, do NOT output formatting/JSX raw strings.',
        prompt: `Create a composition graph for: ${task.description}. Registry: ${JSON.stringify(uiRegistrySchema)}`,
        schema: z.object({
            type: z.literal('composition_graph'),
            root: z.any() // Simplified tree structure of { component: 'Button', props: {...}, children: [...] }
        })
    });
    return result.object;
  }
};

/**
 * 3. EDITOR AGENT
 * Executes edits mathematically via AST patches against tree-sitter, avoiding diff-based hallucination.
 */
export const EditorAgent = {
  async generatePatch(targetFilePath: string, currentFileAST: string, instruction: string): Promise<ASTPatch> {
    console.log(`📝 [Editor Agent]: Formulating surgical tree-sitter JSON patch for ${targetFilePath}...`);
    const result = await generateObject({
      model: getModel(),
      system: 'You are the Editor Agent. Do not output raw strings. Output JSON schema patches (INSERT_NODE, UPDATE_PROP, DELETE_BLOCK) mapping directly to physical Abstract Syntax Tree manipulation vectors.',
      prompt: `Target: ${targetFilePath}\nAST:\n${currentFileAST}\n\nInstruction: ${instruction}`,
      schema: z.object({
        version: z.literal('1.0'),
        file: z.string(),
        operations: z.array(z.object({
            type: z.union([z.literal('INSERT_NODE'), z.literal('UPDATE_PROP'), z.literal('MODIFY_IMPORT'), z.literal('DELETE_BLOCK')]),
            path: z.string(),
            position: z.number().optional(),
            content: z.string().optional(),
            value: z.string().optional(),
            importName: z.string().optional(),
            action: z.enum(['add', 'remove']).optional(),
        }))
      })
    });
    return result.object as ASTPatch;
  }
};
