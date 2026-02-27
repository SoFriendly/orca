use crate::{Branch, Commit, DiffHunk, DiffLine, FileDiff, GitStatus};
use git2::{DiffOptions, Repository, StatusOptions};

pub struct GitService;

impl GitService {
    pub fn is_git_repo(path: &str) -> Result<bool, String> {
        Ok(Repository::open(path).is_ok())
    }

    pub fn get_status(repo_path: &str) -> Result<GitStatus, String> {
        let repo = Repository::open(repo_path).map_err(|e| e.to_string())?;

        let head = repo.head().ok();
        let branch = head
            .as_ref()
            .and_then(|h| h.shorthand())
            .map(|s| s.to_string())
            .unwrap_or_else(|| "HEAD".to_string());

        // Calculate ahead/behind counts relative to upstream
        let (ahead, behind) = Self::get_ahead_behind(&repo, &branch).unwrap_or((0, 0));

        let mut opts = StatusOptions::new();
        opts.include_untracked(true);
        opts.recurse_untracked_dirs(true);

        let statuses = repo.statuses(Some(&mut opts)).map_err(|e| e.to_string())?;

        let mut staged = Vec::new();
        let mut unstaged = Vec::new();
        let mut untracked = Vec::new();

        for entry in statuses.iter() {
            let status = entry.status();
            let path = entry.path().unwrap_or("").to_string();

            if status.is_index_new()
                || status.is_index_modified()
                || status.is_index_deleted()
                || status.is_index_renamed()
            {
                staged.push(path.clone());
            }
            if status.is_wt_modified() || status.is_wt_deleted() || status.is_wt_renamed() {
                unstaged.push(path.clone());
            }
            if status.is_wt_new() {
                untracked.push(path);
            }
        }

        Ok(GitStatus {
            branch,
            ahead,
            behind,
            staged,
            unstaged,
            untracked,
        })
    }

    fn get_ahead_behind(repo: &Repository, branch: &str) -> Result<(u32, u32), String> {
        // Get the local branch reference
        let local_branch = repo
            .find_branch(branch, git2::BranchType::Local)
            .map_err(|e| e.to_string())?;

        // Get the upstream branch
        let upstream = local_branch
            .upstream()
            .map_err(|_| "No upstream branch".to_string())?;

        let local_oid = local_branch
            .get()
            .target()
            .ok_or("Could not get local branch target")?;

        let upstream_oid = upstream
            .get()
            .target()
            .ok_or("Could not get upstream branch target")?;

        let (ahead, behind) = repo
            .graph_ahead_behind(local_oid, upstream_oid)
            .map_err(|e| e.to_string())?;

        Ok((ahead as u32, behind as u32))
    }

    pub fn get_diff(repo_path: &str) -> Result<Vec<FileDiff>, String> {
        use std::cell::RefCell;
        use std::collections::HashMap;

        let repo = Repository::open(repo_path).map_err(|e| e.to_string())?;

        // Get diff between HEAD and working directory
        let head = repo.head().ok().and_then(|h| h.peel_to_tree().ok());

        let mut opts = DiffOptions::new();
        opts.include_untracked(true);
        opts.recurse_untracked_dirs(true);
        opts.show_untracked_content(true);

        let diff = repo
            .diff_tree_to_workdir_with_index(head.as_ref(), Some(&mut opts))
            .map_err(|e| e.to_string())?;

        // Use RefCell to allow interior mutability
        let diffs: RefCell<HashMap<String, FileDiff>> = RefCell::new(HashMap::new());

        diff.foreach(
            &mut |delta, _| {
                let path = delta
                    .new_file()
                    .path()
                    .or_else(|| delta.old_file().path())
                    .map(|p| p.to_string_lossy().to_string())
                    .unwrap_or_default();

                let status = match delta.status() {
                    git2::Delta::Added | git2::Delta::Untracked => "added",
                    git2::Delta::Deleted => "deleted",
                    git2::Delta::Modified => "modified",
                    git2::Delta::Renamed => "renamed",
                    _ => "modified",
                }
                .to_string();

                diffs.borrow_mut().insert(path.clone(), FileDiff {
                    path,
                    status,
                    hunks: Vec::new(),
                });

                true
            },
            None,
            Some(&mut |delta, hunk| {
                let path = delta
                    .new_file()
                    .path()
                    .or_else(|| delta.old_file().path())
                    .map(|p| p.to_string_lossy().to_string())
                    .unwrap_or_default();

                if let Some(file_diff) = diffs.borrow_mut().get_mut(&path) {
                    file_diff.hunks.push(DiffHunk {
                        old_start: hunk.old_start(),
                        old_lines: hunk.old_lines(),
                        new_start: hunk.new_start(),
                        new_lines: hunk.new_lines(),
                        lines: Vec::new(),
                    });
                }

                true
            }),
            Some(&mut |delta, _hunk, line| {
                let path = delta
                    .new_file()
                    .path()
                    .or_else(|| delta.old_file().path())
                    .map(|p| p.to_string_lossy().to_string())
                    .unwrap_or_default();

                let line_type = match line.origin() {
                    '+' => "addition",
                    '-' => "deletion",
                    _ => "context",
                }
                .to_string();

                let content = String::from_utf8_lossy(line.content()).to_string();

                if let Some(file_diff) = diffs.borrow_mut().get_mut(&path) {
                    if let Some(hunk) = file_diff.hunks.last_mut() {
                        hunk.lines.push(DiffLine {
                            line_type,
                            content: content.trim_end_matches('\n').to_string(),
                            old_line_no: line.old_lineno(),
                            new_line_no: line.new_lineno(),
                        });
                    }
                }

                true
            }),
        )
        .map_err(|e| e.to_string())?;

        let mut result: Vec<FileDiff> = diffs.into_inner().into_values().collect();
        result.sort_by(|a, b| a.path.cmp(&b.path));
        Ok(result)
    }

    pub fn commit(repo_path: &str, message: &str, files: Option<Vec<String>>) -> Result<(), String> {
        // If a merge is in progress, use CLI git commit which handles unmerged index state
        let merge_head = std::path::Path::new(repo_path).join(".git").join("MERGE_HEAD");
        if merge_head.exists() {
            // Stage files first
            if let Some(ref file_list) = files {
                for file in file_list {
                    let output = std::process::Command::new("git")
                        .arg("-C").arg(repo_path)
                        .arg("add").arg(file)
                        .stdin(std::process::Stdio::null())
                        .output()
                        .map_err(|e| format!("Failed to run git add: {}", e))?;
                    if !output.status.success() {
                        let stderr = String::from_utf8_lossy(&output.stderr);
                        return Err(format!("git add failed: {}", stderr.trim()));
                    }
                }
            } else {
                let output = std::process::Command::new("git")
                    .arg("-C").arg(repo_path)
                    .arg("add").arg("-A")
                    .stdin(std::process::Stdio::null())
                    .output()
                    .map_err(|e| format!("Failed to run git add: {}", e))?;
                if !output.status.success() {
                    let stderr = String::from_utf8_lossy(&output.stderr);
                    return Err(format!("git add failed: {}", stderr.trim()));
                }
            }

            let output = std::process::Command::new("git")
                .arg("-C").arg(repo_path)
                .arg("commit").arg("-m").arg(message)
                .stdin(std::process::Stdio::null())
                .output()
                .map_err(|e| format!("Failed to run git commit: {}", e))?;
            if !output.status.success() {
                let stderr = String::from_utf8_lossy(&output.stderr);
                return Err(format!("git commit failed: {}", stderr.trim()));
            }
            return Ok(());
        }

        let repo = Repository::open(repo_path).map_err(|e| e.to_string())?;

        // Get all changed/untracked files from status
        let mut status_opts = StatusOptions::new();
        status_opts.include_untracked(true);
        status_opts.recurse_untracked_dirs(true);
        let statuses = repo.statuses(Some(&mut status_opts)).map_err(|e| e.to_string())?;

        // Create a set of files to commit (if specified)
        let files_to_commit: Option<std::collections::HashSet<&str>> = files
            .as_ref()
            .map(|f| f.iter().map(|s| s.as_str()).collect());

        // Add each file individually to the index
        let mut index = repo.index().map_err(|e| e.to_string())?;
        for entry in statuses.iter() {
            if let Some(path) = entry.path() {
                // Skip if we have a specific file list and this file isn't in it
                if let Some(ref allowed) = files_to_commit {
                    if !allowed.contains(path) {
                        continue;
                    }
                }

                let status = entry.status();
                if status.is_wt_new() || status.is_wt_modified() || status.is_wt_renamed() || status.is_wt_typechange() {
                    index.add_path(std::path::Path::new(path)).map_err(|e| e.to_string())?;
                } else if status.is_wt_deleted() {
                    index.remove_path(std::path::Path::new(path)).map_err(|e| e.to_string())?;
                }
            }
        }
        index.write().map_err(|e| e.to_string())?;

        let tree_id = index.write_tree().map_err(|e| e.to_string())?;
        let tree = repo.find_tree(tree_id).map_err(|e| e.to_string())?;

        let signature = repo.signature().map_err(|e| e.to_string())?;

        let parent = repo
            .head()
            .ok()
            .and_then(|h| h.peel_to_commit().ok());
        let parents: Vec<&git2::Commit> = parent.iter().collect();

        repo.commit(
            Some("HEAD"),
            &signature,
            &signature,
            message,
            &tree,
            &parents,
        )
        .map_err(|e| e.to_string())?;

        Ok(())
    }

    pub fn get_branches(repo_path: &str) -> Result<Vec<Branch>, String> {
        let repo = Repository::open(repo_path).map_err(|e| e.to_string())?;
        let mut branches = Vec::new();

        let head = repo.head().ok();
        let head_name = head.as_ref().and_then(|h| h.shorthand()).map(|s| s.to_string());

        for branch in repo
            .branches(None)
            .map_err(|e| e.to_string())?
        {
            let (branch, branch_type) = branch.map_err(|e| e.to_string())?;
            let name = branch
                .name()
                .map_err(|e| e.to_string())?
                .unwrap_or("")
                .to_string();

            let is_remote = matches!(branch_type, git2::BranchType::Remote);
            let is_head = head_name.as_ref().map(|h| h == &name).unwrap_or(false);

            let upstream = branch
                .upstream()
                .ok()
                .and_then(|u| u.name().ok().flatten().map(|s| s.to_string()));

            branches.push(Branch {
                name,
                is_head,
                is_remote,
                upstream,
            });
        }

        Ok(branches)
    }

    pub fn checkout_branch(repo_path: &str, branch: &str) -> Result<(), String> {
        let repo = Repository::open(repo_path).map_err(|e| e.to_string())?;

        // First, try to find a local branch with this name
        if let Ok(local_branch) = repo.find_branch(branch, git2::BranchType::Local) {
            // Local branch exists, check it out
            let refname = local_branch.get().name().ok_or("Invalid branch name")?;
            let obj = local_branch.get().peel(git2::ObjectType::Commit).map_err(|e| e.to_string())?;
            repo.checkout_tree(&obj, None).map_err(|e| e.to_string())?;
            repo.set_head(refname).map_err(|e| e.to_string())?;
            return Ok(());
        }

        // No local branch, check if there's a remote branch with this name
        let remote_name = format!("origin/{}", branch);
        if let Ok(remote_branch) = repo.find_branch(&remote_name, git2::BranchType::Remote) {
            // Create a local tracking branch from the remote
            let commit = remote_branch.get().peel_to_commit().map_err(|e| e.to_string())?;
            let mut local_branch = repo.branch(branch, &commit, false).map_err(|e| e.to_string())?;

            // Set the upstream to track the remote branch
            local_branch.set_upstream(Some(&remote_name)).map_err(|e| e.to_string())?;

            // Now checkout the new local branch
            let refname = local_branch.get().name().ok_or("Invalid branch name")?;
            let obj = local_branch.get().peel(git2::ObjectType::Commit).map_err(|e| e.to_string())?;
            repo.checkout_tree(&obj, None).map_err(|e| e.to_string())?;
            repo.set_head(refname).map_err(|e| e.to_string())?;
            return Ok(());
        }

        // Fallback: try revparse for other refs (tags, commit hashes, etc.)
        let (object, reference) = repo
            .revparse_ext(branch)
            .map_err(|e| e.to_string())?;

        repo.checkout_tree(&object, None)
            .map_err(|e| e.to_string())?;

        match reference {
            Some(gref) => {
                repo.set_head(gref.name().unwrap())
                    .map_err(|e| e.to_string())?;
            }
            None => {
                repo.set_head_detached(object.id())
                    .map_err(|e| e.to_string())?;
            }
        }

        Ok(())
    }

    pub fn create_branch(repo_path: &str, name: &str) -> Result<(), String> {
        let repo = Repository::open(repo_path).map_err(|e| e.to_string())?;

        let head = repo.head().map_err(|e| e.to_string())?;
        let commit = head.peel_to_commit().map_err(|e| e.to_string())?;

        repo.branch(name, &commit, false)
            .map_err(|e| e.to_string())?;

        Ok(())
    }

    pub fn get_history(repo_path: &str, limit: u32) -> Result<Vec<Commit>, String> {
        let repo = Repository::open(repo_path).map_err(|e| e.to_string())?;
        let mut commits = Vec::new();

        let head = match repo.head() {
            Ok(h) => h,
            Err(_) => return Ok(commits), // Empty repo
        };

        let oid = head.target().ok_or("Failed to get HEAD target")?;
        let mut revwalk = repo.revwalk().map_err(|e| e.to_string())?;
        revwalk.push(oid).map_err(|e| e.to_string())?;
        revwalk.set_sorting(git2::Sort::TIME).map_err(|e| e.to_string())?;

        for (i, oid) in revwalk.enumerate() {
            if i >= limit as usize {
                break;
            }

            let oid = oid.map_err(|e| e.to_string())?;
            let commit = repo.find_commit(oid).map_err(|e| e.to_string())?;

            let id = oid.to_string();
            let short_id = id[..7.min(id.len())].to_string();
            let message = commit
                .message()
                .unwrap_or("")
                .lines()
                .next()
                .unwrap_or("")
                .to_string();
            let author = commit.author().name().unwrap_or("").to_string();
            let author_email = commit.author().email().unwrap_or("").to_string();
            let timestamp = commit.time().seconds().to_string();

            commits.push(Commit {
                id,
                short_id,
                message,
                author,
                author_email,
                timestamp,
                summary: None,
            });
        }

        Ok(commits)
    }

    pub fn discard_file(repo_path: &str, file_path: &str) -> Result<(), String> {
        let repo = Repository::open(repo_path).map_err(|e| e.to_string())?;
        let full_path = std::path::Path::new(repo_path).join(file_path);

        // Check if file is untracked (not in HEAD)
        let head = repo.head().ok().and_then(|h| h.peel_to_tree().ok());
        let is_untracked = match &head {
            Some(tree) => tree.get_path(std::path::Path::new(file_path)).is_err(),
            None => true, // No HEAD means all files are untracked
        };

        if is_untracked {
            // For untracked files, just delete them
            if full_path.exists() {
                if full_path.is_dir() {
                    std::fs::remove_dir_all(&full_path).map_err(|e| e.to_string())?;
                } else {
                    std::fs::remove_file(&full_path).map_err(|e| e.to_string())?;
                }
            }
        } else {
            // For tracked files, restore from HEAD
            let mut checkout_builder = git2::build::CheckoutBuilder::new();
            checkout_builder.path(file_path);
            checkout_builder.force();

            repo.checkout_head(Some(&mut checkout_builder))
                .map_err(|e| e.to_string())?;
        }

        Ok(())
    }

    /// Discard a specific hunk by applying its reverse patch
    pub fn discard_hunk(
        repo_path: &str,
        file_path: &str,
        old_start: i32,
        old_lines: i32,
        new_start: i32,
        new_lines: i32,
        lines: Vec<String>,
    ) -> Result<(), String> {
        // Build the patch content for this specific hunk
        let mut patch = format!("--- a/{}\n+++ b/{}\n", file_path, file_path);
        patch.push_str(&format!(
            "@@ -{},{} +{},{} @@\n",
            old_start, old_lines, new_start, new_lines
        ));
        for line in &lines {
            patch.push_str(line);
            patch.push('\n');
        }

        // Apply the patch in reverse using git command
        let mut child = std::process::Command::new("git")
            .arg("-C")
            .arg(repo_path)
            .arg("apply")
            .arg("--reverse")
            .arg("--unidiff-zero")
            .arg("-")
            .stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
            .spawn()
            .map_err(|e| format!("Failed to run git: {}", e))?;

        use std::io::Write;
        let mut stdin = child.stdin.take().ok_or("Failed to open stdin")?;
        stdin
            .write_all(patch.as_bytes())
            .map_err(|e| format!("Failed to write patch: {}", e))?;
        drop(stdin); // Close stdin so git knows input is complete

        let result = child
            .wait_with_output()
            .map_err(|e| format!("Failed to wait for git: {}", e))?;

        if !result.status.success() {
            let stderr = String::from_utf8_lossy(&result.stderr);
            return Err(format!("git apply failed: {}", stderr.trim()));
        }

        Ok(())
    }

    pub fn checkout_commit(repo_path: &str, commit_id: &str) -> Result<(), String> {
        let repo = Repository::open(repo_path).map_err(|e| e.to_string())?;

        let oid = git2::Oid::from_str(commit_id).map_err(|e| e.to_string())?;
        let commit = repo.find_commit(oid).map_err(|e| e.to_string())?;

        repo.checkout_tree(commit.as_object(), None)
            .map_err(|e| e.to_string())?;

        repo.set_head_detached(oid)
            .map_err(|e| e.to_string())?;

        Ok(())
    }

    pub fn reset_to_commit(repo_path: &str, commit_id: &str, mode: &str) -> Result<(), String> {
        let repo = Repository::open(repo_path).map_err(|e| e.to_string())?;

        let oid = git2::Oid::from_str(commit_id).map_err(|e| e.to_string())?;
        let commit = repo.find_commit(oid).map_err(|e| e.to_string())?;
        let object = commit.as_object();

        let reset_type = match mode {
            "soft" => git2::ResetType::Soft,
            "mixed" => git2::ResetType::Mixed,
            _ => git2::ResetType::Hard,
        };

        repo.reset(object, reset_type, None)
            .map_err(|e| e.to_string())?;

        Ok(())
    }

    /// Revert a commit by creating a new commit that undoes the changes
    pub fn revert_commit(repo_path: &str, commit_id: &str) -> Result<(), String> {
        // Use git command for revert since libgit2's revert is complex
        let output = std::process::Command::new("git")
            .args(["revert", "--no-edit", commit_id])
            .current_dir(repo_path)
            .output()
            .map_err(|e| e.to_string())?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(format!("Failed to revert commit: {}", stderr));
        }

        Ok(())
    }

    pub fn init_repo(path: &str) -> Result<(), String> {
        std::fs::create_dir_all(path).map_err(|e| e.to_string())?;
        Repository::init(path).map_err(|e| e.to_string())?;
        Ok(())
    }

    /// Clone a repository using system git (handles credentials properly)
    pub fn clone_repo(url: &str, path: &str) -> Result<String, String> {
        let output = std::process::Command::new("git")
            .arg("clone")
            .arg(url)
            .arg(path)
            .stdin(std::process::Stdio::null())
            .env("GIT_TERMINAL_PROMPT", "0")
            .env("GIT_SSH_COMMAND", "ssh -o BatchMode=yes")
            .output()
            .map_err(|e| format!("Failed to run git: {}", e))?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(stderr.trim().to_string());
        }

        Ok(path.to_string())
    }

    /// Fetch from remote using system git (handles credentials properly)
    pub fn fetch(repo_path: &str, remote: &str) -> Result<(), String> {
        let output = std::process::Command::new("git")
            .arg("-C")
            .arg(repo_path)
            .arg("fetch")
            .arg(remote)
            .stdin(std::process::Stdio::null())
            .env("GIT_TERMINAL_PROMPT", "0")
            .env("GIT_SSH_COMMAND", "ssh -o BatchMode=yes")
            .output()
            .map_err(|e| format!("Failed to run git: {}", e))?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(format!("git fetch failed: {}", stderr.trim()));
        }

        Ok(())
    }

    /// Pull from remote using system git (handles credentials properly)
    pub fn pull(repo_path: &str, remote: &str) -> Result<(), String> {
        // Use --rebase to handle diverged branches more gracefully
        let output = std::process::Command::new("git")
            .arg("-C")
            .arg(repo_path)
            .arg("pull")
            .arg("--rebase")
            .arg("--autostash")
            .arg(remote)
            .stdin(std::process::Stdio::null())
            .env("GIT_TERMINAL_PROMPT", "0")
            .env("GIT_SSH_COMMAND", "ssh -o BatchMode=yes")
            .output()
            .map_err(|e| format!("Failed to run git: {}", e))?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            let stderr_lower = stderr.to_lowercase();

            // Check for conflicts during rebase
            if stderr_lower.contains("conflict") || stderr_lower.contains("could not apply") {
                // Abort the rebase to leave the repo in a clean state
                let _ = std::process::Command::new("git")
                    .arg("-C")
                    .arg(repo_path)
                    .arg("rebase")
                    .arg("--abort")
                    .output();
                return Err("Pull failed: conflicts detected. Please resolve conflicts manually.".to_string());
            }

            // Check for uncommitted changes
            if stderr_lower.contains("uncommitted changes") || stderr_lower.contains("unstaged changes") {
                return Err("Pull failed: you have uncommitted changes. Commit or stash them first.".to_string());
            }

            return Err(format!("git pull failed: {}", stderr.trim()));
        }

        Ok(())
    }

    /// Push to remote using system git (handles credentials properly)
    pub fn push(repo_path: &str, remote: &str) -> Result<(), String> {
        let output = std::process::Command::new("git")
            .arg("-C")
            .arg(repo_path)
            .arg("push")
            .arg(remote)
            .stdin(std::process::Stdio::null())
            .env("GIT_TERMINAL_PROMPT", "0")
            .env("GIT_SSH_COMMAND", "ssh -o BatchMode=yes")
            .output()
            .map_err(|e| format!("Failed to run git: {}", e))?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            let stderr_lower = stderr.to_lowercase();

            // Check if remote has changes we don't have
            if stderr_lower.contains("rejected") || stderr_lower.contains("non-fast-forward") || stderr_lower.contains("fetch first") {
                return Err("Push rejected: remote has changes. Pull first.".to_string());
            }

            // Check for no upstream branch
            if stderr_lower.contains("no upstream branch") || stderr_lower.contains("has no upstream") {
                return Err("NO_UPSTREAM".to_string());
            }

            return Err(format!("git push failed: {}", stderr.trim()));
        }

        Ok(())
    }

    /// Publish a branch by pushing with -u to set upstream tracking
    pub fn publish_branch(repo_path: &str, remote: &str) -> Result<(), String> {
        let branch_output = std::process::Command::new("git")
            .arg("-C")
            .arg(repo_path)
            .arg("rev-parse")
            .arg("--abbrev-ref")
            .arg("HEAD")
            .output()
            .map_err(|e| format!("Failed to get current branch: {}", e))?;

        let branch_name = String::from_utf8_lossy(&branch_output.stdout).trim().to_string();

        let output = std::process::Command::new("git")
            .arg("-C")
            .arg(repo_path)
            .arg("push")
            .arg("-u")
            .arg(remote)
            .arg(&branch_name)
            .stdin(std::process::Stdio::null())
            .env("GIT_TERMINAL_PROMPT", "0")
            .env("GIT_SSH_COMMAND", "ssh -o BatchMode=yes")
            .output()
            .map_err(|e| format!("Failed to publish branch: {}", e))?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(format!("Failed to publish branch: {}", stderr.trim()));
        }

        Ok(())
    }

    pub fn add_to_gitignore(repo_path: &str, pattern: &str) -> Result<(), String> {
        let gitignore_path = std::path::Path::new(repo_path).join(".gitignore");

        // Read existing content if file exists
        let mut content = if gitignore_path.exists() {
            std::fs::read_to_string(&gitignore_path).map_err(|e| e.to_string())?
        } else {
            String::new()
        };

        // Check if pattern already exists
        let pattern_line = pattern.trim();
        let already_exists = content.lines().any(|line| line.trim() == pattern_line);

        if !already_exists {
            // Add newline if file doesn't end with one
            if !content.is_empty() && !content.ends_with('\n') {
                content.push('\n');
            }
            content.push_str(pattern_line);
            content.push('\n');

            std::fs::write(&gitignore_path, content).map_err(|e| e.to_string())?;
        }

        Ok(())
    }

    pub fn get_commit_diff(repo_path: &str, commit_id: &str) -> Result<Vec<FileDiff>, String> {
        use std::cell::RefCell;
        use std::collections::HashMap;

        let repo = Repository::open(repo_path).map_err(|e| e.to_string())?;
        let oid = git2::Oid::from_str(commit_id).map_err(|e| e.to_string())?;
        let commit = repo.find_commit(oid).map_err(|e| e.to_string())?;
        let tree = commit.tree().map_err(|e| e.to_string())?;

        let parent_tree = if commit.parent_count() > 0 {
            Some(commit.parent(0).map_err(|e| e.to_string())?.tree().map_err(|e| e.to_string())?)
        } else {
            None
        };

        let diff = repo
            .diff_tree_to_tree(parent_tree.as_ref(), Some(&tree), None)
            .map_err(|e| e.to_string())?;

        let diffs: RefCell<HashMap<String, FileDiff>> = RefCell::new(HashMap::new());

        diff.foreach(
            &mut |delta, _| {
                let path = delta
                    .new_file()
                    .path()
                    .or_else(|| delta.old_file().path())
                    .map(|p| p.to_string_lossy().to_string())
                    .unwrap_or_default();

                let status = match delta.status() {
                    git2::Delta::Added | git2::Delta::Untracked => "added",
                    git2::Delta::Deleted => "deleted",
                    git2::Delta::Modified => "modified",
                    git2::Delta::Renamed => "renamed",
                    _ => "modified",
                }
                .to_string();

                diffs.borrow_mut().insert(path.clone(), FileDiff {
                    path,
                    status,
                    hunks: Vec::new(),
                });

                true
            },
            None,
            Some(&mut |delta, hunk| {
                let path = delta
                    .new_file()
                    .path()
                    .or_else(|| delta.old_file().path())
                    .map(|p| p.to_string_lossy().to_string())
                    .unwrap_or_default();

                if let Some(file_diff) = diffs.borrow_mut().get_mut(&path) {
                    file_diff.hunks.push(DiffHunk {
                        old_start: hunk.old_start(),
                        old_lines: hunk.old_lines(),
                        new_start: hunk.new_start(),
                        new_lines: hunk.new_lines(),
                        lines: Vec::new(),
                    });
                }

                true
            }),
            Some(&mut |delta, _hunk, line| {
                let path = delta
                    .new_file()
                    .path()
                    .or_else(|| delta.old_file().path())
                    .map(|p| p.to_string_lossy().to_string())
                    .unwrap_or_default();

                let line_type = match line.origin() {
                    '+' => "addition",
                    '-' => "deletion",
                    _ => "context",
                }
                .to_string();

                let content = String::from_utf8_lossy(line.content()).to_string();

                if let Some(file_diff) = diffs.borrow_mut().get_mut(&path) {
                    if let Some(hunk) = file_diff.hunks.last_mut() {
                        hunk.lines.push(DiffLine {
                            line_type,
                            content: content.trim_end_matches('\n').to_string(),
                            old_line_no: line.old_lineno(),
                            new_line_no: line.new_lineno(),
                        });
                    }
                }

                true
            }),
        )
        .map_err(|e| e.to_string())?;

        let mut result: Vec<FileDiff> = diffs.into_inner().into_values().collect();
        result.sort_by(|a, b| a.path.cmp(&b.path));
        Ok(result)
    }

    pub fn get_remote_url(repo_path: &str) -> Result<String, String> {
        let repo = Repository::open(repo_path).map_err(|e| e.to_string())?;
        let remote = repo
            .find_remote("origin")
            .map_err(|_| "No 'origin' remote found".to_string())?;
        let url = remote
            .url()
            .ok_or_else(|| "Remote URL is not valid UTF-8".to_string())?
            .to_string();

        // Convert SSH URLs to HTTPS
        let url = if url.starts_with("git@") {
            // git@github.com:user/repo.git -> https://github.com/user/repo.git
            let url = url.trim_start_matches("git@");
            let url = url.replacen(':', "/", 1);
            format!("https://{}", url)
        } else {
            url
        };

        // Strip trailing .git
        let url = url.strip_suffix(".git").unwrap_or(&url).to_string();

        Ok(url)
    }

    /// List all worktrees using `git worktree list --porcelain`
    pub fn list_worktrees(repo_path: &str) -> Result<Vec<crate::WorktreeInfo>, String> {
        let output = std::process::Command::new("git")
            .arg("-C")
            .arg(repo_path)
            .arg("worktree")
            .arg("list")
            .arg("--porcelain")
            .output()
            .map_err(|e| format!("Failed to run git: {}", e))?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(format!("git worktree list failed: {}", stderr.trim()));
        }

        let stdout = String::from_utf8_lossy(&output.stdout);
        let mut worktrees = Vec::new();
        let mut current: Option<crate::WorktreeInfo> = None;
        let mut is_first = true;

        for line in stdout.lines() {
            if line.starts_with("worktree ") {
                if let Some(wt) = current.take() {
                    worktrees.push(wt);
                }
                let path = line.strip_prefix("worktree ").unwrap().to_string();
                let name = std::path::Path::new(&path)
                    .file_name()
                    .map(|n| n.to_string_lossy().to_string())
                    .unwrap_or_else(|| path.clone());
                current = Some(crate::WorktreeInfo {
                    name,
                    path,
                    branch: None,
                    head_sha: None,
                    is_main: is_first,
                    is_locked: false,
                    lock_reason: None,
                    is_prunable: false,
                });
                is_first = false;
            } else if let Some(ref mut wt) = current {
                if line.starts_with("HEAD ") {
                    wt.head_sha = Some(line.strip_prefix("HEAD ").unwrap().to_string());
                } else if line.starts_with("branch ") {
                    let branch = line.strip_prefix("branch ").unwrap();
                    // Strip refs/heads/ prefix
                    let branch = branch.strip_prefix("refs/heads/").unwrap_or(branch);
                    wt.branch = Some(branch.to_string());
                } else if line == "locked" {
                    wt.is_locked = true;
                } else if line.starts_with("locked ") {
                    wt.is_locked = true;
                    wt.lock_reason = Some(line.strip_prefix("locked ").unwrap().to_string());
                } else if line == "prunable" {
                    wt.is_prunable = true;
                }
            }
        }

        if let Some(wt) = current.take() {
            worktrees.push(wt);
        }

        Ok(worktrees)
    }

    /// Create a new worktree using `git worktree add`
    pub fn create_worktree(
        repo_path: &str,
        path: &str,
        branch: Option<&str>,
        new_branch: Option<&str>,
    ) -> Result<crate::WorktreeInfo, String> {
        let mut cmd = std::process::Command::new("git");
        cmd.arg("-C").arg(repo_path).arg("worktree").arg("add");

        if let Some(nb) = new_branch {
            cmd.arg("-b").arg(nb);
        }

        cmd.arg(path);

        if let Some(b) = branch {
            cmd.arg(b);
        }

        let output = cmd
            .stdin(std::process::Stdio::null())
            .output()
            .map_err(|e| format!("Failed to run git: {}", e))?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(format!("git worktree add failed: {}", stderr.trim()));
        }

        // Return info about the newly created worktree
        let worktrees = Self::list_worktrees(repo_path)?;
        let canonical = std::fs::canonicalize(path)
            .map(|p| p.to_string_lossy().to_string())
            .unwrap_or_else(|_| path.to_string());
        worktrees
            .into_iter()
            .find(|wt| wt.path == canonical || wt.path == path)
            .ok_or_else(|| "Worktree created but not found in list".to_string())
    }

    /// Remove a worktree using `git worktree remove`
    pub fn remove_worktree(repo_path: &str, worktree_path: &str, force: bool) -> Result<(), String> {
        let mut cmd = std::process::Command::new("git");
        cmd.arg("-C").arg(repo_path).arg("worktree").arg("remove");

        if force {
            cmd.arg("--force");
        }

        cmd.arg(worktree_path);

        let output = cmd
            .stdin(std::process::Stdio::null())
            .output()
            .map_err(|e| format!("Failed to run git: {}", e))?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(format!("git worktree remove failed: {}", stderr.trim()));
        }

        Ok(())
    }

    /// Prune stale worktree entries using `git worktree prune`
    pub fn prune_worktrees(repo_path: &str) -> Result<(), String> {
        let output = std::process::Command::new("git")
            .arg("-C")
            .arg(repo_path)
            .arg("worktree")
            .arg("prune")
            .output()
            .map_err(|e| format!("Failed to run git: {}", e))?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(format!("git worktree prune failed: {}", stderr.trim()));
        }

        Ok(())
    }

    /// Lock a worktree using `git worktree lock`
    pub fn lock_worktree(repo_path: &str, worktree_path: &str, reason: Option<&str>) -> Result<(), String> {
        let mut cmd = std::process::Command::new("git");
        cmd.arg("-C").arg(repo_path).arg("worktree").arg("lock");

        if let Some(r) = reason {
            cmd.arg("--reason").arg(r);
        }

        cmd.arg(worktree_path);

        let output = cmd
            .stdin(std::process::Stdio::null())
            .output()
            .map_err(|e| format!("Failed to run git: {}", e))?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(format!("git worktree lock failed: {}", stderr.trim()));
        }

        Ok(())
    }

    /// Unlock a worktree using `git worktree unlock`
    pub fn unlock_worktree(repo_path: &str, worktree_path: &str) -> Result<(), String> {
        let output = std::process::Command::new("git")
            .arg("-C")
            .arg(repo_path)
            .arg("worktree")
            .arg("unlock")
            .arg(worktree_path)
            .stdin(std::process::Stdio::null())
            .output()
            .map_err(|e| format!("Failed to run git: {}", e))?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(format!("git worktree unlock failed: {}", stderr.trim()));
        }

        Ok(())
    }

    // === Stash operations ===

    pub fn stash_save(repo_path: &str, message: Option<&str>) -> Result<(), String> {
        let mut cmd = std::process::Command::new("git");
        cmd.arg("-C").arg(repo_path).arg("stash").arg("push");
        if let Some(msg) = message {
            cmd.arg("-m").arg(msg);
        }
        let output = cmd
            .stdin(std::process::Stdio::null())
            .output()
            .map_err(|e| format!("Failed to run git: {}", e))?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(format!("git stash push failed: {}", stderr.trim()));
        }
        Ok(())
    }

    pub fn stash_list(repo_path: &str) -> Result<Vec<(usize, String, String, String)>, String> {
        let output = std::process::Command::new("git")
            .arg("-C")
            .arg(repo_path)
            .arg("stash")
            .arg("list")
            .arg("--format=%gd%x00%s%x00%ci")
            .stdin(std::process::Stdio::null())
            .output()
            .map_err(|e| format!("Failed to run git: {}", e))?;

        let stdout = String::from_utf8_lossy(&output.stdout);
        let mut stashes = Vec::new();
        for (i, line) in stdout.lines().enumerate() {
            let parts: Vec<&str> = line.split('\0').collect();
            if parts.len() >= 3 {
                // parts[0] = stash@{N}, parts[1] = subject, parts[2] = date
                let message = parts[1].to_string();
                // Extract branch from message like "On branchname: message"
                let branch = if message.starts_with("On ") {
                    message.split(':').next().unwrap_or("").trim_start_matches("On ").to_string()
                } else {
                    String::new()
                };
                stashes.push((i, message, branch, parts[2].to_string()));
            }
        }
        Ok(stashes)
    }

    pub fn stash_apply(repo_path: &str, index: usize) -> Result<(), String> {
        let stash_ref = format!("stash@{{{}}}", index);
        let output = std::process::Command::new("git")
            .arg("-C")
            .arg(repo_path)
            .arg("stash")
            .arg("apply")
            .arg(&stash_ref)
            .stdin(std::process::Stdio::null())
            .output()
            .map_err(|e| format!("Failed to run git: {}", e))?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(format!("git stash apply failed: {}", stderr.trim()));
        }
        Ok(())
    }

    pub fn stash_pop(repo_path: &str, index: usize) -> Result<(), String> {
        let stash_ref = format!("stash@{{{}}}", index);
        let output = std::process::Command::new("git")
            .arg("-C")
            .arg(repo_path)
            .arg("stash")
            .arg("pop")
            .arg(&stash_ref)
            .stdin(std::process::Stdio::null())
            .output()
            .map_err(|e| format!("Failed to run git: {}", e))?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(format!("git stash pop failed: {}", stderr.trim()));
        }
        Ok(())
    }

    pub fn stash_drop(repo_path: &str, index: usize) -> Result<(), String> {
        let stash_ref = format!("stash@{{{}}}", index);
        let output = std::process::Command::new("git")
            .arg("-C")
            .arg(repo_path)
            .arg("stash")
            .arg("drop")
            .arg(&stash_ref)
            .stdin(std::process::Stdio::null())
            .output()
            .map_err(|e| format!("Failed to run git: {}", e))?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(format!("git stash drop failed: {}", stderr.trim()));
        }
        Ok(())
    }

    // === Merge operations ===

    pub fn merge_branch(repo_path: &str, branch: &str, strategy: &str) -> Result<String, String> {
        let mut cmd = std::process::Command::new("git");
        cmd.arg("-C").arg(repo_path).arg("merge");
        match strategy {
            "no-ff" => { cmd.arg("--no-ff"); }
            "squash" => { cmd.arg("--squash"); }
            _ => { cmd.arg("--ff"); } // "ff" or default
        }
        cmd.arg(branch);
        let output = cmd
            .stdin(std::process::Stdio::null())
            .output()
            .map_err(|e| format!("Failed to run git: {}", e))?;

        let stdout = String::from_utf8_lossy(&output.stdout).to_string();
        let stderr = String::from_utf8_lossy(&output.stderr).to_string();

        if !output.status.success() {
            if stderr.contains("CONFLICT") || stdout.contains("CONFLICT") {
                return Ok("conflict".to_string());
            }
            return Err(format!("git merge failed: {}", stderr.trim()));
        }
        Ok("ok".to_string())
    }

    pub fn abort_merge(repo_path: &str) -> Result<(), String> {
        let output = std::process::Command::new("git")
            .arg("-C")
            .arg(repo_path)
            .arg("merge")
            .arg("--abort")
            .stdin(std::process::Stdio::null())
            .output()
            .map_err(|e| format!("Failed to run git: {}", e))?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(format!("git merge --abort failed: {}", stderr.trim()));
        }
        Ok(())
    }

    pub fn continue_merge(repo_path: &str, message: Option<&str>) -> Result<(), String> {
        let mut cmd = std::process::Command::new("git");
        cmd.arg("-C").arg(repo_path).arg("commit").arg("--no-edit");
        if let Some(msg) = message {
            cmd.arg("-m").arg(msg);
        }
        let output = cmd
            .stdin(std::process::Stdio::null())
            .output()
            .map_err(|e| format!("Failed to run git: {}", e))?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(format!("git commit failed: {}", stderr.trim()));
        }
        Ok(())
    }

    // === Conflict operations ===

    pub fn get_conflicted_files(repo_path: &str) -> Result<Vec<String>, String> {
        let output = std::process::Command::new("git")
            .arg("-C")
            .arg(repo_path)
            .arg("diff")
            .arg("--name-only")
            .arg("--diff-filter=U")
            .stdin(std::process::Stdio::null())
            .output()
            .map_err(|e| format!("Failed to run git: {}", e))?;

        let stdout = String::from_utf8_lossy(&output.stdout);
        let files: Vec<String> = stdout.lines().filter(|l| !l.is_empty()).map(|l| l.to_string()).collect();
        Ok(files)
    }

    pub fn get_conflict_content(repo_path: &str, file_path: &str) -> Result<String, String> {
        let full_path = std::path::Path::new(repo_path).join(file_path);
        std::fs::read_to_string(&full_path)
            .map_err(|e| format!("Failed to read file: {}", e))
    }

    pub fn resolve_conflict(repo_path: &str, file_path: &str, content: &str) -> Result<(), String> {
        let full_path = std::path::Path::new(repo_path).join(file_path);
        std::fs::write(&full_path, content)
            .map_err(|e| format!("Failed to write file: {}", e))?;

        let output = std::process::Command::new("git")
            .arg("-C")
            .arg(repo_path)
            .arg("add")
            .arg(file_path)
            .stdin(std::process::Stdio::null())
            .output()
            .map_err(|e| format!("Failed to run git: {}", e))?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(format!("git add failed: {}", stderr.trim()));
        }
        Ok(())
    }

    // === Undo last commit ===

    pub fn undo_last_commit(repo_path: &str) -> Result<(), String> {
        let repo = Repository::open(repo_path).map_err(|e| e.to_string())?;
        let head = repo.head().map_err(|e| e.to_string())?;
        let commit = head.peel_to_commit().map_err(|e| e.to_string())?;

        if commit.parent_count() == 0 {
            return Err("Cannot undo: this is the initial commit".to_string());
        }

        let parent = commit.parent(0).map_err(|e| e.to_string())?;
        let parent_id = parent.id().to_string();
        Self::reset_to_commit(repo_path, &parent_id, "soft")
    }

    // === Rebase operations ===

    pub fn rebase_onto(repo_path: &str, onto_branch: &str) -> Result<String, String> {
        let output = std::process::Command::new("git")
            .arg("-C")
            .arg(repo_path)
            .arg("rebase")
            .arg(onto_branch)
            .stdin(std::process::Stdio::null())
            .output()
            .map_err(|e| format!("Failed to run git: {}", e))?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            if stderr.contains("CONFLICT") || stderr.contains("could not apply") {
                return Ok("conflict".to_string());
            }
            return Err(format!("git rebase failed: {}", stderr.trim()));
        }
        Ok("ok".to_string())
    }

    pub fn rebase_continue(repo_path: &str) -> Result<String, String> {
        let output = std::process::Command::new("git")
            .arg("-C")
            .arg(repo_path)
            .arg("rebase")
            .arg("--continue")
            .stdin(std::process::Stdio::null())
            .env("GIT_EDITOR", "true")
            .output()
            .map_err(|e| format!("Failed to run git: {}", e))?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            if stderr.contains("CONFLICT") {
                return Ok("conflict".to_string());
            }
            return Err(format!("git rebase --continue failed: {}", stderr.trim()));
        }
        Ok("ok".to_string())
    }

    pub fn rebase_abort(repo_path: &str) -> Result<(), String> {
        let output = std::process::Command::new("git")
            .arg("-C")
            .arg(repo_path)
            .arg("rebase")
            .arg("--abort")
            .stdin(std::process::Stdio::null())
            .output()
            .map_err(|e| format!("Failed to run git: {}", e))?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(format!("git rebase --abort failed: {}", stderr.trim()));
        }
        Ok(())
    }

    pub fn cherry_pick(repo_path: &str, commit_id: &str) -> Result<String, String> {
        let output = std::process::Command::new("git")
            .arg("-C")
            .arg(repo_path)
            .arg("cherry-pick")
            .arg(commit_id)
            .stdin(std::process::Stdio::null())
            .output()
            .map_err(|e| format!("Failed to run git: {}", e))?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            if stderr.contains("CONFLICT") {
                return Ok("conflict".to_string());
            }
            return Err(format!("git cherry-pick failed: {}", stderr.trim()));
        }
        Ok("ok".to_string())
    }

    // === Tag operations ===

    pub fn list_tags(repo_path: &str) -> Result<Vec<(String, String, String)>, String> {
        let output = std::process::Command::new("git")
            .arg("-C")
            .arg(repo_path)
            .arg("tag")
            .arg("-l")
            .arg("--format=%(refname:short)%00%(objectname:short)%00%(creatordate:iso)")
            .arg("--sort=-creatordate")
            .stdin(std::process::Stdio::null())
            .output()
            .map_err(|e| format!("Failed to run git: {}", e))?;

        let stdout = String::from_utf8_lossy(&output.stdout);
        let tags: Vec<(String, String, String)> = stdout
            .lines()
            .filter(|l| !l.is_empty())
            .filter_map(|line| {
                let parts: Vec<&str> = line.split('\0').collect();
                if parts.len() >= 3 {
                    Some((parts[0].to_string(), parts[1].to_string(), parts[2].to_string()))
                } else {
                    None
                }
            })
            .collect();
        Ok(tags)
    }

    pub fn create_tag(repo_path: &str, name: &str, message: Option<&str>, commit: Option<&str>) -> Result<(), String> {
        let mut cmd = std::process::Command::new("git");
        cmd.arg("-C").arg(repo_path).arg("tag");
        if let Some(msg) = message {
            cmd.arg("-a").arg(name).arg("-m").arg(msg);
        } else {
            cmd.arg(name);
        }
        if let Some(c) = commit {
            cmd.arg(c);
        }
        let output = cmd
            .stdin(std::process::Stdio::null())
            .output()
            .map_err(|e| format!("Failed to run git: {}", e))?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(format!("git tag failed: {}", stderr.trim()));
        }
        Ok(())
    }

    pub fn delete_tag(repo_path: &str, name: &str) -> Result<(), String> {
        let output = std::process::Command::new("git")
            .arg("-C")
            .arg(repo_path)
            .arg("tag")
            .arg("-d")
            .arg(name)
            .stdin(std::process::Stdio::null())
            .output()
            .map_err(|e| format!("Failed to run git: {}", e))?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(format!("git tag -d failed: {}", stderr.trim()));
        }
        Ok(())
    }

    pub fn push_tag(repo_path: &str, tag: &str, remote: &str) -> Result<(), String> {
        let output = std::process::Command::new("git")
            .arg("-C")
            .arg(repo_path)
            .arg("push")
            .arg(remote)
            .arg(tag)
            .stdin(std::process::Stdio::null())
            .env("GIT_TERMINAL_PROMPT", "0")
            .env("GIT_SSH_COMMAND", "ssh -o BatchMode=yes")
            .output()
            .map_err(|e| format!("Failed to run git: {}", e))?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(format!("git push tag failed: {}", stderr.trim()));
        }
        Ok(())
    }

    // === Line-level staging ===

    pub fn stage_lines(repo_path: &str, file_path: &str, line_ranges: Vec<(u32, u32)>) -> Result<(), String> {
        // Generate a partial patch from the full diff and apply it
        let output = std::process::Command::new("git")
            .arg("-C")
            .arg(repo_path)
            .arg("diff")
            .arg("--")
            .arg(file_path)
            .stdin(std::process::Stdio::null())
            .output()
            .map_err(|e| format!("Failed to run git diff: {}", e))?;

        let full_patch = String::from_utf8_lossy(&output.stdout).to_string();
        if full_patch.is_empty() {
            return Err("No diff found for file".to_string());
        }

        // Parse the patch and filter to only include selected lines
        let filtered_patch = Self::filter_patch_lines(&full_patch, &line_ranges)?;

        // Apply the filtered patch to the index
        let mut child = std::process::Command::new("git")
            .arg("-C")
            .arg(repo_path)
            .arg("apply")
            .arg("--cached")
            .arg("--recount")
            .arg("-")
            .stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
            .spawn()
            .map_err(|e| format!("Failed to spawn git apply: {}", e))?;

        if let Some(mut stdin) = child.stdin.take() {
            use std::io::Write;
            stdin.write_all(filtered_patch.as_bytes())
                .map_err(|e| format!("Failed to write patch: {}", e))?;
        }

        let output = child.wait_with_output()
            .map_err(|e| format!("Failed to wait for git apply: {}", e))?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(format!("git apply --cached failed: {}", stderr.trim()));
        }
        Ok(())
    }

    fn filter_patch_lines(patch: &str, line_ranges: &[(u32, u32)]) -> Result<String, String> {
        // Keep the file header, filter hunk lines to only selected ones
        let mut result = String::new();
        let mut in_header = true;
        let mut current_new_line: u32 = 0;
        let mut current_hunk_lines = Vec::new();
        let mut current_hunk_header = String::new();

        for line in patch.lines() {
            if line.starts_with("diff ") || line.starts_with("index ") || line.starts_with("--- ") || line.starts_with("+++ ") {
                // Flush previous hunk if any
                if !current_hunk_lines.is_empty() {
                    Self::write_filtered_hunk(&mut result, &current_hunk_header, &current_hunk_lines, line_ranges);
                    current_hunk_lines.clear();
                }
                in_header = true;
                result.push_str(line);
                result.push('\n');
                continue;
            }

            if line.starts_with("@@ ") {
                // Flush previous hunk
                if !current_hunk_lines.is_empty() {
                    Self::write_filtered_hunk(&mut result, &current_hunk_header, &current_hunk_lines, line_ranges);
                    current_hunk_lines.clear();
                }
                in_header = false;
                current_hunk_header = line.to_string();
                // Parse new file start line from @@ -a,b +c,d @@
                if let Some(plus_part) = line.split('+').nth(1) {
                    if let Some(start) = plus_part.split(',').next().and_then(|s| s.split(' ').next()) {
                        current_new_line = start.parse().unwrap_or(1);
                    }
                }
                continue;
            }

            if !in_header {
                let new_line_no = if line.starts_with('+') {
                    let n = current_new_line;
                    current_new_line += 1;
                    Some(n)
                } else if line.starts_with('-') {
                    None
                } else {
                    current_new_line += 1;
                    None
                };
                current_hunk_lines.push((line.to_string(), new_line_no));
            }
        }

        // Flush last hunk
        if !current_hunk_lines.is_empty() {
            Self::write_filtered_hunk(&mut result, &current_hunk_header, &current_hunk_lines, line_ranges);
        }

        if result.is_empty() {
            return Err("No matching lines to stage".to_string());
        }

        Ok(result)
    }

    fn write_filtered_hunk(
        result: &mut String,
        hunk_header: &str,
        lines: &[(String, Option<u32>)],
        line_ranges: &[(u32, u32)],
    ) {
        let is_line_selected = |new_line: u32| -> bool {
            line_ranges.iter().any(|(start, end)| new_line >= *start && new_line <= *end)
        };

        let mut filtered_lines = Vec::new();
        for (line, new_line_no) in lines {
            if line.starts_with('+') {
                if let Some(n) = new_line_no {
                    if is_line_selected(*n) {
                        filtered_lines.push(line.as_str());
                    } else {
                        // Convert unselected addition to context
                        let ctx = format!(" {}", &line[1..]);
                        filtered_lines.push(Box::leak(ctx.into_boxed_str()));
                    }
                }
            } else if line.starts_with('-') {
                // Include deletions that are adjacent to selected additions, or check context
                // For simplicity, include all deletions in hunks that have selected lines
                filtered_lines.push(line.as_str());
            } else {
                filtered_lines.push(line.as_str());
            }
        }

        // Check if any actual changes remain
        let has_changes = filtered_lines.iter().any(|l| l.starts_with('+') || l.starts_with('-'));
        if !has_changes {
            return;
        }

        // Recalculate hunk header
        let mut old_count = 0u32;
        let mut new_count = 0u32;
        for line in &filtered_lines {
            if line.starts_with('+') {
                new_count += 1;
            } else if line.starts_with('-') {
                old_count += 1;
            } else {
                old_count += 1;
                new_count += 1;
            }
        }

        // Parse original old start from header
        let old_start = hunk_header
            .split('-')
            .nth(1)
            .and_then(|s| s.split(',').next())
            .and_then(|s| s.parse::<u32>().ok())
            .unwrap_or(1);
        let new_start = hunk_header
            .split('+')
            .nth(1)
            .and_then(|s| s.split(',').next().and_then(|n| n.split(' ').next()))
            .and_then(|s| s.parse::<u32>().ok())
            .unwrap_or(1);

        result.push_str(&format!("@@ -{},{} +{},{} @@\n", old_start, old_count, new_start, new_count));
        for line in &filtered_lines {
            result.push_str(line);
            result.push('\n');
        }
    }

    // === Image diff support ===

    pub fn get_old_file_content(repo_path: &str, file_path: &str) -> Result<Vec<u8>, String> {
        let repo = Repository::open(repo_path).map_err(|e| e.to_string())?;
        let head = repo.head().map_err(|e| e.to_string())?;
        let tree = head.peel_to_tree().map_err(|e| e.to_string())?;
        let entry = tree.get_path(std::path::Path::new(file_path))
            .map_err(|_| format!("File {} not found in HEAD", file_path))?;
        let blob = repo.find_blob(entry.id())
            .map_err(|e| format!("Failed to read blob: {}", e))?;
        Ok(blob.content().to_vec())
    }
}
