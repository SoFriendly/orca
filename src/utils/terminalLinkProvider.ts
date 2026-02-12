import type { ILinkProvider, ILink, Terminal } from "@xterm/xterm";
import { invoke } from "@tauri-apps/api/core";

/**
 * Performant file path link provider for xterm.js
 *
 * Design principles for performance:
 * 1. On-demand processing - only parses lines when user hovers (not during typing)
 * 2. LRU cache - avoids re-parsing frequently viewed lines
 * 3. Efficient regex - single pass, optimized pattern
 * 4. Lazy cache invalidation - only clears on significant buffer changes
 */

// LRU cache for parsed line results
class LRUCache<K, V> {
  private cache = new Map<K, V>();
  private readonly maxSize: number;

  constructor(maxSize: number) {
    this.maxSize = maxSize;
  }

  get(key: K): V | undefined {
    const value = this.cache.get(key);
    if (value !== undefined) {
      // Move to end (most recently used)
      this.cache.delete(key);
      this.cache.set(key, value);
    }
    return value;
  }

  set(key: K, value: V): void {
    if (this.cache.has(key)) {
      this.cache.delete(key);
    } else if (this.cache.size >= this.maxSize) {
      // Delete oldest (first) entry
      const firstKey = this.cache.keys().next().value;
      if (firstKey !== undefined) {
        this.cache.delete(firstKey);
      }
    }
    this.cache.set(key, value);
  }

  clear(): void {
    this.cache.clear();
  }
}

interface CachedLink {
  startIndex: number;
  endIndex: number;
  text: string;
  path: string;
  line?: number;
  column?: number;
}

interface ParsedLineResult {
  lineContent: string;
  links: CachedLink[];
}

// Common file extensions - kept as a set for O(1) lookup
const FILE_EXTENSIONS = new Set([
  // JavaScript/TypeScript
  "ts", "tsx", "js", "jsx", "mjs", "cjs", "json",
  // Web
  "html", "htm", "css", "scss", "sass", "less", "svg",
  // Config
  "yaml", "yml", "toml", "xml", "ini", "conf", "cfg", "env",
  // Documentation
  "md", "txt", "rst",
  // Programming languages
  "py", "rb", "rs", "go", "java", "kt", "swift", "c", "cpp", "h", "hpp",
  "cs", "php", "lua", "vim", "sh", "bash", "zsh", "fish",
  // Framework specific
  "vue", "svelte", "astro", "prisma",
  // Data
  "sql", "graphql", "gql", "proto", "csv",
  // Erlang/Elixir
  "ex", "exs", "erl", "hrl",
  // Build/Config
  "lock", "log", "make", "cmake", "dockerfile", "tf", "hcl",
]);

// Paths to skip - checked with startsWith or includes
const SKIP_PATH_SEGMENTS = [
  "node_modules",
  ".git/",
  "__pycache__",
  ".next/",
  ".nuxt/",
];

/**
 * Regex pattern for detecting file paths in terminal output.
 *
 * Captures:
 * - Group 1: The full path with optional line:col
 * - Group 2: The file path portion
 * - Group 3: Optional line number
 * - Group 4: Optional column number
 */
const FILE_PATH_REGEX = /(?:^|[\s'"({\[,;:>`])(((?:\.\.?\/)?(?:[\w.-]+\/)*[\w.-]+\.[a-zA-Z0-9]+)(?::(\d+)(?::(\d+))?)?)/g;

export class FilePathLinkProvider implements ILinkProvider {
  private cache: LRUCache<number, ParsedLineResult>;
  private terminal: Terminal;
  private cwd: string;
  private lastBufferLength = 0;
  private writeCount = 0;

  constructor(terminal: Terminal, cwd: string, cacheSize = 100) {
    this.terminal = terminal;
    this.cwd = cwd;
    this.cache = new LRUCache(cacheSize);

    // Invalidate cache periodically on writes, not on every write
    // This batches invalidation to reduce overhead
    terminal.onWriteParsed(() => {
      this.writeCount++;
      // Only check buffer length every 10 writes
      if (this.writeCount % 10 === 0) {
        const currentLength = terminal.buffer.active.length;
        // Clear cache if buffer changed significantly (batch output or clear)
        if (Math.abs(currentLength - this.lastBufferLength) > 50) {
          this.cache.clear();
        }
        this.lastBufferLength = currentLength;
      }
    });
  }

  /**
   * Called by xterm when user hovers over a line.
   * This is the key to performance - it's NOT called during typing.
   */
  provideLinks(
    bufferLineNumber: number,
    callback: (links: ILink[] | undefined) => void
  ): void {
    const buffer = this.terminal.buffer.active;
    // bufferLineNumber is 1-based, convert to 0-based for buffer access
    const lineIndex = bufferLineNumber - 1;
    const line = buffer.getLine(lineIndex);

    if (!line) {
      callback(undefined);
      return;
    }

    // Collect the full logical line by joining wrapped lines
    const [lineContents, startLineIndex] = this.getWrappedLineContent(lineIndex);
    const fullContent = lineContents.join('');

    // Skip empty lines
    if (!fullContent.trim()) {
      callback(undefined);
      return;
    }

    // Check cache first (keyed by start of logical line)
    const cached = this.cache.get(startLineIndex);
    if (cached && cached.lineContent === fullContent) {
      callback(this.createLinks(cached.links, startLineIndex, lineContents));
      return;
    }

    // Parse the full line for file paths
    const links = this.parseLine(fullContent);

    // Cache the result
    this.cache.set(startLineIndex, { lineContent: fullContent, links });

    callback(this.createLinks(links, startLineIndex, lineContents));
  }

  /**
   * Get the full content of a logical line by joining wrapped lines.
   * Returns [array of line strings, starting buffer line index (0-based)].
   */
  private getWrappedLineContent(lineIndex: number): [string[], number] {
    const buffer = this.terminal.buffer.active;

    // Walk up to find the start of the logical line
    let startIdx = lineIndex;
    while (startIdx > 0) {
      const l = buffer.getLine(startIdx);
      if (!l || !l.isWrapped) break;
      startIdx--;
    }

    // Collect all lines in this logical line
    const lines: string[] = [];
    let idx = startIdx;
    while (idx < buffer.length) {
      const l = buffer.getLine(idx);
      if (!l) break;
      lines.push(l.translateToString(true));
      idx++;
      const nextLine = buffer.getLine(idx);
      if (!nextLine || !nextLine.isWrapped) break;
    }

    return [lines, startIdx];
  }

  private parseLine(lineContent: string): CachedLink[] {
    const links: CachedLink[] = [];

    // Skip very long lines (likely binary/minified content)
    if (lineContent.length > 2048) {
      return links;
    }

    // Reset regex state
    FILE_PATH_REGEX.lastIndex = 0;

    let match: RegExpExecArray | null;
    while ((match = FILE_PATH_REGEX.exec(lineContent)) !== null) {
      const fullMatch = match[1]; // The path with optional :line:col
      const filePath = match[2];  // Just the file path
      const lineNum = match[3] ? parseInt(match[3], 10) : undefined;
      const colNum = match[4] ? parseInt(match[4], 10) : undefined;

      // Validate file extension
      const ext = filePath.split(".").pop()?.toLowerCase();
      if (!ext || !FILE_EXTENSIONS.has(ext)) {
        continue;
      }

      // Skip paths containing excluded segments
      if (SKIP_PATH_SEGMENTS.some(seg => filePath.includes(seg))) {
        continue;
      }

      // Calculate the actual start position in the line
      // match.index is where the full regex matched (including leading char)
      // We need to find where fullMatch actually starts
      const matchStart = lineContent.indexOf(fullMatch, match.index);
      if (matchStart === -1) continue;

      links.push({
        startIndex: matchStart,
        endIndex: matchStart + fullMatch.length,
        text: fullMatch,
        path: filePath,
        line: lineNum,
        column: colNum,
      });

      // Safety limit: max 10 links per line
      if (links.length >= 10) break;
    }

    return links;
  }

  private createLinks(cachedLinks: CachedLink[], startLineIndex: number, lineContents: string[]): ILink[] {
    // Build cumulative lengths for mapping string index to line/col
    const cumulativeLengths: number[] = [0];
    for (let i = 0; i < lineContents.length; i++) {
      cumulativeLengths.push(cumulativeLengths[i] + lineContents[i].length);
    }

    return cachedLinks.map(cached => {
      // Find which line the start index falls on
      let startLine = 0;
      for (let i = lineContents.length - 1; i >= 0; i--) {
        if (cached.startIndex >= cumulativeLengths[i]) {
          startLine = i;
          break;
        }
      }
      const startCol = cached.startIndex - cumulativeLengths[startLine];

      // Find which line the end index falls on
      let endLine = 0;
      for (let i = lineContents.length - 1; i >= 0; i--) {
        if (cached.endIndex > cumulativeLengths[i]) {
          endLine = i;
          break;
        }
      }
      const endCol = cached.endIndex - cumulativeLengths[endLine];

      return {
        range: {
          // xterm ranges are 1-based, so +1 for both x and y
          start: { x: startCol + 1, y: startLineIndex + startLine + 1 },
          end: { x: endCol + 1, y: startLineIndex + endLine + 1 },
        },
        text: cached.text,
        activate: (event: MouseEvent, _text: string) => {
          // Require Cmd (Mac) or Ctrl (Windows/Linux) + Click to open
          const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
          const modifierPressed = isMac ? event.metaKey : event.ctrlKey;
          if (modifierPressed) {
            this.handleLinkActivation(cached.path, cached.line, cached.column);
          }
        },
        hover: (event: MouseEvent, _text: string) => {
          // Show tooltip with Cmd/Ctrl+Click hint
          const target = event.target as HTMLElement;
          if (target) {
            const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
            const modifier = isMac ? '⌘' : 'Ctrl';
            target.title = `${modifier}+Click to open`;
          }
        },
      };
    });
  }

  private handleLinkActivation(
    path: string,
    line?: number,
    column?: number
  ): void {
    // Resolve relative paths against cwd
    const fullPath = path.startsWith('/') ? path : `${this.cwd}/${path}`;

    // Try to open in editor with line/column support
    invoke("open_file_in_editor", {
      path: fullPath,
      line: line ?? null,
      column: column ?? null,
    }).catch((err) => {
      console.error("Failed to open file in editor:", err);
      // Fallback: reveal in file manager
      invoke("reveal_in_file_manager", { path: fullPath }).catch(console.error);
    });
  }

  /**
   * Update the working directory (e.g., when user cd's)
   */
  setCwd(cwd: string): void {
    this.cwd = cwd;
  }

  /**
   * Force cache clear (e.g., on terminal clear)
   */
  clearCache(): void {
    this.cache.clear();
  }
}
