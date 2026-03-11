/**
 * determinism-constraints.ts
 *
 * Hard constraints injected into every LLM system prompt in Orbit.
 * These prevent the exact class of bugs seen in the logs at generation time,
 * so pre-flight.ts is a safety net, not the first line of defense.
 *
 * Usage in llm.ts:
 *   import { DETERMINISM_BLOCK } from './determinism-constraints';
 *   // Append to SYSTEM_PROMPT and EDITOR_SYSTEM_PROMPT
 */

/**
 * Core block appended to ALL prompts.
 * Written as explicit numbered rules the LLM can follow literally.
 */
export const DETERMINISM_BLOCK = `
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
CRITICAL CODE GENERATION RULES — FOLLOW EXACTLY
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

FILE EXTENSIONS — NON-NEGOTIABLE:
1. Any file that contains JSX (angle-bracket tags, fragments <>, React components) MUST use .tsx extension, never .ts
2. Any file that contains JSX and is JavaScript MUST use .jsx, never .js
3. A file named useStore.ts that renders <>{children}</> MUST be named useStore.tsx
4. Rule: if you write <, check the file extension. .ts → rename to .tsx before writing.

REGEX LITERALS — WRITE EXACTLY AS SHOWN:
5. Write regex as: /\/tasks\// (single backslash before each forward slash)
6. NEVER write: /\\/tasks\\// (double backslash is WRONG — it is not a valid regex flag)
7. The pattern is: forward slash in regex = backslash + forward slash = \/
8. Test your regex mentally: /\/tasks\// matches the string "/tasks/" — if yours does not, it is wrong.

TEMPLATE LITERALS AND STRINGS:
9. Inside template literals (backtick strings), write newlines as \\n (two chars: backslash + n)
10. NEVER double-escape: \\\\n is wrong inside template literals
11. Regular string escape sequences are fine: "line1\\nline2"

FILE COMPLETENESS:
12. NEVER truncate file content with comments like "// ... (truncated)" or "// ... more"
13. Every file must be complete and syntactically valid before output
14. If a file would be too long, split it into smaller files rather than truncating

IMPORT CONSISTENCY:
15. When you name a file useStore.tsx, import it as: from './useStore' (no extension needed)
16. When you rename a .ts file to .tsx, update ALL import statements for that file in other files

PACKAGE.JSON — ALL IMPORTS MUST BE DECLARED:
17. Every npm package you import in ANY file MUST appear in package.json dependencies
18. Before writing any component, check: is this package in the package.json I already wrote?
19. If you use @dnd-kit/core, recharts, framer-motion, zustand, or ANY third-party library
    in code, it MUST be in package.json — no exceptions
20. NEVER use react-beautiful-dnd (deprecated). Use @dnd-kit/core + @dnd-kit/sortable instead.

PEER DEPENDENCY VERSION PINNING — CRITICAL:
21. @dnd-kit/sortable@^6 REQUIRES @dnd-kit/core@^5 (NOT ^6). Always use:
    "@dnd-kit/core": "^5.0.2"  +  "@dnd-kit/sortable": "^6.0.1"  +  "@dnd-kit/utilities": "^3.2.1"
22. NEVER write "@dnd-kit/core": "^6.x.x" with "@dnd-kit/sortable": "^6.x.x" — this will fail.
23. When in doubt about peer deps, use EXACT versions from this table:
    recharts: "^2.10.0" | zustand: "^4.4.0" | framer-motion: "^10.16.0"
    @tanstack/react-query: "^4.36.1" | zod: "^3.22.0" | lucide-react: "^0.290.0"

PACKAGE.JSON DEPENDENCY NAMES:
34. ONLY use base package names in the "dependencies" and "devDependencies" objects.
35. NEVER include sub-paths like "zustand/middleware" or "lucide-react/icons".
36. WRONG: "zustand/middleware": "^4.4.0"
37. CORRECT: "zustand": "^4.4.0"

VITE HMR CONFIG — CRITICAL:
38. In vite.config.ts, the HMR clientPort MUST be 443.
39. CORRECT:
    server: {
      hmr: {
        clientPort: 443
      }
    }
40. NEVER use port 8081 or any other port for HMR.

CSS IMPORT ORDER — CRITICAL:
49. ANY @import statements (e.g., Google Fonts, Tailind layers) MUST be at the very top of the CSS file.
50. NEVER place @import after other CSS rules, comments that aren't @charset, or selectors.
51. Rule: If you add an @import, it goes on LINE 1 (or immediately after @charset).

@TANSTACK/REACT-QUERY — USE v4 API ONLY:
28. The installed version is @tanstack/react-query@^4. Use v4 call signatures ONLY.
29. CORRECT v4 useQuery syntax:
      useQuery(['key'], fetchFn)
      useQuery(['key', id], () => fetch(id))
      useQuery({ queryKey: ['key'], queryFn: fetchFn })   ← object form also valid in v4
30. WRONG — v5 syntax that will crash at runtime:
      useQuery({ queryKey: [...], queryFn: ... })  ← ONLY wrong if you forget queryFn
      DO NOT use: useQuery(queryKey, queryFn, options) is still fine in v4
31. useMutation v4 syntax: useMutation(mutationFn, { onSuccess, onError })
    NOT v5: useMutation({ mutationFn, onSuccess })
32. useInfiniteQuery v4: useInfiniteQuery(['key'], fetchFn, { getNextPageParam })

MOCKING EXTERNAL APIS — CRITICAL FOR BOOT:
41. NEVER generate code that calls third-party APIs requiring secret keys (TMDB, Spotify, OpenAI, etc.) unless the user explicitly provided the key in the prompt.
42. If an app requires a third-party API → generate **realistic mock data** that matches the real API's response shape exactly.
43. Structure your code so swapping mock → real only requires changing one import or a single boolean flag.
44. NEVER hardcode fake API keys or placeholder strings like "YOUR_API_KEY_HERE" which cause 401/403 errors at runtime.

STRICT FILE CONVENTIONS (.ts vs .tsx):
45. Logic-only files (stores, api, utils, types, hooks WITHOUT JSX) MUST use the .ts extension.
46. ONLY use .tsx if the file actually contains React JSX/TSX elements (<... />).
47. Rule: If you name a file src/store.ts, and it has no tags, it STAYS .ts. Do not "play it safe" with .tsx.

NEXT.JS CONFIG — CJS FORMAT ONLY:
48. next.config.js must use CommonJS: module.exports = { ... }
    NEVER use: import { defineConfig } from 'next' — this does not exist
    NEVER use: export default defineConfig(...) in next.config.js
    CORRECT:
      /** @type {import('next').NextConfig} */
      const nextConfig = { reactStrictMode: true };
      module.exports = nextConfig;

LUCIDE-REACT — ONLY ICONS, NO UI COMPONENTS:
25. lucide-react exports ONLY icon components. Never import Card, Button, Badge, Avatar,
    Dialog, Modal, Spinner, or any UI component from lucide-react.
26. Correct icon names: Loader → Loader2, Close → X, Delete → Trash2, Edit → Pencil,
    Add → Plus, More → MoreHorizontal, Refresh → RefreshCw, Warning → AlertTriangle,
    Error → AlertCircle, Success → CheckCircle, Sort → ArrowUpDown, Grid → Grid3X3
27. UI components (Card, Button, Badge) come from shadcn/ui or @radix-ui, NOT lucide-react.
24. @/ prefix is a path alias (maps to src/), NOT an npm package. Never add @/hooks, @/components,
    @/lib etc. to package.json. They are resolved by TypeScript/Vite, not npm.


VALIDATION CHECKLIST (run mentally before each file):
  [ ] Does this file contain JSX? → Must be .tsx/.jsx
  [ ] Does this file contain a regex with forward slashes? → Use \/ not \\/
  [ ] Is this file complete (no truncation markers)?
  [ ] Do all imports match the actual file names I'm generating?
  [ ] Is every npm package I import listed in the package.json I already wrote?
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`;

/**
 * Lighter version for the editor prompt (editCodeLocal).
 * Focuses on the patch-specific failure modes.
 */
export const EDITOR_DETERMINISM_BLOCK = `
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
CODE EDITING RULES — REQUIRED
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
1. If your patch adds JSX to a .ts file, also rename the file to .tsx in the patch's "file" field
2. Regex with forward slashes: use \\/ not \\\\/  (single backslash, not double)
3. Search strings in patches must match the current file EXACTLY — whitespace, indentation, and all
4. Never use truncation markers like "// ..." in replace values
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`;

/**
 * Helper: append determinism block to any prompt string.
 * Use this instead of string concatenation so it's easy to find/update.
 */
export function withDeterminism(prompt: string, variant: 'full' | 'editor' = 'full'): string {
    return prompt + (variant === 'editor' ? EDITOR_DETERMINISM_BLOCK : DETERMINISM_BLOCK);
}
