import { create } from "zustand";
import type { Terminal } from "~/types";
import { useConnectionStore } from "./connectionStore";
import { stripAnsi } from "~/lib/utils";

interface TerminalOutput {
  terminalId: string;
  data: string;
}

interface TerminalStore {
  // State
  terminals: Terminal[];
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

    const terminal: Terminal = {
      id: terminalId,
      title: command || "Shell",
      cwd,
      type,
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
      // Strip ANSI escape codes and keep last 1000 lines
      const cleanedData = stripAnsi(data);
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
}));
