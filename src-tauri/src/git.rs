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

    pub fn commit(repo_path: &str, message: &str) -> Result<(), String> {
        let repo = Repository::open(repo_path).map_err(|e| e.to_string())?;

        // Add all changes to index
        let mut index = repo.index().map_err(|e| e.to_string())?;
        index
            .add_all(["*"].iter(), git2::IndexAddOption::DEFAULT, None)
            .map_err(|e| e.to_string())?;
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
        let output = std::process::Command::new("git")
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
        output
            .stdin
            .as_ref()
            .ok_or("Failed to open stdin")?
            .write_all(patch.as_bytes())
            .map_err(|e| format!("Failed to write patch: {}", e))?;

        let result = output
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

    pub fn clone_repo(url: &str, path: &str) -> Result<String, String> {
        std::fs::create_dir_all(path).map_err(|e| e.to_string())?;
        Repository::clone(url, path).map_err(|e| e.to_string())?;
        Ok(path.to_string())
    }

    /// Fetch from remote using system git (handles credentials properly)
    pub fn fetch(repo_path: &str, remote: &str) -> Result<(), String> {
        let output = std::process::Command::new("git")
            .arg("-C")
            .arg(repo_path)
            .arg("fetch")
            .arg(remote)
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
        let output = std::process::Command::new("git")
            .arg("-C")
            .arg(repo_path)
            .arg("pull")
            .arg(remote)
            .output()
            .map_err(|e| format!("Failed to run git: {}", e))?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
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
            .output()
            .map_err(|e| format!("Failed to run git: {}", e))?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(format!("git push failed: {}", stderr.trim()));
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
}
