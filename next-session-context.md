# Orbit 2.0 - Next.js Migration Architecture Context
*Date: February 2026*

## Current System State
Orbit has just been successfully migrated from a Client-Side Rendered (CSR) Vite application to a **Next.js 14 (App Router)** Server-Side Rendered (SSR) application. The production build passes with `Exit Code 0`.

### Key Architectural Changes:
1. **WebContainer SSR Isolation:**
   - WebContainers and `xterm.js` require strict browser environments (`SharedArrayBuffer`). 
   - We updated `next.config.mjs` to inject `Cross-Origin-Embedder-Policy: require-corp` and `Cross-Origin-Opener-Policy: same-origin`.
   - All interactive IDE components (`Terminal.tsx`, `ProjectWorkspace.tsx`, processing hooks) are heavily fortified with Next.js `"use client"` directives.
2. **React Context Migration:**
   - Shadcn UI Vite providers (`Toaster`, `TooltipProvider`, `Sonner`) were crashing the Next.js `layout.tsx` SSR compiler because they use `useState` internally without `"use client"`.
   - We created `app/providers.tsx` with `"use client"` at the top. This acts as the global boundary that `app/layout.tsx` imports.
3. **Typescript Upgrade:**
   - We removed deprecated Vite configs (`tsconfig.app.json`, `tsconfig.node.json`, `vite.config.ts`, `vitest.config.ts`).
   - We updated `tsconfig.json` to target `"es2020"` to support the private class fields (`#executionQueue`) used inside `src/lib/runtime/action-runner.ts` and enabled `"downlevelIteration": true` for the AST Map/Set iteration.
4. **Environment Variables:**
   - All Vite-era `import.meta.env.VITE_...` calls were migrated to Next.js `process.env.NEXT_PUBLIC_...` format (specifically in `llm.ts` and `supabase/client.ts`).
   - `react-router-dom` was completely removed, and `NavLink.tsx` was rewritten to wrap Next.js `<Link>`.

## Current Auto-Healing Engine (The Brain)
All of the logic that makes Orbit powerful remained untouched in `src/lib/`. 
The Next session agent should study these files if touching the LLM engine:

1. `src/lib/context/workspace-context.ts`: RAG-lite system that token-packs the WebContainer file tree, scoring files by relevance.
2. `src/lib/runtime/action-runner.ts`: Handles the WebContainer `spawn` sequences. It pipes the Terminal streams into `terminal-service.ts`.
3. `src/lib/runtime/error-detector.ts`: The Regex engine that intercepts TS, Vite, and NPM install (`ETARGET`, `E404`) errors from the terminal stream, passing them back to `useChat.ts` for silent healing.
4. `src/lib/determinism-constraints.ts`: A massive string array of hard system prompts injected into Groq to force the LLM to output valid syntax (blocks CommonJS `require()`, forces `.tsx` extensions).
5. `src/lib/runtime/pre-flight.ts`: The gatekeeper. Just before writing files to the WebContainer, this intercepts them, strips hallucinated `lucide-react` Brand icons, fixes `.ts` extensions with JSX inside them, and blocks double-escaped regex strings.
6. `src/lib/runtime/dependency-auditor.ts`: Intercepts `package.json` writes, parses all `import { x } from 'y'` statements in the generated code, and forces a silent `npm install` sequence to download hallucinated packages before starting the Vite dev server.

## Next Steps for the New Agent
1. The user wants to run the project. You can safely trigger `npm run dev` to boot the newly migrated Next.js application.
2. Ensure the WebContainer still boots cleanly within the Next.js iframe wrapper.
3. Begin working on the Future AI Planner Roadmap (documented in `README.md`).
