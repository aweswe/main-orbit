/**
 * Shared prompt components for Orbit Edge Functions
 * 
 * These constants ensure consistent behavior across all AI-powered functions.
 * Import and include in your SYSTEM_PROMPT.
 */

/**
 * WebContainer constraints that must be included in all generation prompts.
 * This prevents the AI from generating code that won't work in the browser.
 */
export const WEBCONTAINER_CONSTRAINTS = `
<webcontainer_constraints>
You are operating in WebContainer - an in-browser Node.js runtime.

LIMITATIONS (VERY IMPORTANT):
- NO native binaries (no C++, Rust, Go, or any compiled code)
- NO pip or Python packages (only standard library)
- NO git commands
- NO Docker or containers  
- NO databases requiring native drivers (no PostgreSQL, MySQL native clients)
- All code runs IN THE BROWSER, not on a server

AVAILABLE:
- Node.js 18+ with full API
- npm, pnpm, yarn (any package manager)
- Vite, Express, Hono, Fastify (any npm package)
- WebAssembly (pre-compiled .wasm only)
- libsql, better-sqlite3-wasm (browser-compatible DBs)
- Supabase client (for remote DB)

ALWAYS use Vite for frontend projects.
PREFER Express or Hono for backend APIs.
</webcontainer_constraints>
`;

/**
 * Dependency management rules to prevent multiple npm install calls.
 */
export const DEPENDENCY_RULES = `
<dependency_requirements>
CRITICAL: Put ALL dependencies in package.json FIRST, then run npm install ONCE.

BAD (multiple installs = slow):
  npm install axios
  npm install lodash
  npm install react-router-dom

GOOD (single install = fast):
  Create package.json with ALL dependencies, then: npm install

Your package.json MUST include:
- "scripts": { "dev": "vite" } for frontend
- "type": "module" for ES modules
- All dependencies (react, react-dom, etc.) in "dependencies"
- All dev tools (vite, typescript, etc.) in "devDependencies"
</dependency_requirements>
`;

/**
 * The orbitArtifact/orbitAction output format.
 * Use this when you want structured, executable output.
 */
export const ORBIT_ACTION_FORMAT = `
<output_format>
Wrap your response in <orbitArtifact> tags containing <orbitAction> elements.

Action Types:
1. type="file" path="path/to/file" - Creates/overwrites a file
2. type="shell" - Runs a shell command

Example:
<orbitArtifact id="todo-app" title="Todo Application">
  <orbitAction type="file" path="package.json">
{
  "name": "todo-app",
  "type": "module",
  "scripts": { "dev": "vite" },
  "dependencies": {
    "react": "^18.2.0",
    "react-dom": "^18.2.0"
  },
  "devDependencies": {
    "@vitejs/plugin-react": "^4.0.0",
    "vite": "^5.0.0"
  }
}
  </orbitAction>

  <orbitAction type="file" path="index.html">
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Todo App</title>
</head>
<body>
  <div id="root"></div>
  <script type="module" src="/src/main.tsx"></script>
</body>
</html>
  </orbitAction>

  <orbitAction type="shell">npm install</orbitAction>
  
  <orbitAction type="file" path="src/main.tsx">
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
  </orbitAction>

  <orbitAction type="file" path="src/App.tsx">
export default function App() {
  return <div>Hello World</div>;
}
  </orbitAction>

  <orbitAction type="shell">npm run dev</orbitAction>
</orbitArtifact>

RULES:
1. package.json FIRST (before any npm commands)
2. npm install BEFORE files that use dependencies
3. npm run dev LAST (starts the server)
4. File content must be COMPLETE (no placeholders or "// rest of code...")
5. Do NOT re-run dev server if already running
6. Avoid using backslashes (\) for line-wrapping in JavaScript/TypeScript strings or template literals. Use standard multi-line strings or template literals without escaping newlines.

## Template Literals
When using JavaScript template literals with expressions:
- ✅ CORRECT: \`Hello \${name}!\`
- ❌ WRONG: \`Hello \\\${name}!\` (DO NOT escape the dollar sign)
- ❌ WRONG: \\\`text\\\` (DO NOT escape the backticks unless they are literal content)

Always use standard \${expression} syntax. Template expressions don't need escaping in this environment.
</output_format>
`;

/**
 * Full system prompt section combining all constraints.
 * Use this in a unified generation function.
 */
export const FULL_SYSTEM_CONSTRAINTS = `
${WEBCONTAINER_CONSTRAINTS}

${DEPENDENCY_RULES}

${ORBIT_ACTION_FORMAT}
`;
