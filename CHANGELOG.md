# Changelog

All notable changes to Chell will be documented in this file.

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
