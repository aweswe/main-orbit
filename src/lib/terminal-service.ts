type TerminalListener = (data: string) => void;

class TerminalService {
    private listeners: Set<TerminalListener> = new Set();
    private buffer: string[] = [];

    // Subscribe to terminal output events
    subscribe(listener: TerminalListener) {
        this.listeners.add(listener);
        // Replay recent buffer (optional, good for race conditions)
        return () => this.listeners.delete(listener);
    }

    // Write data to the terminal
    write(data: string) {
        // this.buffer.push(data);
        // if (this.buffer.length > 100) this.buffer.shift();
        this.listeners.forEach(l => l(data));
    }

    // specific helpers
    log(message: string) {
        this.write(`\r\n\x1b[36mℹ ${message}\x1b[0m\r\n`);
    }

    error(message: string) {
        this.write(`\r\n\x1b[31m✖ ${message}\x1b[0m\r\n`);
    }

    success(message: string) {
        this.write(`\r\n\x1b[32m✔ ${message}\x1b[0m\r\n`);
    }
}

export const terminalService = new TerminalService();
