# Changelog

All notable changes to Orca will be documented in this file.

## [0.2.3]

### Bug Fixes
- **History Diff Refresh**: Opening the same file from a different commit in History now refreshes the diff panel instead of closing it

## [0.2.2]

### Bug Fixes
- **Shell Command History**: Simplify command recording to always read from the terminal buffer on Enter, fixing pasted commands not being saved to history
- **Shell Prompt Parsing**: Expand prompt character detection to support common unicode prompt indicators (✗, ✓, ❯, ➜, →) and strip cwd paths that follow prompt characters

## [0.2.1]

### Improvements
- **Undo Commit**: "Undo Commit" button now only appears when there are unpushed commits
- **Toast Position**: Moved toast notifications from bottom-right to top-right
- **Sidebar Icon Order**: Swapped Files and Worktrees icon positions (now Changes | History | Worktrees | Files)
- **Panel Overflow Handling**: Window now grows to fit panels but is clamped to the display edge; panels shrink proportionally when there isn't enough screen space

### Bug Fixes
- **Discard Dialog Overflow**: Long file paths in discard confirmation dialogs now wrap instead of overflowing the modal

## [0.2.0]

### Improvements
- **Git Stash UX**: Stash items now wrap long text instead of truncating, use rounded-lg styling, and have a right-click context menu with Restore and Drop actions (removed hover buttons)
- **Git Stash Naming**: Renamed "Pop" to "Restore" and removed "Apply" for clearer stash operations
- **Git Panel Menu Labels**: Standardized dropdown menu items to title case without ellipses — Merge Branch, Rebase, Stash Changes, Create Tag, Open PR

## [0.1.99]

### New Features
- **Inline Code Review Comments**: Hover any line in the diff viewer to see a "+" button, click to add a review comment. Comments display inline below lines with edit/delete on hover. "Send to Assistant" button formats all comments with file path, line numbers, and code context, then sends them to the active assistant terminal.
- **Git Stash Support**: Full stash operations — save (with optional message), list, apply, pop, and drop. Stash section in the Git panel only appears when stashes exist.
- **GitHub Pull Requests**: List open PRs, checkout PR branches, and create new pull requests directly from the Git panel. "Create PR" option is hidden for non-GitHub remotes.
- **GitHub Check Runs**: View CI/check status for pull requests.
- **Commit History Context Menu**: Expanded right-click options on commits — Reset to Commit, Checkout Commit, Revert Changes, Create Branch from Commit, Create Tag from Commit, Cherry-pick, Copy SHA, Copy Tag (when tagged), and View on GitHub (for GitHub repos).
- **Terminal Web Link Context Menu**: Right-click detected web links in the terminal to "Open in Browser" or "Copy Link".

### Improvements
- **Git Panel Header Cleanup**: Moved refresh buttons into ellipsis (⋯) dropdown menus across all Git panel views (worktrees, files, history) to reduce icon clutter.
- **DiffPanel Line Layout**: Reordered gutter to line number → checkbox → comment button → code for a tighter layout with less left padding.
- **Diff Line Number Colors**: Line numbers now match their diff line color (green for additions, red for deletions) instead of a flat muted color.
- **GitHub Token Setting**: Added GitHub personal access token configuration in Settings for PR and GitHub API features.

### Bug Fixes
- **External Links**: Replaced `window.open` calls with Tauri's `openUrl` plugin across GitPanel, SettingsSheet, and PR links so URLs actually open in the system browser.

## [0.1.98]

### Bug Fixes
- Fix sidebar panel buttons using inconsistent active state styling
  - Notes button now uses the same `bg-accent text-accent-foreground` style as Git, Assistant, and Shell buttons
- Fix single-character commands being saved to terminal history
  - Terminal now reads the actual command line from the xterm screen buffer on Enter instead of tracking an input buffer
  - Correctly captures commands recalled via shell history (up arrow) that were previously missed

## [0.1.97]

### Features
- Add support for multiple AI providers: Groq, OpenAI, and Claude (Anthropic)
- New provider dropdown in Settings > AI to switch between providers
- Dynamic model selector per provider (Llama, GPT, Claude models)

### Bug Fixes
- Fix diff editor deleting the wrong line when clearing a line's content
  - Clearing a line via editing now sets it to blank instead of removing it
  - Only Backspace/Delete on an already-empty line removes it from the file
- Fix blank lines in diff editor not being deletable
  - Pressing Backspace or Delete on an empty line now removes it and visually hides it immediately

## [0.1.96]

### Rebrand: Chell → Orca

- Rename app from Chell to Orca across the entire codebase
- New app icon featuring the Orca logo
- Updated purple theme with new primary accent color
- Updated build artifacts and release filenames from Chell_ to Orca_
- Updated documentation, build scripts, and CI workflows
- Disable Remote Portal feature (hidden from settings)
- Disable system tray icon
- Home page UI refresh: cleaner action buttons, updated logo and layout

### UI
- Show recent projects section on home page even when no projects exist, with empty state message
- Previously the entire section was hidden if there were no recent projects

## [0.1.94]

### Improvements

- Update open project button to open folder directly
- Fix for panels making window too big and add support for git work trees
- Prevent backspace from navigating back in webview
- Adds support for git worktrees

## [0.1.93]

### Features
- Add right-click context menu for file paths detected in terminal
  - Right-click any file path to see options: Open, Reveal in Finder/Explorer, Open in [editor], Copy Path
  - Same options as file tree context menu for consistent experience
  - Tooltip updated to show "Right-click for options" hint
- Add global file search in header (⌘P / Ctrl+P)
  - Search icon appears to the right of git branch (or project name for non-git projects)
  - Opens CommandDialog with file name and content search
  - File name matches appear instantly, content search is debounced (300ms)
  - Click results to open files in the preview panel
  - Content matches show file path, line number, and matching text
- Add per-project shell history
  - Shell history search now shows commands from the current project first
  - Falls back to global shell history if no project-specific history exists
  - Commands are recorded with project path when executed via SmartShell or selected from history
  - History stored in `~/.claude/shell_history.json` with 5000 entry limit

## [0.1.92]

### Bug Fixes
- Fix terminal initialization race condition causing random blank panels
  - Rewrote terminal initialization from complex 4-phase system to single sequential async flow
  - Eliminates race conditions between separate React effects that could cause terminals to fail to spawn
  - All initialization steps (dimension wait, xterm creation, PTY spawn, connection) now happen in order
  - Fixes intermittent blank shell and assistant panels on app launch
- Fix shell not resetting when switching projects
  - Shell panel now properly remounts with fresh terminal when opening a different project
  - Uses React key prop on SmartShell to force clean remount on project change
- Fix assistant tabs resetting when opening additional tabs
  - Terminal cleanup now only runs on component unmount, not on visibility changes
  - Switching between assistant tabs no longer disposes and recreates terminals
- Fix cd menu in shell panel incorrectly resetting terminal
  - Changing directory via the shell dropdown no longer restarts the terminal session

## [0.1.91]

### Features
- Add microphone permissions button for macOS

## [0.1.90]

### Features
- Add microphone permissions button for macOS
  - Settings now includes a button to request microphone access for voice input features
  - Permissions section only shown on macOS where system permission prompts are required

### Bug Fixes
- Fix NLT execute button not sending commands to terminal
  - Wrapped `handleExecute` in `useCallback` to prevent stale closure issues
  - Added proper error message when terminal is not ready
  - Pressing Enter with a command preview now executes it instead of submitting a new query

## [0.1.89]

### Bug Fixes
- Improve terminal initialization reliability in production builds
  - Added 3-second timeout to dimension stability check to prevent infinite loops
  - Terminal now falls back to 80x24 dimensions if container dimensions can't be determined
  - Fixes intermittent blank shell/assistant panel on app launch

## [0.1.88]
- Fix Monaco editor find bar close button not working
  - Removed z-index on panel header that was blocking the find widget
  - Added `fixedOverflowWidgets` option to Monaco for proper widget rendering
- Fix diff view preventing text selection
  - Changed line edit trigger from single-click to double-click
  - Text can now be selected and copied in diff views

## [0.1.87]

### Bug Fixes
- Fix shell not loading on window launch
  - Added 2 second timeout fallback for terminal dimension stability check
  - Terminal now proceeds with initialization even if container dimensions are unstable or zero
  - ResizeObserver handles proper sizing once layout settles

## [0.1.86]

### Bug Fixes
- Fix NLT and Search icons missing from shell panel header
  - Icons now appear immediately when shell panel opens instead of waiting for terminal to report its ID
  - Fixes race condition where icons would sometimes never appear
- Fix NLT progress events leaking across windows
  - Progress events are now scoped per-request using a unique request ID
  - Running an NLT command in one window no longer affects other windows

## [0.1.85]

### Bug Fixes
- Fix shell panel race condition on window open
  - Terminal now continuously checks for container dimensions until ready
  - Removed artificial delays that could cause initialization to fail
- Fix Linux build error with `RunEvent::Opened`
  - Wrapped macOS-only file association handler in `#[cfg(target_os = "macos")]`
- Fix "Open Remote URL" context menu not working on multi-folder project header
  - Added missing ContextMenu wrapper around the folder dropdown

## [0.1.84]

### Bug Fixes
- Fix shells not resetting when opening a different folder from the sidebar
  - Terminal tabs and utility shell are now properly killed when switching projects
  - New terminals start fresh with the correct working directory
- Fix git panel re-checking files after git refresh
  - Unchecked files now stay unchecked when the diff list refreshes
  - Only newly added files default to checked

### UI
- Remove notes icon from Notes panel header

## [0.1.82]

### UI
- Fix header alignment for project title, git icon, branch name, and chevrons
- Remove duplicate project/branch header from GitPanel (now always shown in main header)

## [0.1.81]

### Bug Fixes
- Fix terminal background color mismatch on Chell Blue and custom themes
  - Active tabs, shell panel header, and terminal now all use the same computed color
  - Theme colors are now derived from `THEME_DEFAULTS` using `hslToHex()` instead of hardcoded hex values
  - Custom themes properly apply their card color to the terminal background
  - Terminal xterm theme updates when custom theme colors change

## [0.1.80]

- Overhauled the entire user interface

## [0.1.79]

### Git
- Add "New File" context menu option to create files at project root
  - Right-click anywhere in the scrollable panel area (including empty space) to create a new file
  - Right-click root folder headers in multi-folder mode to create a file in that folder
  - Right-click the file tree background in single-folder mode
- Add file creation inline UI with editable filename input at the target directory
- Fix git operations using wrong path in multi-folder workspaces
  - Replace `projectPath` with `gitRepoPath` so git commands target the active folder's repository root
  - Auto-refresh git data when switching between folders

### Bug Fixes
- Fix Ctrl+S saving the original file content instead of current editor changes
- Fix file editor panel not expanding to full width when no terminal or assistant is open
- Display actual app version in About section instead of hardcoded "0.1.1"

### Dependencies
- Bump git2 from 0.20.3 to 0.20.4
- Bump time from 0.3.46 to 0.3.47
- Bump bytes from 1.11.0 to 1.11.1
- Bump @isaacs/brace-expansion from 5.0.0 to 5.0.1

## [0.1.78]

### Terminal
- Fix file path link detection for paths that wrap across multiple terminal lines
  - Join wrapped lines before scanning for file paths, matching how the built-in URL link provider works
  - Fix off-by-one in buffer line indexing (1-based to 0-based conversion)
- Focus terminal automatically after dropping a file or note onto it so you can type immediately

### Smart Shell
- Improve NLT with tool calling support, better suggestions, and improved UI

### Git
- Fix rename functionality to preserve the original file path and allow non-empty new names
- Fix horizontal scrollbar appearing in Git panel

### Bug Fixes
- Fix shell history search not returning results
- Fix Linux .deb package missing dependency declarations
  - Explicitly declare libwebkit2gtk, libgtk, libayatana-appindicator, and xdg-utils as package dependencies
  - Resolves "unmet dependencies" error when installing on Linux

## [0.1.77]

### Workspace
- Add "Remove from Workspace" context menu option for folders in multi-folder workspaces
- Sync local project state when folders are added or removed from the store

### Accessibility
- Add ARIA labels to all icon buttons across Git panel, Notes panel, Settings, Home page, and Project page
- Add `role="button"` and keyboard navigation (Enter/Space) for changed file rows in Git panel
- Add `role="checkbox"` and `aria-checked` to file staging checkboxes
- Add screen-reader-only text for diff line additions/removals and commit ahead/behind counts
- Add `aria-live` region for git operation status announcements
- Use semantic `<nav>`, `<main>`, and `<h1>` elements for page structure on Home and Project pages
- Use `<h3>` instead of `<h2>` for Settings section headings to fix heading hierarchy
- Add `role="dialog"` and keyboard arrow navigation to Onboarding tour
- Add ARIA labels to all search inputs, clone/create dialogs, and assistant configuration fields

### Bug Fixes
- Fix window close button not working on macOS
  - Add missing `core:window:allow-close`, `core:window:allow-destroy`, and `core:window:allow-hide` Tauri permissions
  - The `onCloseRequested` JS handler delegates closing to `window.destroy()`, which requires explicit permission in Tauri v2
- Fix file tree context menu actions (open, rename, delete, copy path, gitignore) using wrong base path in multi-folder workspaces
  - All file operations now resolve paths relative to the correct folder root
- Fix file drag-and-drop from Git panel using wrong path for multi-folder workspace files
- Fix folder click toggling after a drag operation by suppressing click events briefly after drag ends

## [0.1.76]

### New Features
- Add "Check for Updates..." menu item to the macOS app menu
- Add "Open Remote URL" context menu on project/folder name in the Git panel
  - Converts SSH remote URLs to HTTPS and strips trailing `.git` before opening
- Add expandable commit history with inline file diffs
  - Click a commit to see the list of files changed
  - Click a file to expand its diff inline with the same green/red line coloring as the changes view
  - Diffs are cached after first fetch for instant re-expand
  - Right-click files for Open, Open Here, Reveal in Finder, Open in editor, and Copy Path
  - File actions are hidden for deleted files to prevent crashes
- Redesign commit history items to match GitHub's style
  - Commit message is now the primary prominent text
  - Author and timestamp shown on a secondary line with commit icon
  - SHA hidden from the row (accessible via right-click > Copy SHA)

### Bug Fixes
- Fix terminals not being properly destroyed on close
  - Kill child shell processes explicitly via PID (SIGHUP on Unix) when terminals are removed
  - Kill all terminal sessions when a project window or terminal window is closed
  - Portal mobile `kill_terminal` message now properly cleans up the backend process

## [0.1.75]

### Window Management
- Add ability to open new windows from the tray menu and the project page "+" button
- New windows open with custom labels, overlay title bar, and consistent styling
- Show new window only after it is fully created for a smoother experience
- Only minimize main window to tray when portal mode is enabled; secondary windows now close normally

### Bug Fixes
- Fix proportional panel resize being incorrectly triggered when opening/closing the markdown panel
- Use fixed width instead of flex for the markdown panel to prevent layout shifts during window resize

## [0.1.74]

### Git
- Use system git for repository cloning instead of libgit2 for proper credential handling
- Prevent git commands from hanging on credential prompts by disabling terminal prompts and using SSH batch mode across clone, fetch, pull, push, and publish operations
- Fix `git apply` blocking by properly closing stdin before waiting for output
- Load git data immediately without waiting for remote fetch; fetch runs in the background
- Show actual error messages on clone failure instead of a generic toast

## [0.1.73]

### Bug Fixes
- Fix terminal scroll position randomly jumping to top and becoming unscrollable
  - Replace `display: none` with `visibility: hidden` for inactive terminal tabs to preserve xterm viewport scroll state
  - Save and restore scroll position around `fit()` resize operations
  - Track viewport scroll position continuously to survive parent panel hide/show cycles
  - Remove `theme` from terminal creation effect dependencies to prevent full terminal recreation on theme change

### Git
- Add publish branch functionality to push local branches to remote with upstream tracking

## [0.1.72]

### File Search
- Add file-tree context menus to search results and support double-click to open here

## [0.1.71]

### New Features
- Add file and text search in the file tree
  - Search for files by name within the project
  - Search file contents (grep) with results showing file path, line number, and matching text

### Portal & Mobile Fixes
- Fix mobile projects list not sorting by most recently opened
  - Desktop was not syncing `lastOpened` timestamps to the database when clicking existing projects
- Fix desktop not showing paired iPhone in Portal settings
  - `LinkedDevice` struct had field name and type mismatches with the relay's JSON format
- Fix mobile terminal output not loading
  - Terminal output forwarding now registers immediately on spawn instead of waiting for a round-trip attach message
  - Desktop auto-registers mobile-spawned terminals for output forwarding and sends buffered output
- Fix mobile connection storms (~100 WebSocket connections)
  - Guard against concurrent connect calls during QR pairing
  - Set pairing status atomically with WebSocket URL
- Fix `selectProject` corrupting `lastOpened` with an empty string
- Fix message handler accumulation on reconnect by tracking and cleaning up previous handlers
- Add `attach_terminal_response` message type to relay server

### Windows Support
- Fix terminal spawning on Windows (use PowerShell instead of invalid Unix shell paths)
- Fix project paths and install commands on Windows
- Add Windows build scripts and signing steps

### Other Improvements
- Run assistants through user's login shell
- Refresh markdown preview automatically on file changes

## [0.1.70]

### Notes Panel
- Add per-project notes panel with markdown support
  - Create, edit, and delete notes stored as `.md` files alongside your project
  - Markdown rendering with GFM support (tables, checklists, etc.)
  - Notes sidebar toggleable from the project toolbar
  - Drag-and-drop reordering of notes
  - Right-click context menu with copy and delete options

### Custom Assistants & Pi Support
- Add Pi as a built-in AI coding assistant
- Add support for user-defined custom assistants
  - Define name, run command, install command, description, and docs URL
  - Custom assistants appear alongside built-in ones in Settings and the + tab menu
  - Delete button for custom assistants (built-in assistants cannot be removed)
- Add ability to hide assistants from the + tab menu
  - Eye/EyeOff toggle per assistant in Settings
  - Hidden assistants are filtered out of the new tab dropdown
- Replace "Copy Install" with an Install button that opens a terminal window
  - Runs the install command through a login shell (supports pipes and env vars)
  - Button shows a spinner and polls for installation status every 3 seconds
  - Automatically detects when installation completes and updates the UI
- Centralize assistant definitions into a single registry (`src/lib/assistants.ts`)
- Improve assistant detection with augmented PATH scanning and interactive shell fallback

- Add "Add to .gitignore" context menu item in the Git panel file tree
- Fix editor panel making window gigantic on HiDPI/Retina laptop screens
  - Window auto-sizing was using physical pixels instead of logical pixels when opening or closing the editor panel
  - Now correctly accounts for display scale factor so the window expands by the intended panel width

## [0.1.68]

### Bug Fixes
- Fix workspace folder state not updating after adding a folder to a single-folder project
  - Projects created from Home page now always include a `folders` array
  - Projects loaded from backend are migrated with `ensureFolders` so workspace UI activates correctly
  - Adding a folder no longer drops the original folder when `folders` was undefined

## [0.1.67]

### Bug Fixes
- Fix opening `.chell` workspace files not loading folders for existing projects
- Fix added folders not persisting to backend database (lost on reload)
- Fix workspace folder updates from `.chell` files not saving to backend on both Home and Project pages
- Fix "Add Folder to Workspace" button missing for single-folder projects in file tree
- Fix dock icon click reopening a closed project instead of navigating to home screen
- Fix new windows expanding with recent projects list instead of constraining to window size

### UI Improvements
- Add "Add Folder to Workspace" button at bottom of multi-folder file tree
- Show ellipsis menu (with Refresh and Add Folder) for single-folder projects in file tree header
- Only show Rename Workspace and Save Workspace options in ellipsis menu for multi-folder workspaces
- Make sidebar + and folder icon buttons consistent between Home and Project pages
  - + button opens home screen (new window on Home, navigates home on Project page)
  - Folder icon opens `.chell` workspace file on both pages
- Hide scrollbar on recent projects list
- Reduce glow effect on active sidebar icon

## [0.1.66]

- Fixed built-in editor missing the save button for non-md files

### Multi-Folder Workspace Support
- Add support for projects containing multiple folders
  - File tree shows all folders as collapsible root-level items
  - Git panel includes folder dropdown to switch between repositories
  - Save workspaces as `.chell` project files for easy sharing and reopening
  - Load `.chell` workspace files from Home screen or Project page
- Add workspace management features
  - Ellipsis menu with Refresh, Add Folder to Workspace, Rename Workspace, and Save Workspace options
  - Rename workspaces inline in the Git panel header
- Terminal pane improvements for multi-folder workspaces
  - Assistant and Shell panels show folder picker before starting in multi-folder projects
  - Inline folder selection UI (not covering dialogs)
  - Shell directory dropdown hidden until shell starts

### Home Screen Improvements
- Make recent projects list scrollable instead of expanding page height
- Add search/filter for recent projects
- Add "Open Workspace" button to load `.chell` project files

## [0.1.65]

- Support opening non-git folders
  - Changed "Open existing repository" to "Open existing folder"
  - Folders without git repos now open with Initialize Git Repo option
  - Git panel defaults to file tree view when not a git repo
  - Empty states show "No git repo detected" with Initialize button
  - Loading state on Initialize buttons while git repo is being created
- Add "Show Hidden Files" setting to display dotfiles in file tree
- Fix double-click to open files in editor (drag threshold prevents interference)

## [0.1.64]

- Move portal WebSocket connection to Rust backend
  - Portal now stays connected when app is minimized to tray
  - Mobile app can access projects list without requiring desktop window to be open
  - Portal configuration stored in SQLite database instead of localStorage
- Enhance UI with subtle noise overlay and animations
  - Add film grain texture overlay for visual depth
  - Smooth fade-in animations for dialogs, tooltips, and menus

## [0.1.63]

- Make file editor editable by default for non-markdown files
- Only show edit/preview toggle for markdown files
- Disable TypeScript/JavaScript diagnostics in Monaco editor

## [0.1.62]

- Add built-in file editor with Monaco (syntax highlighting, find/replace)
  - Double-click files in Git panel to open in editor
  - Right-click "Open Here" option for in-app editing
  - Themes matching app themes (dark, tokyo, light, custom)
- Drag files from Git panel into terminals to insert file paths
- Proportional panel resizing when window is resized
- Only show ahead/behind status when no files to commit
- Improve terminal command assistant with shell detection and file I/O commands
- Update dependencies

## [0.1.60]

- Auto-load macOS Keychain secrets as environment variables
  - Automatically discovers Keychain items with `env/` prefix (e.g., `env/MY_API_KEY`)
  - Fetches secrets in Chell's GUI context, so authorization dialogs appear properly
  - Exports as environment variables with prefix stripped (e.g., `MY_API_KEY`)
  - No configuration required - just store secrets with `env/` prefix in Keychain
- Add macOS entitlements for proper code signing and security context

## [0.1.58]

- Inherit environment variables from parent process
- Add file selection for commits - choose which files to include
- Auto-generate commit messages on initial load
- Improve typing animation smoothness
- Add clipboard image saving support
- Improve terminal command handling for file commits
- Add terminal editor integration
- Improve git index management
- Use repo root as Git directory for better compatibility
- Include hidden files in git ignore detection
- Fix directory handling in git status
