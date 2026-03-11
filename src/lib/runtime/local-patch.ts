/**
 * tryLocalPatch — Runtime auto-fixer for common LLM code generation errors.
 * 
 * Runs AFTER code is generated, catches known error patterns, and applies
 * regex-based fixes without needing another LLM call.
 * 
 * Returns the patched file content if a fix was applied, or null if no fix was found.
 */

export function tryLocalPatch(fileContent: string, errorMessage: string): string | null {
  let patched = fileContent;
  let didPatch = false;

  // ─── Fix: Framer Motion cubic-bezier string → number array ───
  if (
    errorMessage.includes('Invalid easing') ||
    errorMessage.includes('easing type') ||
    errorMessage.includes('cubic-bezier')
  ) {
    // Convert CSS cubic-bezier strings to framer-motion number arrays
    const before = patched;
    patched = patched
      .replace(
        /ease:\s*["']cubic-bezier\(([^)]+)\)["']/g,
        (_, vals) => `ease: [${vals}]`
      )
      // Convert CSS easing names to framer-motion names
      .replace(/ease:\s*["']ease-in-out["']/g, 'ease: "easeInOut"')
      .replace(/ease:\s*["']ease-out["']/g, 'ease: "easeOut"')
      .replace(/ease:\s*["']ease-in["']/g, 'ease: "easeIn"')
      .replace(/ease:\s*["']ease["']/g, 'ease: "easeInOut"');
    if (patched !== before) {
      didPatch = true;
      console.log('[tryLocalPatch] Fixed framer-motion easing strings');
    }
  }

  // ─── Fix: Double slashes in router paths ───
  if (
    errorMessage.includes('double slash') ||
    errorMessage.includes('//') ||
    errorMessage.includes('No routes matched')
  ) {
    const before = patched;
    patched = patched
      // Remove trailing slashes from route path definitions
      .replace(/path="\/([^"]+)\/"/g, 'path="/$1"')
      // Fix double slashes in template literals
      .replace(/\/\//g, (match, offset, str) => {
        // Don't touch protocol double slashes (https://)
        if (offset > 0 && str[offset - 1] === ':') return match;
        return '/';
      });
    if (patched !== before) {
      didPatch = true;
      console.log('[tryLocalPatch] Fixed double slashes in router paths');
    }
  }

  // ─── Fix: BrowserRouter missing future flags ───
  if (errorMessage.includes('v7_startTransition') || errorMessage.includes('v7_relativeSplatPath')) {
    const before = patched;
    patched = patched.replace(
      /<BrowserRouter>/g,
      '<BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>'
    );
    if (patched !== before) {
      didPatch = true;
      console.log('[tryLocalPatch] Added BrowserRouter future flags');
    }
  }

  // ─── Fix: @lucide/react → lucide-react (wrong package name) ───
  if (errorMessage.includes('@lucide/react') || errorMessage.includes('Cannot find module')) {
    const before = patched;
    patched = patched
      .replace(/@lucide\/react/g, 'lucide-react');
    if (patched !== before) {
      didPatch = true;
      console.log('[tryLocalPatch] Fixed @lucide/react → lucide-react');
    }
  }

  // ─── Fix: process.env → import.meta.env ───
  if (errorMessage.includes('process is not defined') || errorMessage.includes('process.env')) {
    const before = patched;
    patched = patched
      .replace(/process\.env\.(\w+)/g, 'import.meta.env.VITE_$1');
    if (patched !== before) {
      didPatch = true;
      console.log('[tryLocalPatch] Fixed process.env → import.meta.env');
    }
  }

  // ─── Fix: module.exports → export default (ESM enforcement) ───
  if (errorMessage.includes('module is not defined') || errorMessage.includes('module.exports')) {
    const before = patched;
    patched = patched
      .replace(/module\.exports\s*=\s*/g, 'export default ');
    if (patched !== before) {
      didPatch = true;
      console.log('[tryLocalPatch] Fixed module.exports → export default');
    }
  }

  return didPatch ? patched : null;
}
