# Changelog

All notable changes to Chell will be documented in this file.

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
