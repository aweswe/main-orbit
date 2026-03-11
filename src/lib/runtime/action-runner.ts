import { WebContainer } from '@webcontainer/api';
import { ProjectFile } from '@/types/chat';
import { ParsedError, parseTerminalError } from './error-detector';
import { convertFilesToWebContainerFS } from '@/lib/webcontainer/file-system';
import { ParsedAction } from './streaming-parser';
import { RecoveryManager } from '../recovery/RecoveryManager';
import { validateFile, validateBatch, formatPreFlightLog } from './pre-flight'; // ← NEW
import { applyDependencyFixes, detectPeerConflicts, patchPackageJsonVersions } from './dependency-auditor'; // ← NEW
import { tryLocalPatch } from './local-patch'; // ← AUTO-FIXER

export type ActionStatus = 'pending' | 'running' | 'complete' | 'failed' | 'aborted';

export interface ActionState {
  id: string;
  type: 'file' | 'shell' | 'patch';
  status: ActionStatus;
  description: string;
  error?: string;
  path?: string;
  startTime?: number;
  endTime?: number;
  content?: string; // ← NEW: for state synchronization
}

export interface QueuedAction {
  type: 'file' | 'shell' | 'patch';
  path?: string;
  content: string;
}

interface ActionRunnerCallbacks {
  onStatusChange?: (actionId: string, status: ActionStatus, error?: string) => void;
  onOutput?: (output: string) => void;
  onActionStart?: (action: ActionState) => void;
  onActionComplete?: (action: ActionState) => void;
  onWarning?: (warning: string) => void;
  onErrorDetected?: (error: ParsedError) => void;
  // ── NEW: called when pre-flight blocks a file ──────────────────────────────
  onPreFlightBlock?: (path: string, errors: string[]) => void;
}

export class ActionRunner {
  private webcontainer: WebContainer;
  private actions: Map<string, ActionState> = new Map();
  private callbacks: ActionRunnerCallbacks;
  private recoveryManager = new RecoveryManager();
  private actionIdCounter = 0;

  #executionQueue: Promise<void> = Promise.resolve();
  #devServerProcess: any = null;
  #abortControllers: Map<string, AbortController> = new Map();
  #isCleanedUp = false;

  // ── NEW: tracks all written files for dependency audit before dev server ──
  #writtenFiles: Map<string, string> = new Map();

  private readonly NPM_INSTALL_TIMEOUT = 300000;  // 5min — Next.js has 430+ packages
  private readonly DEV_SERVER_TIMEOUT = 30000;
  private readonly COMMAND_TIMEOUT = 60000;

  constructor(webcontainer: WebContainer, callbacks: ActionRunnerCallbacks = {}) {
    this.webcontainer = webcontainer;
    this.callbacks = callbacks;
  }

  /**
   * Queue an action from the streaming parser.
   *
   * CHANGE: file actions now pass through validateFile() before writeFile().
   * The validated (possibly renamed) path and sanitized content are used.
   * Blocking errors abort the write and call onPreFlightBlock.
   */
  queueAction(action: ParsedAction | QueuedAction): void {
    if (this.#isCleanedUp) {
      this.callbacks.onWarning?.('ActionRunner has been cleaned up. Cannot queue new actions.');
      return;
    }

    const rawPath = (action as any).path || 'unknown';
    const description = action.type === 'file'
      ? `Writing: ${rawPath}`
      : action.type === 'patch'
        ? `Patching: ${rawPath}`
        : `Running: ${action.content.slice(0, 50)}...`;

    const actionId = this.createAction(action.type, description, rawPath);
    const abortController = new AbortController();
    this.#abortControllers.set(actionId, abortController);

    this.#executionQueue = this.#executionQueue
      .then(async () => {
        if (abortController.signal.aborted) {
          this.updateStatus(actionId, 'aborted');
          return;
        }

        const actionState = this.actions.get(actionId);
        if (actionState) {
          actionState.startTime = Date.now();
          this.callbacks.onActionStart?.(actionState);
        }

        this.updateStatus(actionId, 'running');

        try {
          if (action.type === 'file') {
            // ── PRE-FLIGHT GATE ──────────────────────────────────────────────
            const result = validateFile(rawPath, action.content);

            const log = formatPreFlightLog([result]);
            if (log) this.callbacks.onOutput?.(log);

            if (!result.ok) {
              // Blocking error — don't write, surface to auto-healer
              this.callbacks.onPreFlightBlock?.(rawPath, result.blockingErrors);
              this.updateStatus(actionId, 'failed', result.blockingErrors.join('; '));
              return;
            }

            // Use validated (possibly renamed) path and sanitized content
            const finalPath = result.path;
            const finalContent = result.content;

            // Update action description if path changed
            if (finalPath !== rawPath) {
              const state = this.actions.get(actionId);
              if (state) {
                state.description = `Writing: ${finalPath}`;
                state.path = finalPath;
              }
            }

            await this.writeFile(finalPath, finalContent);
            if (actionState) actionState.content = finalContent; // ← NEW
            // Track for dependency audit
            this.#writtenFiles.set(finalPath, finalContent);

            // ── VERSION PATCH for package.json ───────────────────────────────
            const fileName = finalPath.split('/').pop();
            if (fileName === 'package.json') {
              const { patched, changes } = patchPackageJsonVersions(finalContent);
              if (changes.length > 0) {
                this.callbacks.onOutput?.(
                  `\n🔧 version-patcher: Auto-corrected ${changes.length} package version(s):\n` +
                  changes.map(c => `   ✅ ${c}`).join('\n') + '\n'
                );
                await this.writeFile(finalPath, patched);
                this.#writtenFiles.set(finalPath, patched);
              }
            }
            // ── END VERSION PATCH ─────────────────────────────────────────────

          } else if (action.type === 'patch') {
            // ── SURGICAL JSON PATCH ───────────────────────────────────────────
            if (!rawPath || rawPath === 'unknown') {
              throw new Error("Patch action requires a valid 'path' attribute");
            }

            let fileContent = '';
            try {
              fileContent = await this.webcontainer.fs.readFile(rawPath, 'utf8');
            } catch (e) {
              throw new Error(`Cannot patch ${rawPath}: File not found in WebContainer`);
            }

            try {
              const patches = JSON.parse(action.content);
              if (!Array.isArray(patches)) throw new Error("Patch content must be a JSON array");

              let updatedContent = fileContent;
              let appliedCount = 0;

              for (const patch of patches) {
                if (patch.operation === 'replace' && patch.search && patch.replace !== undefined) {
                  if (updatedContent.includes(patch.search)) {
                    // Idempotency check: if the search string is part of the replacement,
                    // check if the full replacement is already there to avoid duplication.
                    if (patch.replace.includes(patch.search) && updatedContent.includes(patch.replace)) {
                      this.callbacks.onWarning?.(`ℹ️ Skipping 'replace' in ${rawPath}: content already matches target.`);
                      appliedCount++; // Count as applied to avoid "No patches applied" error
                      continue;
                    }
                    updatedContent = updatedContent.replace(patch.search, patch.replace);
                    appliedCount++;
                  } else {
                    this.callbacks.onWarning?.(`⚠️ Patch search string not found in ${rawPath}:\n${patch.search.slice(0, 50)}...`);
                  }
                } else if (patch.operation === 'insert' && patch.search && patch.replace) {
                  if (updatedContent.includes(patch.search)) {
                    // Idempotency check: If search + replace is already there, don't re-insert
                    if (updatedContent.includes(patch.search + patch.replace)) {
                      this.callbacks.onWarning?.(`ℹ️ Skipping 'insert' in ${rawPath}: content already exists.`);
                      appliedCount++;
                      continue;
                    }
                    updatedContent = updatedContent.replace(patch.search, patch.search + patch.replace);
                    appliedCount++;
                  }
                } else if (patch.operation === 'delete' && patch.search) {
                  if (updatedContent.includes(patch.search)) {
                    updatedContent = updatedContent.replace(patch.search, '');
                    appliedCount++;
                  }
                }
              }

              if (appliedCount > 0) {
                await this.writeFile(rawPath, updatedContent);
                if (actionState) actionState.content = updatedContent; // ← NEW
                this.#writtenFiles.set(rawPath, updatedContent);
                this.callbacks.onOutput?.(`✅ Applied ${appliedCount} patches to ${rawPath}\n`);
              } else {
                throw new Error("No patches were successfully applied. Search strings may be outdated.");
              }
            } catch (err: any) {
              throw new Error(`Invalid patch JSON for ${rawPath}: ${err.message}`);
            }

          } else if (action.type === 'shell') {
            const cmdText = action.content?.trim();
            if (cmdText) {
              await this.runShellAction(cmdText, abortController.signal);
            } else {
              this.callbacks.onWarning?.('⚠️ Skipping empty shell command.');
            }
          }

          this.updateStatus(actionId, 'complete');
          const finalState = this.actions.get(actionId);
          if (finalState) {
            finalState.endTime = Date.now();
            this.callbacks.onActionComplete?.(finalState);
          }
        } catch (error) {
          const errorMsg = error instanceof Error ? error.message : 'Unknown error';
          console.error(`Action ${actionId} failed:`, error);
          this.updateStatus(actionId, 'failed', errorMsg);
        } finally {
          this.#abortControllers.delete(actionId);
        }
      })
      .catch((error) => {
        console.error('Action queue error:', error);
      });
  }

  /**
   * Mount all project files to WebContainer filesystem.
   *
   * CHANGE: runs validateBatch() across all files before mounting.
   * Renames are reflected in the FS tree. Blocking errors abort the mount.
   */
  async mountFiles(files: ProjectFile[]): Promise<void> {
    const actionId = this.createAction('file', 'Mounting project files');

    try {
      this.updateStatus(actionId, 'running');

      // ── BATCH PRE-FLIGHT ───────────────────────────────────────────────────
      const batchResult = validateBatch(files.map(f => ({ path: f.path, content: f.content })));
      const log = formatPreFlightLog(batchResult.files);
      if (log) this.callbacks.onOutput?.(log);

      if (batchResult.hasBlockingErrors) {
        const allErrors = batchResult.files
          .flatMap(r => r.blockingErrors)
          .join('\n');
        throw new Error(`Pre-flight validation failed:\n${allErrors}`);
      }

      // Rebuild files array with validated paths + content
      const validatedFiles: ProjectFile[] = files.map((f, i) => ({
        ...f,
        path: batchResult.files[i].path,
        content: batchResult.files[i].content,
      }));

      if (batchResult.renames.size > 0) {
        this.callbacks.onOutput?.(
          `🔄 Pre-flight renamed ${batchResult.renames.size} file(s):\n` +
          Array.from(batchResult.renames.entries())
            .map(([o, n]) => `   ${o} → ${n}`)
            .join('\n') + '\n'
        );
      }
      // ── END BATCH PRE-FLIGHT ───────────────────────────────────────────────

      const fsTree = convertFilesToWebContainerFS(validatedFiles);
      await this.webcontainer.mount(fsTree);

      // Track all mounted files for dependency audit
      for (const f of validatedFiles) {
        this.#writtenFiles.set(f.path, f.content);
      }

      this.callbacks.onOutput?.(`✅ Mounted ${validatedFiles.length} files to WebContainer\n`);
      this.updateStatus(actionId, 'complete');
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      this.callbacks.onOutput?.(`❌ Failed to mount files: ${errorMsg}\n`);
      this.updateStatus(actionId, 'failed', errorMsg);
      throw error;
    }
  }

  /**
   * Write a single file to WebContainer.
   * Note: pre-flight validation happens BEFORE this is called (in queueAction/mountFiles).
   * This method writes the already-validated content.
   */
  async writeFile(path: string, content: string): Promise<void> {
    const dir = path.split('/').slice(0, -1).join('/');
    if (dir) {
      try {
        await this.webcontainer.fs.mkdir(dir, { recursive: true });
      } catch {
        // Directory might already exist
      }
    }
    await this.webcontainer.fs.writeFile(path, content);
  }

  // ─── Shell execution (unchanged from original) ────────────────────────────

  private async runShellAction(command: string, signal?: AbortSignal): Promise<number> {
    this.callbacks.onOutput?.(`$ ${command}\n`);

    const isDevCommand = command.includes('npm run dev') || command.includes('npm start');

    // ── ROADMAP 4: Self-Correcting UI Tests ──
    const isTestCommand = command.includes('vitest') || command.includes('npm run test');
    const isLongRunningProcess = isDevCommand || isTestCommand;

    if (isDevCommand && this.#devServerProcess) {
      this.callbacks.onWarning?.('⚠️ Dev server already running, skipping restart...');
      return 0;
    }

    if (isDevCommand || isTestCommand) {
      try {
        await this.webcontainer.fs.readdir('node_modules');
      } catch {
        this.callbacks.onOutput?.('📦 node_modules missing, running npm install first...\n');
        try {
          const exitCode = await this.runShellCommandInternal('npm', ['install'], this.NPM_INSTALL_TIMEOUT, signal);
          if (exitCode !== 0) throw new Error(`npm install failed with exit code ${exitCode}`);
          this.callbacks.onOutput?.('✅ Dependencies installed, proceeding to dev server...\n');
        } catch (error) {
          throw new Error(`Dependency installation failed: ${error instanceof Error ? error.message : String(error)}`);
        }
      }

      // ── DEPENDENCY AUDIT: catch missing packages before Vite starts ────────
      // Runs even if node_modules exists (LLM may add new imports in edits)
      if (this.#writtenFiles.size > 0) {
        const allFiles = Array.from(this.#writtenFiles.entries()).map(([path, content]) => ({ path, content }));
        await applyDependencyFixes(allFiles, {
          writeFile: (p, c) => this.writeFile(p, c),
          runInstall: async (cmd) => {
            const parts = cmd.trim().split(/\s+/);
            return this.runShellCommandInternal(parts[0], parts.slice(1), this.NPM_INSTALL_TIMEOUT, signal);
          },
          onOutput: this.callbacks.onOutput,
        });
      }
      // ── END DEPENDENCY AUDIT ───────────────────────────────────────────────
    }

    const parts = command.trim().split(/\s+/);
    const cmd = parts[0];
    const args = parts.slice(1);
    const timeout = isLongRunningProcess ? this.DEV_SERVER_TIMEOUT : this.COMMAND_TIMEOUT;
    return this.runShellCommandInternal(cmd, args, timeout, signal, isLongRunningProcess);
  }

  private async runShellCommandInternal(
    cmd: string,
    args: string[],
    timeoutMs: number,
    signal?: AbortSignal,
    isLongRunningProcess = false
  ): Promise<number> {
    return Promise.race([
      this.executeCommand(cmd, args, isLongRunningProcess),
      this.createTimeoutPromise(timeoutMs, `Command timeout: ${cmd} ${args.join(' ')}`),
      signal ? this.createAbortPromise(signal) : new Promise<never>(() => { }),
    ]);
  }

  private async executeCommand(cmd: string, args: string[], isLongRunningProcess = false): Promise<number> {
    const process = await this.webcontainer.spawn(cmd, args);
    const isDevServerCommand = cmd === 'npm' && args.includes('dev');
    if (isDevServerCommand) this.#devServerProcess = process;

    let outputBuffer = '';
    let throttleTimer: any = null;

    process.output.pipeTo(new WritableStream({
      write: async (data) => {
        this.callbacks.onOutput?.(data);
        if (isLongRunningProcess && this.callbacks.onErrorDetected) {
          outputBuffer += data;
          if (!throttleTimer) {
            throttleTimer = setTimeout(async () => {
              const detectedError = parseTerminalError(outputBuffer);
              if (detectedError) {
                console.log('[Auto-Heal] Detected Terminal Error:', detectedError);
                // ── TRY LOCAL PATCH FIRST ──
                if (detectedError.file) {
                  try {
                    const filePath = detectedError.file;
                    const fileContent = await this.webcontainer.fs.readFile(filePath, 'utf-8');
                    const patched = tryLocalPatch(fileContent, detectedError.message || outputBuffer);
                    if (patched) {
                      await this.webcontainer.fs.writeFile(filePath, patched);
                      console.log(`[Auto-Heal] Patched ${filePath} locally — no LLM call needed`);
                      this.callbacks.onOutput?.(`\n✅ auto-healed: ${filePath} (local patch applied)\n`);
                      outputBuffer = '';
                      throttleTimer = null;
                      return; // Skip escalation
                    }
                  } catch (e) {
                    // File read failed, fall through to LLM escalation
                  }
                }
                this.callbacks.onErrorDetected?.(detectedError);
                outputBuffer = '';
              }
              if (outputBuffer.length > 10000) outputBuffer = outputBuffer.slice(-5000);
              throttleTimer = null;
            }, 1000);
          }
        }
      },
    }));

    if (isDevServerCommand) return 0; // return immediately for the main dev server
    return await process.exit;
  }

  private createTimeoutPromise(ms: number, errorMessage: string): Promise<never> {
    return new Promise((_, reject) => setTimeout(() => reject(new Error(errorMessage)), ms));
  }

  private createAbortPromise(signal: AbortSignal): Promise<never> {
    return new Promise((_, reject) => {
      if (signal.aborted) reject(new Error('Operation aborted'));
      signal.addEventListener('abort', () => reject(new Error('Operation aborted')));
    });
  }

  // ─── Boot sequence (unchanged) ────────────────────────────────────────────

  async runBootSequence(files: ProjectFile[]): Promise<boolean> {
    try {
      this.recoveryManager.reset();

      this.callbacks.onOutput?.('\n📁 Step 1/3: Mounting project files...\n');
      const mountOk = await this.runCheckpoint('mount', async () => {
        await this.mountFiles(files);
      }, files);
      if (!mountOk) return false;

      this.callbacks.onOutput?.('\n📦 Step 2/3: Installing dependencies...\n');
      const installOk = await this.runCheckpoint('npm-install', async () => {
        const exitCode = await this.runShellCommand('npm', ['install']);
        if (exitCode !== 0) throw new Error(`npm install failed with code ${exitCode}`);
      }, files, { isCritical: true });
      if (!installOk) return false;

      this.callbacks.onOutput?.('\n🚀 Step 3/3: Starting development server...\n');
      const bootOk = await this.runCheckpoint('dev-server', async () => {
        const devProcess = await this.webcontainer.spawn('npm', ['run', 'dev']);
        devProcess.output.pipeTo(new WritableStream({ write: (data) => this.callbacks.onOutput?.(data) }));
        this.#devServerProcess = devProcess;
      }, files);

      if (bootOk) this.callbacks.onOutput?.('\n✅ Boot sequence complete!\n');
      return bootOk;
    } catch (error) {
      this.callbacks.onOutput?.(`\n❌ Boot sequence failed: ${error instanceof Error ? error.message : 'Unknown error'}\n`);
      return false;
    }
  }

  async runShellCommand(command: string, args: string[] = []): Promise<number> {
    const fullCommand = `${command} ${args.join(' ')}`.trim();
    const actionId = this.createAction('shell', `Running: ${fullCommand}`);
    try {
      this.updateStatus(actionId, 'running');
      this.callbacks.onOutput?.(`$ ${fullCommand}\n`);
      const process = await this.webcontainer.spawn(command, args);
      process.output.pipeTo(new WritableStream({ write: (data) => this.callbacks.onOutput?.(data) }));
      const exitCode = await process.exit;
      if (exitCode === 0) {
        this.callbacks.onOutput?.(`✅ Command completed successfully\n`);
        this.updateStatus(actionId, 'complete');
      } else {
        this.callbacks.onWarning?.(`⚠️ Command exited with code ${exitCode}`);
        this.updateStatus(actionId, 'failed', `Exit code: ${exitCode}`);
      }
      return exitCode;
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      this.callbacks.onOutput?.(`❌ Command failed: ${errorMsg}\n`);
      this.updateStatus(actionId, 'failed', errorMsg);
      throw error;
    }
  }

  private async runCheckpoint(
    name: string,
    action: () => Promise<void>,
    files: ProjectFile[],
    options: { isCritical?: boolean } = {}
  ): Promise<boolean> {
    try {
      await action();
      return true;
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      this.callbacks.onWarning?.(`⚠️ Checkpoint [${name}] failed: ${errorMsg}`);
      const result = await this.recoveryManager.attemptRecovery(errorMsg, files, this);
      if (result.recovered) {
        this.callbacks.onOutput?.(`✅ Recovery successful: ${result.message}\n`);
        if (result.appliedFix?.action === 'retry-with-flags' && result.appliedFix.newCommand) {
          this.callbacks.onOutput?.(`🔄 Retrying with: ${result.appliedFix.newCommand}\n`);
          try {
            const parts = result.appliedFix.newCommand.trim().split(/\s+/);
            const exitCode = await this.runShellCommand(parts[0], parts.slice(1));
            return exitCode === 0;
          } catch {
            return false;
          }
        }
        return true;
      }
      return false;
    }
  }

  // ─── Resource management (unchanged) ─────────────────────────────────────

  abortAction(actionId: string): void {
    const controller = this.#abortControllers.get(actionId);
    if (controller) {
      controller.abort();
      this.updateStatus(actionId, 'aborted');
    }
  }

  abortAll(): void {
    this.#abortControllers.forEach(c => c.abort());
    this.#abortControllers.clear();
  }

  async cleanup(): Promise<void> {
    if (this.#isCleanedUp) return;
    this.#isCleanedUp = true;
    this.abortAll();
    if (this.#devServerProcess) {
      try { this.#devServerProcess.kill?.(); } catch { }
      this.#devServerProcess = null;
    }
    this.actions.clear();
  }

  getActions(): ActionState[] { return Array.from(this.actions.values()); }
  getActionById(id: string): ActionState | undefined { return this.actions.get(id); }

  private createAction(type: 'file' | 'shell' | 'patch', description: string, path?: string): string {
    const id = `action-${++this.actionIdCounter}`;
    this.actions.set(id, { id, type, status: 'pending', description, path });
    return id;
  }

  private updateStatus(actionId: string, status: ActionStatus, error?: string): void {
    const action = this.actions.get(actionId);
    if (action) {
      action.status = status;
      if (error) action.error = error;
      this.callbacks.onStatusChange?.(actionId, status, error);
    }
  }
}
