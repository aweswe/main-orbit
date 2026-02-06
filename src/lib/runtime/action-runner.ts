import { WebContainer } from '@webcontainer/api';
import { ProjectFile } from '@/types/chat';
import { convertFilesToWebContainerFS } from '@/lib/webcontainer/file-system';
import { ParsedAction } from './streaming-parser';
import { RecoveryManager } from '../recovery/RecoveryManager';

export type ActionStatus = 'pending' | 'running' | 'complete' | 'failed' | 'aborted';

export interface ActionState {
  id: string;
  type: 'file' | 'shell';
  status: ActionStatus;
  description: string;
  error?: string;
  path?: string;  // For file actions
  startTime?: number;
  endTime?: number;
}

export interface QueuedAction {
  type: 'file' | 'shell';
  path?: string;
  content: string;
}

interface ActionRunnerCallbacks {
  onStatusChange?: (actionId: string, status: ActionStatus, error?: string) => void;
  onOutput?: (output: string) => void;
  onActionStart?: (action: ActionState) => void;
  onActionComplete?: (action: ActionState) => void;
  onWarning?: (message: string) => void;
}

/**
 * Improved ActionRunner with:
 * - Critical error handling (aborts boot if npm install fails)
 * - Dependency validation
 * - Resource cleanup
 * - Timeout support
 * - Sequential execution (Bolt-style)
 */
export class ActionRunner {
  private webcontainer: WebContainer;
  private actions: Map<string, ActionState> = new Map();
  private callbacks: ActionRunnerCallbacks;
  private recoveryManager = new RecoveryManager();
  private actionIdCounter = 0;

  // Action queue for sequential execution
  #executionQueue: Promise<void> = Promise.resolve();
  #devServerProcess: any = null;
  #abortControllers: Map<string, AbortController> = new Map();
  #isCleanedUp = false;

  private readonly NPM_INSTALL_TIMEOUT = 300000; // 5 minutes
  private readonly DEV_SERVER_TIMEOUT = 60000;   // 1 minute startup
  private readonly COMMAND_TIMEOUT = 120000;     // 2 minutes default

  #hasFailedCriticalAction = false;

  constructor(webcontainer: WebContainer, callbacks: ActionRunnerCallbacks = {}) {
    this.webcontainer = webcontainer;
    this.callbacks = callbacks;
  }

  /**
   * Queue an action from the streaming parser.
   * Actions are executed sequentially in FIFO order.
   */
  queueAction(action: ParsedAction | QueuedAction): void {
    if (this.#isCleanedUp) {
      this.callbacks.onWarning?.('ActionRunner has been cleaned up. Cannot queue new actions.');
      return;
    }

    const description = action.type === 'file'
      ? `Writing: ${(action as any).path || 'unknown'}`
      : `Running: ${action.content.slice(0, 50)}...`;

    const actionId = this.createAction(action.type, description, (action as any).path);
    const abortController = new AbortController();
    this.#abortControllers.set(actionId, abortController);

    this.#executionQueue = this.#executionQueue
      .then(async () => {
        if (this.#hasFailedCriticalAction) {
          this.updateStatus(actionId, 'aborted', 'Previous critical action failed');
          return;
        }

        // Check if abort was requested
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
            await this.writeFile((action as any).path || 'unknown', action.content);
          } else if (action.type === 'shell') {
            await this.runShellAction(action.content, abortController.signal);
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

          // Mark as failed critical action if it's npm install
          if (description.toLowerCase().includes('npm install')) {
            this.#hasFailedCriticalAction = true;
          }
        } finally {
          this.#abortControllers.delete(actionId);
        }
      })
      .catch((error) => {
        console.error('Action queue error:', error);
      });
  }

  /**
   * Run a shell command with timeout and abort support
   */
  private async runShellAction(command: string, signal?: AbortSignal): Promise<number> {
    this.callbacks.onOutput?.(`$ ${command}\n`);

    const isDevCommand = command.includes('npm run dev') || command.includes('npm start');
    if (isDevCommand && this.#devServerProcess) {
      this.callbacks.onWarning?.('⚠️ Dev server already running, skipping restart...');
      return 0;
    }

    // Auto-install if node_modules is missing and this is a dev command
    if (isDevCommand) {
      try {
        await this.webcontainer.fs.readdir('node_modules');
      } catch {
        this.callbacks.onOutput?.('📦 node_modules missing, running npm install first...\n');

        try {
          const exitCode = await this.runShellCommandInternal('npm', ['install'], this.NPM_INSTALL_TIMEOUT, signal);
          if (exitCode !== 0) {
            const error = `❌ Pre-requisite npm install failed with exit code ${exitCode}`;
            this.callbacks.onWarning?.(error);
            throw new Error(error);
          }
          this.callbacks.onOutput?.('✅ Dependencies installed, proceeding to dev server...\n');
        } catch (error) {
          throw new Error(`Dependency installation failed: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
    }

    // Parse command into parts
    const parts = command.trim().split(/\s+/);
    const cmd = parts[0];
    const args = parts.slice(1);

    const timeout = isDevCommand ? this.DEV_SERVER_TIMEOUT : this.COMMAND_TIMEOUT;
    return this.runShellCommandInternal(cmd, args, timeout, signal, isDevCommand);
  }

  /**
   * Internal shell command execution with timeout and signal support
   */
  private async runShellCommandInternal(
    cmd: string,
    args: string[],
    timeoutMs: number,
    signal?: AbortSignal,
    isDevServer = false
  ): Promise<number> {
    const process = await this.webcontainer.spawn(cmd, args);

    if (isDevServer) {
      this.#devServerProcess = process;
    }

    // Stream output
    process.output.pipeTo(
      new WritableStream({
        write: (data) => {
          this.callbacks.onOutput?.(data);
        },
      })
    );

    const timeoutPromise = isDevServer ? new Promise<never>(() => { }) : new Promise<never>((_, reject) => {
      const timer = setTimeout(() => {
        process.kill();
        reject(new Error(`Command timeout: ${cmd} ${args.join(' ')}`));
      }, timeoutMs);

      // Clean up timer if signal aborts or process exits
      signal?.addEventListener('abort', () => clearTimeout(timer));
      process.exit.then(() => clearTimeout(timer));
    });

    const abortPromise = signal ? new Promise<never>((_, reject) => {
      if (signal.aborted) {
        process.kill();
        reject(new Error('Operation aborted'));
      }
      signal.addEventListener('abort', () => {
        process.kill();
        reject(new Error('Operation aborted'));
      });
    }) : new Promise<never>(() => { });

    // For dev server, don't await exit (it runs forever)
    if (isDevServer) {
      return 0;
    }

    return Promise.race([
      process.exit,
      timeoutPromise,
      abortPromise
    ]) as Promise<number>;
  }


  /**
   * Mount all project files to WebContainer filesystem.
   */
  async mountFiles(files: ProjectFile[]): Promise<void> {
    const actionId = this.createAction('file', 'Mounting project files');

    try {
      this.updateStatus(actionId, 'running');

      const fsTree = convertFilesToWebContainerFS(files);
      await this.webcontainer.mount(fsTree);

      this.callbacks.onOutput?.(`✅ Mounted ${files.length} files to WebContainer\n`);
      this.updateStatus(actionId, 'complete');
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      this.callbacks.onOutput?.(`❌ Failed to mount files: ${errorMsg}\n`);
      this.updateStatus(actionId, 'failed', errorMsg);
      throw error;
    }
  }

  /**
   * Run a shell command in WebContainer.
   * Returns the exit code.
   */
  async runShellCommand(command: string, args: string[] = []): Promise<number> {
    const fullCommand = `${command} ${args.join(' ')}`.trim();
    const actionId = this.createAction('shell', `Running: ${fullCommand}`);

    try {
      this.updateStatus(actionId, 'running');
      this.callbacks.onOutput?.(`$ ${fullCommand}\n`);

      const process = await this.webcontainer.spawn(command, args);

      // Stream output
      process.output.pipeTo(
        new WritableStream({
          write: (data) => {
            this.callbacks.onOutput?.(data);
          },
        })
      );

      const exitCode = await process.exit;

      if (exitCode === 0) {
        this.callbacks.onOutput?.(`✅ Command completed successfully\n`);
        this.updateStatus(actionId, 'complete');
      } else {
        const errorMsg = `Exit code: ${exitCode}`;
        this.callbacks.onWarning?.(`⚠️ Command exited with code ${exitCode}`);
        this.updateStatus(actionId, 'failed', errorMsg);
      }

      return exitCode;
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      this.callbacks.onOutput?.(`❌ Command failed: ${errorMsg}\n`);
      this.updateStatus(actionId, 'failed', errorMsg);
      throw error;
    }
  }

  /**
   * Run a step with a checkpoint. If it fails, attempt recovery.
   */
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

      // Attempt recovery
      const result = await this.recoveryManager.attemptRecovery(errorMsg, files, this);

      if (result.recovered) {
        this.callbacks.onOutput?.(`✅ Recovery successful: ${result.message}\n`);

        // If it was a command flag fix, we might need special handling
        if (result.appliedFix?.action === 'retry-with-flags' && result.appliedFix.newCommand) {
          this.callbacks.onOutput?.(`🔄 Retrying with: ${result.appliedFix.newCommand}\n`);
          try {
            const parts = result.appliedFix.newCommand.trim().split(/\s+/);
            const exitCode = await this.runShellCommand(parts[0], parts.slice(1));
            return exitCode === 0;
          } catch (retryError) {
            this.callbacks.onWarning?.(`❌ Retry failed: ${retryError instanceof Error ? retryError.message : String(retryError)}`);
            return false;
          }
        }

        // If it was a syntax fix, we've already rewritten the file, so we can return true to proceed
        return true;
      }

      return false;
    }
  }

  /**
   * Run the full boot sequence with proper error handling and Tier 2 recovery.
   */
  async runBootSequence(files: ProjectFile[]): Promise<boolean> {
    try {
      this.recoveryManager.reset();

      // Step 1: Mount files
      this.callbacks.onOutput?.('\n📁 Step 1/3: Mounting project files...\n');
      const mountOk = await this.runCheckpoint('mount', async () => {
        await this.mountFiles(files);
      }, files);

      if (!mountOk) return false;

      // Step 2: Install dependencies (CRITICAL)
      this.callbacks.onOutput?.('\n📦 Step 2/3: Installing dependencies...\n');
      const installOk = await this.runCheckpoint('npm-install', async () => {
        const exitCode = await this.runShellCommand('npm', ['install']);
        if (exitCode !== 0) throw new Error(`npm install failed with code ${exitCode}`);
      }, files, { isCritical: true });

      if (!installOk) return false;

      // Step 3: Start dev server
      this.callbacks.onOutput?.('\n🚀 Step 3/3: Starting development server...\n');
      const bootOk = await this.runCheckpoint('dev-server', async () => {
        const devProcess = await this.webcontainer.spawn('npm', ['run', 'dev']);
        devProcess.output.pipeTo(new WritableStream({ write: (data) => this.callbacks.onOutput?.(data) }));
        this.#devServerProcess = devProcess;
      }, files);

      if (bootOk) {
        this.callbacks.onOutput?.('\n✅ Boot sequence complete!\n');
      }
      return bootOk;
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      this.callbacks.onOutput?.(`\n❌ Boot sequence failed: ${errorMsg}\n`);
      return false;
    }
  }

  /**
   * Write a single file to WebContainer.
   */
  async writeFile(path: string, content: string): Promise<void> {
    const actionId = this.createAction('file', `Writing: ${path}`);

    try {
      this.updateStatus(actionId, 'running');

      // Dependency Guard: Ensure mandatory libraries exist in package.json
      if (path === 'package.json') {
        try {
          const pkg = JSON.parse(content);
          const mandatory = {
            "lucide-react": "^0.344.0",
            "zustand": "^4.5.2",
            "framer-motion": "^11.0.8",
            "clsx": "^2.1.0",
            "tailwind-merge": "^2.2.1",
            "class-variance-authority": "^0.7.0",
            "uuid": "^9.0.1",
            "date-fns": "^3.3.1"
          };

          pkg.dependencies = pkg.dependencies || {};
          let added = false;
          for (const [name, version] of Object.entries(mandatory)) {
            if (!pkg.dependencies[name]) {
              pkg.dependencies[name] = version;
              added = true;
            }
          }

          if (added) {
            content = JSON.stringify(pkg, null, 2);
            this.callbacks.onOutput?.('🛡️ [Dependency Guard] Injected missing mandatory libraries into package.json\n');
          }
        } catch (e) {
          // If JSON is invalid (e.g., partial stream), we'll skip the guard for now
        }
      }

      // Config Guard: Ensure tsconfig.json has react-jsx transform
      if (path === 'tsconfig.json') {
        try {
          const config = JSON.parse(content);
          config.compilerOptions = config.compilerOptions || {};
          if (config.compilerOptions.jsx !== 'react-jsx') {
            config.compilerOptions.jsx = 'react-jsx';
            content = JSON.stringify(config, null, 2);
            this.callbacks.onOutput?.('🛡️ [Config Guard] Enforced react-jsx in tsconfig.json\n');
          }
        } catch (e) {
          // If JSON is invalid, inject a decent default for React 18
          content = JSON.stringify({
            compilerOptions: {
              target: "ESNext",
              lib: ["DOM", "DOM.Iterable", "ESNext"],
              allowJs: true,
              skipLibCheck: true,
              esModuleInterop: true,
              allowSyntheticDefaultImports: true,
              strict: true,
              forceConsistentCasingInFileNames: true,
              module: "ESNext",
              moduleResolution: "Node",
              resolveJsonModule: true,
              isolatedModules: true,
              noEmit: true,
              jsx: "react-jsx"
            },
            include: ["src"]
          }, null, 2);
          this.callbacks.onOutput?.('🛡️ [Config Guard] Injected default tsconfig.json for React 18+ compatibility\n');
        }
      }

      // Ensure directory exists
      let finalPath = path;
      // Flatten nested src/src or public/public paths often created by AI hallucinations
      if (finalPath.startsWith('src/src/')) finalPath = finalPath.replace('src/src/', 'src/');
      if (finalPath.startsWith('public/public/')) finalPath = finalPath.replace('public/public/', 'public/');

      const dir = finalPath.split('/').slice(0, -1).join('/');
      if (dir) {
        try {
          await this.webcontainer.fs.mkdir(dir, { recursive: true });
        } catch (error) {
          // Directory might already exist - this is fine
          console.debug(`Could not create directory ${dir}:`, error);
        }
      }

      // CSS Guard: Ensure @import statements are at the absolute top and NO circularity
      if (path.endsWith('.css')) {
        const lines = content.split('\n');
        const imports: string[] = [];
        const rest: string[] = [];

        // Simple regex to find the selector in a line like ".font-heading {"
        let currentSelector = '';

        for (const line of lines) {
          const trimmed = line.trim();

          // Track current selector
          if (trimmed.endsWith('{')) {
            currentSelector = trimmed.replace('{', '').trim();
          } else if (trimmed === '}') {
            currentSelector = '';
          }

          if (trimmed.startsWith('@import ')) {
            imports.push(line);
          } else if (trimmed.startsWith('@apply ')) {
            // Circularity Check: e.g., ".font-heading { @apply font-heading; }"
            const applyTarget = trimmed.replace('@apply ', '').replace(';', '').trim();
            if (currentSelector && currentSelector.includes(applyTarget)) {
              this.callbacks.onOutput?.(`🛡️ [CSS Guard] Removed circular @apply rule in ${currentSelector}\n`);
              continue; // Skip the circular rule
            }
            rest.push(line);
          } else {
            rest.push(line);
          }
        }

        if (imports.length > 0) {
          content = [...imports, ...rest].join('\n');
          this.callbacks.onOutput?.('🛡️ [CSS Guard] Moved @import statements to the top of the file\n');
        } else {
          content = rest.join('\n');
        }
      }

      // Path Guard: Fix deep relative path hallucinations (e.g., ../../../utils/cn -> @/utils/cn)
      if (path.endsWith('.tsx') || path.endsWith('.ts')) {
        const deepRelativeRegex = /from\s+['"](\.\.\/)+utils\/cn['"]/g;
        if (deepRelativeRegex.test(content)) {
          content = content.replace(deepRelativeRegex, "from '@/utils/cn'");
          this.callbacks.onOutput?.(`🛡️ [Path Guard] Normalized utility imports in ${path}\n`);
        }
      }

      await this.webcontainer.fs.writeFile(finalPath, content);
      this.updateStatus(actionId, 'complete');
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      console.error(`Failed to write file ${path}:`, error);
      this.updateStatus(actionId, 'failed', errorMsg);
      throw error;
    }
  }

  /**
   * Abort a specific action
   */
  abortAction(actionId: string): void {
    const controller = this.#abortControllers.get(actionId);
    if (controller) {
      controller.abort();
      this.updateStatus(actionId, 'aborted');
    }
  }

  /**
   * Abort all pending and running actions
   */
  abortAll(): void {
    this.#abortControllers.forEach(controller => controller.abort());
    this.#abortControllers.clear();
  }

  /**
   * Clean up resources
   */
  async cleanup(): Promise<void> {
    if (this.#isCleanedUp) return;

    this.#isCleanedUp = true;
    this.abortAll();

    if (this.#devServerProcess) {
      try {
        this.#devServerProcess.kill?.();
        this.#devServerProcess = null;
      } catch (error) {
        console.warn('Error killing dev server process:', error);
      }
    }

    this.actions.clear();
  }

  getActions(): ActionState[] {
    return Array.from(this.actions.values());
  }

  getActionById(id: string): ActionState | undefined {
    return this.actions.get(id);
  }

  private createAction(type: 'file' | 'shell', description: string, path?: string): string {
    const id = `action-${++this.actionIdCounter}`;
    this.actions.set(id, {
      id,
      type,
      status: 'pending',
      description,
      path,
    });
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
