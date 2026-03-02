use reqwest::header::{HeaderMap, ACCEPT, AUTHORIZATION, USER_AGENT};
use serde::{Deserialize, Serialize};

use crate::http_client;

pub struct GitHubClient;

#[derive(Debug, Deserialize)]
struct ApiUser {
    login: String,
    name: Option<String>,
    avatar_url: Option<String>,
}

#[derive(Debug, Deserialize)]
struct ApiPullRequest {
    number: u64,
    title: String,
    body: Option<String>,
    state: String,
    draft: Option<bool>,
    html_url: String,
    created_at: String,
    updated_at: String,
    head: ApiPrRef,
    base: ApiPrRef,
    user: ApiPrUser,
}

#[derive(Debug, Deserialize)]
struct ApiPrRef {
    #[serde(rename = "ref")]
    ref_name: String,
}

#[derive(Debug, Deserialize)]
struct ApiPrUser {
    login: String,
}

#[derive(Debug, Deserialize)]
struct ApiCheckRunsResponse {
    check_runs: Vec<ApiCheckRun>,
}

#[derive(Debug, Deserialize)]
struct ApiCheckRun {
    name: String,
    status: String,
    conclusion: Option<String>,
    html_url: Option<String>,
}

#[derive(Debug, Serialize)]
struct CreatePrBody {
    title: String,
    body: String,
    head: String,
    base: String,
}

impl GitHubClient {
    fn headers(token: &str) -> HeaderMap {
        let mut headers = HeaderMap::new();
        headers.insert(AUTHORIZATION, format!("Bearer {}", token).parse().unwrap());
        headers.insert(ACCEPT, "application/vnd.github+json".parse().unwrap());
        headers.insert(USER_AGENT, "Orca-Git-Client".parse().unwrap());
        headers.insert("X-GitHub-Api-Version", "2022-11-28".parse().unwrap());
        headers
    }

    pub async fn get_user(token: &str) -> Result<(String, Option<String>, Option<String>), String> {
        let client = http_client();
        let resp = client
            .get("https://api.github.com/user")
            .headers(Self::headers(token))
            .send()
            .await
            .map_err(|e| format!("Request failed: {}", e))?;

        if !resp.status().is_success() {
            return Err(format!("GitHub API error: {}", resp.status()));
        }

        let user: ApiUser = resp.json().await.map_err(|e| format!("Parse error: {}", e))?;
        Ok((user.login, user.name, user.avatar_url))
    }

    pub async fn list_pull_requests(
        token: &str,
        owner: &str,
        repo: &str,
        state: &str,
    ) -> Result<Vec<(u64, String, Option<String>, String, String, String, String, String, String, String, bool)>, String> {
        let client = http_client();
        let url = format!("https://api.github.com/repos/{}/{}/pulls?state={}&per_page=30", owner, repo, state);
        let resp = client
            .get(&url)
            .headers(Self::headers(token))
            .send()
            .await
            .map_err(|e| format!("Request failed: {}", e))?;

        if !resp.status().is_success() {
            return Err(format!("GitHub API error: {}", resp.status()));
        }

        let prs: Vec<ApiPullRequest> = resp.json().await.map_err(|e| format!("Parse error: {}", e))?;
        Ok(prs.into_iter().map(|pr| (
            pr.number,
            pr.title,
            pr.body,
            pr.state,
            pr.user.login,
            pr.head.ref_name,
            pr.base.ref_name,
            pr.created_at,
            pr.updated_at,
            pr.html_url,
            pr.draft.unwrap_or(false),
        )).collect())
    }

    pub async fn create_pull_request(
        token: &str,
        owner: &str,
        repo: &str,
        title: &str,
        body: &str,
        head: &str,
        base: &str,
    ) -> Result<(u64, String), String> {
        let client = http_client();
        let url = format!("https://api.github.com/repos/{}/{}/pulls", owner, repo);
        let pr_body = CreatePrBody {
            title: title.to_string(),
            body: body.to_string(),
            head: head.to_string(),
            base: base.to_string(),
        };

        let resp = client
            .post(&url)
            .headers(Self::headers(token))
            .json(&pr_body)
            .send()
            .await
            .map_err(|e| format!("Request failed: {}", e))?;

        if !resp.status().is_success() {
            let status = resp.status();
            let body = resp.text().await.unwrap_or_default();
            return Err(format!("GitHub API error ({}): {}", status, body));
        }

        let pr: ApiPullRequest = resp.json().await.map_err(|e| format!("Parse error: {}", e))?;
        Ok((pr.number, pr.html_url))
    }

    pub async fn get_pr_checks(
        token: &str,
        owner: &str,
        repo: &str,
        git_ref: &str,
    ) -> Result<Vec<(String, String, Option<String>, Option<String>)>, String> {
        let client = http_client();
        let url = format!("https://api.github.com/repos/{}/{}/commits/{}/check-runs", owner, repo, git_ref);
        let resp = client
            .get(&url)
            .headers(Self::headers(token))
            .send()
            .await
            .map_err(|e| format!("Request failed: {}", e))?;

        if !resp.status().is_success() {
            return Err(format!("GitHub API error: {}", resp.status()));
        }

        let data: ApiCheckRunsResponse = resp.json().await.map_err(|e| format!("Parse error: {}", e))?;
        Ok(data.check_runs.into_iter().map(|cr| (
            cr.name,
            cr.status,
            cr.conclusion,
            cr.html_url,
        )).collect())
    }

    pub async fn merge_pull_request(
        token: &str,
        owner: &str,
        repo: &str,
        pull_number: u64,
        merge_method: &str,
    ) -> Result<String, String> {
        let client = http_client();
        let url = format!(
            "https://api.github.com/repos/{}/{}/pulls/{}/merge",
            owner, repo, pull_number
        );

        let body = serde_json::json!({ "merge_method": merge_method });

        let resp = client
            .put(&url)
            .headers(Self::headers(token))
            .json(&body)
            .send()
            .await
            .map_err(|e| format!("Request failed: {}", e))?;

        if !resp.status().is_success() {
            let status = resp.status();
            let body = resp.text().await.unwrap_or_default();
            return Err(format!("GitHub API error ({}): {}", status, body));
        }

        Ok("merged".to_string())
    }

    pub fn parse_remote_url(remote_url: &str) -> Result<(String, String), String> {
        // Handle SSH: git@github.com:owner/repo.git
        if remote_url.starts_with("git@github.com:") {
            let path = remote_url.trim_start_matches("git@github.com:");
            let path = path.trim_end_matches(".git");
            let parts: Vec<&str> = path.split('/').collect();
            if parts.len() >= 2 {
                return Ok((parts[0].to_string(), parts[1].to_string()));
            }
        }

        // Handle HTTPS: https://github.com/owner/repo.git
        if remote_url.contains("github.com") {
            let url = remote_url.trim_end_matches(".git");
            let parts: Vec<&str> = url.split('/').collect();
            let len = parts.len();
            if len >= 2 {
                return Ok((parts[len - 2].to_string(), parts[len - 1].to_string()));
            }
        }

        Err(format!("Could not parse GitHub owner/repo from: {}", remote_url))
    }
}
