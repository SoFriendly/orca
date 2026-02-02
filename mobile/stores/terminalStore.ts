import { create } from "zustand";
import type { Terminal, RemoteTerminal } from "~/types";
import { useConnectionStore } from "./connectionStore";
import { stripAnsi } from "~/lib/utils";

// Extended terminal type with source tracking
interface MobileTerminal extends Terminal {
  source: "mobile" | "remote";  // Whether this was spawned by mobile or attached from desktop
}

interface TerminalStore {
  // State
  terminals: MobileTerminal[];
  activeTerminalId: string | null;
  outputBuffer: Map<string, string[]>;

  // Actions
  spawnTerminal: (cwd: string, command?: string, type?: "shell" | "assistant") => Promise<string>;
  killTerminal: (terminalId: string) => Promise<void>;
  setActiveTerminal: (terminalId: string) => void;
  sendInput: (terminalId: string, data: string) => void;
  appendOutput: (terminalId: string, data: string) => void;
  getOutput: (terminalId: string) => string[];
  clearOutput: (terminalId: string) => void;
  resizeTerminal: (terminalId: string, cols: number, rows: number) => Promise<void>;

  // Remote terminal management
  attachRemoteTerminal: (remoteTerminal: RemoteTerminal) => void;
  detachRemoteTerminal: (terminalId: string) => void;
}

export const useTerminalStore = create<TerminalStore>((set, get) => ({
  terminals: [],
  activeTerminalId: null,
  outputBuffer: new Map(),

  spawnTerminal: async (cwd: string, command?: string, type: "shell" | "assistant" = "shell"): Promise<string> => {
    const { invoke } = useConnectionStore.getState();

    const terminalId = await invoke<string>("spawn_terminal", {
      shell: command || "",
      cwd,
      cols: 80,
      rows: 24,
    });

    const terminal: MobileTerminal = {
      id: terminalId,
      title: command || "Shell",
      cwd,
      type,
      source: "mobile",
    };

    set((state) => ({
      terminals: [...state.terminals, terminal],
      activeTerminalId: type === "shell" ? terminalId : state.activeTerminalId,
      outputBuffer: new Map(state.outputBuffer).set(terminalId, []),
    }));

    return terminalId;
  },

  killTerminal: async (terminalId: string): Promise<void> => {
    const { invoke } = useConnectionStore.getState();

    try {
      await invoke("kill_terminal", { id: terminalId });
    } catch {
      // Ignore errors if terminal already dead
    }

    set((state) => {
      const newOutputBuffer = new Map(state.outputBuffer);
      newOutputBuffer.delete(terminalId);

      const newTerminals = state.terminals.filter((t) => t.id !== terminalId);
      const newActiveId =
        state.activeTerminalId === terminalId
          ? newTerminals[0]?.id || null
          : state.activeTerminalId;

      return {
        terminals: newTerminals,
        activeTerminalId: newActiveId,
        outputBuffer: newOutputBuffer,
      };
    });
  },

  setActiveTerminal: (terminalId: string) => {
    set({ activeTerminalId: terminalId });
  },

  sendInput: (terminalId: string, data: string) => {
    console.log("[TerminalStore] sendInput called:", terminalId, "data:", JSON.stringify(data));
    const { sendTerminalInput } = useConnectionStore.getState();
    sendTerminalInput(terminalId, data);
  },

  appendOutput: (terminalId: string, data: string) => {
    set((state) => {
      const newOutputBuffer = new Map(state.outputBuffer);
      const existing = newOutputBuffer.get(terminalId) || [];
      const terminal = state.terminals.find((t) => t.id === terminalId);
      // Keep ANSI for assistant terminals so xterm can render it
      const cleanedData = terminal?.type === "assistant" ? data : stripAnsi(data);
      const newOutput = [...existing, cleanedData].slice(-1000);
      newOutputBuffer.set(terminalId, newOutput);
      return { outputBuffer: newOutputBuffer };
    });
  },

  getOutput: (terminalId: string): string[] => {
    return get().outputBuffer.get(terminalId) || [];
  },

  clearOutput: (terminalId: string) => {
    set((state) => {
      const newOutputBuffer = new Map(state.outputBuffer);
      newOutputBuffer.set(terminalId, []);
      return { outputBuffer: newOutputBuffer };
    });
  },

  resizeTerminal: async (
    terminalId: string,
    cols: number,
    rows: number
  ): Promise<void> => {
    const { invoke } = useConnectionStore.getState();
    await invoke("resize_terminal", { id: terminalId, cols, rows });
  },

  attachRemoteTerminal: (remoteTerminal: RemoteTerminal) => {
    const { attachTerminal } = useConnectionStore.getState();

    // Check if already attached
    const existing = get().terminals.find((t) => t.id === remoteTerminal.id);
    if (existing) {
      // Just set it as active
      set({ activeTerminalId: remoteTerminal.id });
      return;
    }

    // Tell desktop to forward output for this terminal
    attachTerminal(remoteTerminal.id);

    // Add to local terminals list
    const terminal: MobileTerminal = {
      id: remoteTerminal.id,
      title: remoteTerminal.title,
      cwd: remoteTerminal.cwd,
      type: "shell",
      source: "remote",
    };

    set((state) => ({
      terminals: [...state.terminals, terminal],
      activeTerminalId: remoteTerminal.id,
      outputBuffer: new Map(state.outputBuffer).set(remoteTerminal.id, []),
    }));
  },

  detachRemoteTerminal: (terminalId: string) => {
    const { detachTerminal } = useConnectionStore.getState();

    // Tell desktop to stop forwarding output
    detachTerminal(terminalId);

    // Remove from local terminals list (but don't kill the terminal on desktop)
    set((state) => {
      const newOutputBuffer = new Map(state.outputBuffer);
      newOutputBuffer.delete(terminalId);

      const newTerminals = state.terminals.filter((t) => t.id !== terminalId);
      const newActiveId =
        state.activeTerminalId === terminalId
          ? newTerminals[0]?.id || null
          : state.activeTerminalId;

      return {
        terminals: newTerminals,
        activeTerminalId: newActiveId,
        outputBuffer: newOutputBuffer,
      };
    });
  },
}));
