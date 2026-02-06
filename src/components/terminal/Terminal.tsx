import { useEffect, useRef } from 'react';
import { Terminal as XTerm } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { useWebContainer } from '@/contexts/WebContainerContext';
import { terminalService } from '@/lib/terminal-service';
import '@xterm/xterm/css/xterm.css';

interface TerminalProps {
    className?: string;
}

export function Terminal({ className }: TerminalProps) {
    const terminalRef = useRef<HTMLDivElement>(null);
    const xtermRef = useRef<XTerm | null>(null);
    const initializedRef = useRef(false);
    const { webcontainer } = useWebContainer();

    useEffect(() => {
        if (!terminalRef.current || xtermRef.current || initializedRef.current) return;

        initializedRef.current = true;

        const term = new XTerm({
            convertEol: true,
            cursorBlink: true,
            theme: {
                background: '#020617', // slate-950
                foreground: '#cbd5e1', // slate-300
            },
            fontFamily: 'monospace',
        });

        const fitAddon = new FitAddon();
        term.loadAddon(fitAddon);
        term.loadAddon(new WebLinksAddon());

        term.open(terminalRef.current);
        fitAddon.fit();

        xtermRef.current = term;

        // Handle resize
        const handleResize = () => {
            fitAddon.fit();
        };
        window.addEventListener('resize', handleResize);

        // Initial welcome message
        term.write('\x1b[34mOrbit 2.0\x1b[0m Terminal Initialized.\r\n');
        term.write('Waiting for WebContainer engine...\r\n');

        // Subscribe to global terminal events (from Auto-Boot)
        const unsubscribe = terminalService.subscribe((data) => {
            term.write(data);
        });

        return () => {
            unsubscribe();
            window.removeEventListener('resize', handleResize);
            term.dispose();
            xtermRef.current = null;
            initializedRef.current = false;
        };
    }, []);

    // Connect to shell when webcontainer is ready
    useEffect(() => {
        const term = xtermRef.current;
        if (!term || !webcontainer) return; // Wait for both

        const startShell = async () => {
            term.write('\r\n\x1b[32m✔ Engine Ready.\x1b[0m Starting shell...\r\n');
            term.write('\x1b[90mTip: Run \x1b[1m\x1b[37mnpm install && npm run dev\x1b[0m\x1b[90m to start the project.\x1b[0m\r\n\r\n');

            try {
                const shellProcess = await webcontainer.spawn('jsh', {
                    terminal: {
                        cols: term.cols,
                        rows: term.rows,
                    },
                });

                // Pipe process output to terminal
                shellProcess.output.pipeTo(
                    new WritableStream({
                        write(data) {
                            term.write(data);
                        },
                    })
                );

                // Pipe terminal input to process
                const input = shellProcess.input.getWriter();
                const onDataDisposable = term.onData((data) => {
                    input.write(data);
                });

                // Cleanup logic could go here if we detach
            } catch (e) {
                term.write(`\r\n\x1b[31mFailed to start shell: ${e}\x1b[0m\r\n`);
            }
        };

        // Small delay to ensure xterm is ready
        setTimeout(startShell, 100);

    }, [webcontainer]);

    return <div ref={terminalRef} className={className} style={{ width: '100%', height: '100%', minHeight: '200px' }} />;
}
