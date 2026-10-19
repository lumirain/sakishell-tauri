//! Independent search-engine HTTP APIs (not OpenAI chat format).

use reqwest::Client;
use serde::Deserialize;
use std::time::Duration;

use crate::agent::tools::deepseek_api;
use crate::agent::tools::web_result::truncate_error_body as truncate_err;
use crate::config::settings::{CustomSearchApi, SearchApiProtocol, WebSearchApiProvider};
use crate::error::AppError;

use super::types::{SearchOutcome, SearchResult};

const TIMEOUT_SECS: u64 = 20;

const BRAVE_URL: &str = "https://api.search.brave.com/res/v1/web/search";
const TAVILY_URL: &str = "https://api.tavily.com/search";

/// Which search API to call: a built-in vendor, or the user's own endpoint.
#[derive(Debug, Clone, Default)]
pub struct ApiSearchTarget {
    pub provider: WebSearchApiProvider,
    /// Only consulted when `provider` is [`WebSearchApiProvider::Custom`].
    pub custom: CustomSearchApi,
}

pub async fn search(
    target: &ApiSearchTarget,
    api_key: &str,
    query: &str,
    max_results: usize,
) -> Result<SearchOutcome, AppError> {
    // Built-in vendors always authenticate; a self-hosted endpoint often does not,
    // so a custom one may run without a key.
    if target.provider != WebSearchApiProvider::Custom && api_key.trim().is_empty() {
        return Err(AppError::Agent(
            "search API key is not configured; set it in Settings → Agent tools".into(),
        ));
    }

    match target.provider {
        WebSearchApiProvider::Brave => {
            search_brave(
                BRAVE_URL,
                "api:brave",
                "Brave search",
                api_key,
                query,
                max_results,
            )
            .await
        }
        WebSearchApiProvider::Tavily => {
            search_tavily(
                TAVILY_URL,
                "api:tavily",
                "Tavily search",
                api_key,
                query,
                max_results,
            )
            .await
        }
        WebSearchApiProvider::Deepseek => {
            search_deepseek(None, "api:deepseek", api_key, query, max_results).await
        }
        WebSearchApiProvider::Custom => {
            let url = validate_custom_url(&target.custom.url)?;
            let (label, who) = ("api:custom", "custom search API");
            match target.custom.protocol {
                SearchApiProtocol::Brave => {
                    search_brave(&url, label, who, api_key, query, max_results).await
                }
                SearchApiProtocol::Tavily => {
                    search_tavily(&url, label, who, api_key, query, max_results).await
                }
                SearchApiProtocol::Deepseek => {
                    search_deepseek(Some(&url), label, api_key, query, max_results).await
                }
            }
        }
    }
}

/// See [`deepseek_api::validate_endpoint_url`]; the search flavour of the error text.
pub(crate) fn validate_custom_url(raw: &str) -> Result<String, AppError> {
    deepseek_api::validate_endpoint_url(raw, "custom search API")
}

fn http_client() -> Result<Client, AppError> {
    Client::builder()
        .timeout(Duration::from_secs(TIMEOUT_SECS))
        .build()
        .map_err(|e| AppError::Agent(format!("failed to create HTTP client: {}", e)))
}

/// Brave Search protocol: `GET <url>?q=&count=`, key in `X-Subscription-Token`,
/// hits under `web.results[]`.
async fn search_brave(
    url: &str,
    provider: &'static str,
    who: &str,
    api_key: &str,
    query: &str,
    max_results: usize,
) -> Result<SearchOutcome, AppError> {
    #[derive(Debug, Deserialize)]
    struct BraveResponse {
        #[serde(default)]
        web: Option<BraveWeb>,
    }
    #[derive(Debug, Deserialize)]
    struct BraveWeb {
        #[serde(default)]
        results: Vec<BraveItem>,
    }
    #[derive(Debug, Deserialize)]
    struct BraveItem {
        title: Option<String>,
        url: Option<String>,
        description: Option<String>,
    }

    let client = http_client()?;

    let count = max_results.clamp(1, 20);
    let mut request = client
        .get(url)
        .header("Accept", "application/json")
        .query(&[("q", query), ("count", &count.to_string())]);
    if !api_key.trim().is_empty() {
        request = request.header("X-Subscription-Token", api_key.trim());
    }
    let resp = request
        .send()
        .await
        .map_err(|e| AppError::Agent(format!("{} request failed: {}", who, e)))?;

    let status = resp.status();
    let body = resp
        .text()
        .await
        .map_err(|e| AppError::Agent(format!("failed to read {} response: {}", who, e)))?;

    if !status.is_success() {
        return Err(AppError::Agent(format!(
            "{} HTTP {}: {}",
            who,
            status,
            truncate_err(&body)
        )));
    }

    let parsed: BraveResponse = serde_json::from_str(&body)
        .map_err(|e| AppError::Agent(format!("invalid {} response: {}", who, e)))?;

    let results = map_brave_items(
        parsed
            .web
            .map(|w| w.results)
            .unwrap_or_default()
            .into_iter()
            .map(|item| (item.title, item.url, item.description)),
        max_results,
    );

    Ok(SearchOutcome {
        provider,
        results,
        // A search API either answers with results or fails outright; it never
        // hands back a verification interstitial.
        interception: None,
    })
}

/// Tavily protocol: `POST <url>` with the key in the body's `api_key`, hits under
/// `results[]` with `content` as the snippet.
async fn search_tavily(
    url: &str,
    provider: &'static str,
    who: &str,
    api_key: &str,
    query: &str,
    max_results: usize,
) -> Result<SearchOutcome, AppError> {
    #[derive(Debug, Deserialize)]
    struct TavilyResponse {
        #[serde(default)]
        results: Vec<TavilyItem>,
    }
    #[derive(Debug, Deserialize)]
    struct TavilyItem {
        title: Option<String>,
        url: Option<String>,
        content: Option<String>,
    }

    let client = http_client()?;

    let mut payload = serde_json::json!({
        "query": query,
        "max_results": max_results.clamp(1, 20),
        "include_answer": false,
        "search_depth": "basic",
    });
    // A keyless self-hosted endpoint must not be sent an empty credential field.
    if !api_key.trim().is_empty() {
        payload["api_key"] = serde_json::Value::String(api_key.trim().to_string());
    }

    let resp = client
        .post(url)
        .header("Content-Type", "application/json")
        .json(&payload)
        .send()
        .await
        .map_err(|e| AppError::Agent(format!("{} request failed: {}", who, e)))?;

    let status = resp.status();
    let body = resp
        .text()
        .await
        .map_err(|e| AppError::Agent(format!("failed to read {} response: {}", who, e)))?;

    if !status.is_success() {
        return Err(AppError::Agent(format!(
            "{} HTTP {}: {}",
            who,
            status,
            truncate_err(&body)
        )));
    }

    let parsed: TavilyResponse = serde_json::from_str(&body)
        .map_err(|e| AppError::Agent(format!("invalid {} response: {}", who, e)))?;

    let results = map_tavily_items(
        parsed
            .results
            .into_iter()
            .map(|item| (item.title, item.url, item.content)),
        max_results,
    );

    Ok(SearchOutcome {
        provider,
        results,
        interception: None,
    })
}

// ── DeepSeek ────────────────────────────────────────────────────────────────
// https://api-docs.deepseek.com/zh-cn/guides/search
//
// Auth, retry and error mapping are shared with `http_get`'s DeepSeek fetch in
// `deepseek_api`. The key is the DeepSeek tools slot, not the Brave/Tavily one
// (the caller picks it: `search_api_key` in the parent module).

/// The API rejects queries longer than 128 Unicode characters with a 400.
const DEEPSEEK_MAX_QUERY_CHARS: usize = 128;
/// The API accepts 1..=50; the tool never asks for more than 10 anyway.
const DEEPSEEK_MAX_COUNT: usize = 50;

#[derive(Debug, Deserialize)]
struct DeepseekResponse {
    #[serde(default)]
    results: Vec<DeepseekItem>,
}

#[derive(Debug, Deserialize)]
struct DeepseekItem {
    title: Option<String>,
    url: Option<String>,
    /// ~100–200 chars, written for UI display.
    snippet: Option<String>,
    /// ~600–800 chars, written for a model to read.
    summary: Option<String>,
    /// RFC 3339 in UTC, or null when unknown.
    date: Option<String>,
}

/// DeepSeek protocol: `POST <url>` with a Bearer key, hits under `results[]`.
/// `custom_url == None` is the official endpoint; `Some` is a user-supplied one that
/// speaks the same protocol (no vendor-specific hints, optional key, and no 128-char
/// query cap — that limit is the official service's, not the protocol's).
async fn search_deepseek(
    custom_url: Option<&str>,
    provider: &'static str,
    api_key: &str,
    query: &str,
    max_results: usize,
) -> Result<SearchOutcome, AppError> {
    // `need_content` stays at its default (false): `web_search` returns pointers,
    // and full pages are `http_get`'s job.
    let payload = serde_json::json!({
        "query": if custom_url.is_none() { clamp_deepseek_query(query) } else { query.to_string() },
        "count": max_results.clamp(1, DEEPSEEK_MAX_COUNT),
    });
    let timeout = Duration::from_secs(TIMEOUT_SECS);
    let body = match custom_url {
        None => deepseek_api::post_json("search", api_key, &payload, timeout).await?,
        Some(url) => {
            deepseek_api::post_json_custom(url, "custom search API", api_key, &payload, timeout)
                .await?
        }
    };

    Ok(SearchOutcome {
        provider,
        results: parse_deepseek_response(&body, max_results)?,
        interception: None,
    })
}

/// The API rejects over-long queries outright; a shortened query still finds
/// something, an error finds nothing.
fn clamp_deepseek_query(query: &str) -> String {
    match query.char_indices().nth(DEEPSEEK_MAX_QUERY_CHARS) {
        Some((byte_idx, _)) => query[..byte_idx].trim_end().to_string(),
        None => query.to_string(),
    }
}

fn parse_deepseek_response(body: &str, max_results: usize) -> Result<Vec<SearchResult>, AppError> {
    let parsed: DeepseekResponse = serde_json::from_str(body)
        .map_err(|e| AppError::Agent(format!("invalid DeepSeek response: {}", e)))?;
    Ok(map_deepseek_items(parsed.results, max_results))
}

fn map_deepseek_items(items: Vec<DeepseekItem>, max_results: usize) -> Vec<SearchResult> {
    items
        .into_iter()
        .filter_map(|item| {
            let title = item.title.unwrap_or_default().trim().to_string();
            let url = item.url.unwrap_or_default().trim().to_string();
            if title.is_empty() || url.is_empty() {
                return None;
            }
            // The long summary is what makes a result usable without a follow-up
            // `http_get`; the short snippet is the fallback when it is missing.
            let snippet = [item.summary, item.snippet]
                .into_iter()
                .flatten()
                .map(|s| s.trim().to_string())
                .find(|s| !s.is_empty())
                .unwrap_or_default();
            Some(SearchResult {
                title,
                url,
                snippet,
                date: item.date.as_deref().and_then(short_date),
            })
        })
        .take(max_results)
        .collect()
}

/// `2026-06-01T00:00:00+00:00` → `2026-06-01`. Anything that does not start with
/// a calendar-shaped date is dropped rather than shown half-parsed.
fn short_date(raw: &str) -> Option<String> {
    let head = raw.trim().get(..10)?;
    let b = head.as_bytes();
    let shaped = b.iter().enumerate().all(|(i, c)| match i {
        4 | 7 => *c == b'-',
        _ => c.is_ascii_digit(),
    });
    shaped.then(|| head.to_string())
}

fn map_brave_items<I>(items: I, max_results: usize) -> Vec<SearchResult>
where
    I: IntoIterator<Item = (Option<String>, Option<String>, Option<String>)>,
{
    items
        .into_iter()
        .filter_map(|(title, url, description)| {
            let title = title.unwrap_or_default().trim().to_string();
            let url = url.unwrap_or_default().trim().to_string();
            if title.is_empty() || url.is_empty() {
                return None;
            }
            Some(SearchResult {
                title,
                url,
                snippet: description.unwrap_or_default(),
                date: None,
            })
        })
        .take(max_results)
        .collect()
}

fn map_tavily_items<I>(items: I, max_results: usize) -> Vec<SearchResult>
where
    I: IntoIterator<Item = (Option<String>, Option<String>, Option<String>)>,
{
    items
        .into_iter()
        .filter_map(|(title, url, content)| {
            let title = title.unwrap_or_default().trim().to_string();
            let url = url.unwrap_or_default().trim().to_string();
            if title.is_empty() || url.is_empty() {
                return None;
            }
            Some(SearchResult {
                title,
                url,
                snippet: content.unwrap_or_default(),
                date: None,
            })
        })
        .take(max_results)
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::settings::WebSearchApiProvider;
    use std::io::{Read, Write};
    use std::net::TcpListener;
    use std::sync::{Arc, Mutex};

    fn builtin(provider: WebSearchApiProvider) -> ApiSearchTarget {
        ApiSearchTarget {
            provider,
            custom: CustomSearchApi::default(),
        }
    }

    fn custom(url: &str, protocol: SearchApiProtocol) -> ApiSearchTarget {
        ApiSearchTarget {
            provider: WebSearchApiProvider::Custom,
            custom: CustomSearchApi {
                url: url.to_string(),
                protocol,
            },
        }
    }

    /// Answers one request with `status`/`body` and records the raw request.
    fn serve_once(status: u16, body: &'static str) -> (String, Arc<Mutex<String>>) {
        let listener = TcpListener::bind("127.0.0.1:0").expect("bind");
        let addr = listener.local_addr().expect("addr");
        let seen = Arc::new(Mutex::new(String::new()));
        let seen_in_thread = Arc::clone(&seen);
        std::thread::spawn(move || {
            let Ok((mut stream, _)) = listener.accept() else {
                return;
            };
            let mut buf = vec![0u8; 16384];
            let n = stream.read(&mut buf).unwrap_or(0);
            *seen_in_thread.lock().unwrap() = String::from_utf8_lossy(&buf[..n]).into_owned();
            let reply = format!(
                "HTTP/1.1 {} X
Content-Type: application/json
Content-Length: {}
Connection: close

{}",
                status,
                body.len(),
                body
            );
            let _ = stream.write_all(reply.as_bytes());
        });
        (format!("http://{}/search", addr), seen)
    }

    #[tokio::test]
    async fn api_brave_mode_requires_key() {
        let err = search(&builtin(WebSearchApiProvider::Brave), "  ", "q", 5)
            .await
            .expect_err("empty key");
        let msg = err.to_string();
        assert!(
            msg.to_ascii_lowercase().contains("key"),
            "expected key error, got {msg}"
        );
    }

    #[tokio::test]
    async fn api_tavily_mode_requires_key() {
        let err = search(&builtin(WebSearchApiProvider::Tavily), "", "q", 5)
            .await
            .expect_err("empty key");
        let msg = err.to_string();
        assert!(
            msg.to_ascii_lowercase().contains("key"),
            "expected key error, got {msg}"
        );
    }

    #[tokio::test]
    async fn api_deepseek_mode_requires_key() {
        let err = search(&builtin(WebSearchApiProvider::Deepseek), " ", "q", 5)
            .await
            .expect_err("empty key");
        let msg = err.to_string();
        assert!(
            msg.to_ascii_lowercase().contains("key"),
            "expected key error, got {msg}"
        );
    }

    #[tokio::test]
    async fn custom_mode_without_a_url_says_so() {
        let err = search(&custom("  ", SearchApiProtocol::Brave), "k", "q", 5)
            .await
            .expect_err("no url");
        assert!(err.to_string().contains("URL is not configured"), "{err}");
    }

    #[test]
    fn custom_url_must_be_plain_http_without_credentials() {
        assert_eq!(
            validate_custom_url("  https://search.example.com/v1/search?x=1 ").unwrap(),
            "https://search.example.com/v1/search?x=1"
        );
        assert!(validate_custom_url("http://127.0.0.1:8080/search").is_ok());
        for bad in [
            "",
            "search.example.com/search",
            "ftp://example.com/x",
            "file:///etc/passwd",
            "https://user:pass@example.com/search",
            "https://user@example.com/search",
            "https://",
        ] {
            assert!(
                validate_custom_url(bad).is_err(),
                "{bad:?} must be rejected"
            );
        }
    }

    #[tokio::test]
    async fn custom_brave_protocol_sends_the_token_header_only_when_there_is_a_key() {
        let body =
            r#"{"web":{"results":[{"title":"A","url":"https://a.example","description":"da"}]}}"#;
        let (url, seen) = serve_once(200, body);
        let outcome = search(
            &custom(&url, SearchApiProtocol::Brave),
            " tok-1 ",
            "rust async",
            3,
        )
        .await
        .expect("brave-shaped answer");
        assert_eq!(outcome.provider, "api:custom");
        assert_eq!(outcome.results[0].title, "A");
        assert_eq!(outcome.results[0].snippet, "da");
        let request = seen.lock().unwrap().to_ascii_lowercase();
        assert!(
            request.starts_with("get /search?q=rust+async&count=3 ")
                || request.starts_with("get /search?q=rust%20async&count=3 "),
            "{request}"
        );
        assert!(
            request.contains("x-subscription-token: tok-1\r\n"),
            "{request}"
        );

        let (url, seen) = serve_once(200, body);
        search(&custom(&url, SearchApiProtocol::Brave), "", "q", 3)
            .await
            .expect("keyless");
        assert!(!seen
            .lock()
            .unwrap()
            .to_ascii_lowercase()
            .contains("x-subscription-token"));
    }

    #[tokio::test]
    async fn custom_tavily_protocol_puts_the_key_in_the_body_only_when_there_is_one() {
        let body = r#"{"results":[{"title":"T","url":"https://t.example","content":"ct"}]}"#;
        let (url, seen) = serve_once(200, body);
        let outcome = search(&custom(&url, SearchApiProtocol::Tavily), "tv-key", "q", 4)
            .await
            .expect("tavily-shaped answer");
        assert_eq!(outcome.provider, "api:custom");
        assert_eq!(outcome.results[0].snippet, "ct");
        let request = seen.lock().unwrap().clone();
        assert!(request.starts_with("POST /search "), "{request}");
        assert!(request.contains(r#""api_key":"tv-key""#), "{request}");
        assert!(request.contains(r#""max_results":4"#), "{request}");

        let (url, seen) = serve_once(200, body);
        search(&custom(&url, SearchApiProtocol::Tavily), "", "q", 4)
            .await
            .expect("keyless");
        assert!(!seen.lock().unwrap().contains("api_key"));
    }

    #[tokio::test]
    async fn custom_deepseek_protocol_uses_bearer_dates_and_does_not_clamp_the_query() {
        let body = r#"{"results":[{"title":"D","url":"https://d.example","summary":"long","snippet":"short","date":"2026-06-01T00:00:00+00:00"}]}"#;
        let long_query = "q".repeat(300);
        let (url, seen) = serve_once(200, body);
        let outcome = search(
            &custom(&url, SearchApiProtocol::Deepseek),
            "ds-key",
            &long_query,
            5,
        )
        .await
        .expect("deepseek-shaped answer");
        assert_eq!(outcome.provider, "api:custom");
        assert_eq!(outcome.results[0].snippet, "long");
        assert_eq!(outcome.results[0].date.as_deref(), Some("2026-06-01"));
        let request = seen.lock().unwrap().clone();
        assert!(
            request
                .to_ascii_lowercase()
                .contains("authorization: bearer ds-key\r\n"),
            "{request}"
        );
        assert!(
            request.contains(&long_query),
            "a custom endpoint's own limits are not ours to apply"
        );

        let (url, seen) = serve_once(200, body);
        search(&custom(&url, SearchApiProtocol::Deepseek), "", "q", 5)
            .await
            .expect("keyless");
        assert!(!seen
            .lock()
            .unwrap()
            .to_ascii_lowercase()
            .contains("authorization"));
    }

    /// An error from someone else's service must not be dressed up as DeepSeek's
    /// ("use your DeepSeek API key", "top up your DeepSeek balance").
    #[tokio::test]
    async fn custom_errors_name_the_custom_api_not_a_vendor() {
        for protocol in [
            SearchApiProtocol::Brave,
            SearchApiProtocol::Tavily,
            SearchApiProtocol::Deepseek,
        ] {
            let (url, _) = serve_once(401, r#"{"error":{"message":"bad token"}}"#);
            let err = search(&custom(&url, protocol), "k", "q", 3)
                .await
                .expect_err("401")
                .to_string();
            assert!(err.contains("custom search API"), "{protocol:?}: {err}");
            assert!(err.contains("401"), "{protocol:?}: {err}");
            assert!(!err.contains("DeepSeek"), "{protocol:?}: {err}");
        }
    }

    /// The sample response from the official docs, verbatim.
    const DEEPSEEK_SAMPLE: &str = r#"{
      "results": [
        {
          "rerank_score": 2.4,
          "title": "DeepSeek V4 模型发布",
          "url": "https://example.com/deepseek-v4",
          "snippet": "DeepSeek V4 已上线，支持工具调用与长上下文。",
          "summary": "DeepSeek 发布了 V4 模型。此次发布改进了工具调用与长上下文能力，适合 Agent 工作流。",
          "content": "",
          "site_name": "Example News",
          "site_icon": "https://example.com/favicon.ico",
          "date": "2026-06-01T00:00:00+00:00",
          "authority": 3
        }
      ]
    }"#;

    #[test]
    fn deepseek_response_prefers_summary_and_keeps_the_date() {
        let results = parse_deepseek_response(DEEPSEEK_SAMPLE, 8).unwrap();
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].title, "DeepSeek V4 模型发布");
        assert_eq!(results[0].url, "https://example.com/deepseek-v4");
        assert!(results[0].snippet.starts_with("DeepSeek 发布了 V4"));
        assert_eq!(results[0].date.as_deref(), Some("2026-06-01"));
    }

    #[test]
    fn deepseek_snippet_is_the_fallback_when_summary_is_absent_or_blank() {
        let body = r#"{"results":[
            {"title":"A","url":"https://a.example","snippet":"short a","summary":"  ","date":null},
            {"title":"B","url":"https://b.example","snippet":"short b"}
        ]}"#;
        let results = parse_deepseek_response(body, 8).unwrap();
        assert_eq!(results[0].snippet, "short a");
        assert_eq!(results[0].date, None);
        assert_eq!(results[1].snippet, "short b");
    }

    #[test]
    fn deepseek_skips_incomplete_items_and_respects_max() {
        let body = r#"{"results":[
            {"title":"A","url":"https://a.example","summary":"sa"},
            {"title":"","url":"https://blank.example","summary":"x"},
            {"title":"C","summary":"no url"},
            {"title":"D","url":"https://d.example","summary":"sd"},
            {"title":"E","url":"https://e.example","summary":"se"}
        ]}"#;
        let results = parse_deepseek_response(body, 2).unwrap();
        let titles: Vec<_> = results.iter().map(|r| r.title.as_str()).collect();
        assert_eq!(titles, ["A", "D"]);
    }

    #[test]
    fn deepseek_empty_results_is_not_an_error() {
        assert!(parse_deepseek_response(r#"{"results":[]}"#, 5)
            .unwrap()
            .is_empty());
        assert!(parse_deepseek_response("{}", 5).unwrap().is_empty());
        assert!(parse_deepseek_response("not json", 5).is_err());
    }

    #[test]
    fn short_date_keeps_only_calendar_shaped_prefixes() {
        assert_eq!(
            short_date("2026-06-01T00:00:00+00:00").as_deref(),
            Some("2026-06-01")
        );
        assert_eq!(short_date("2026-06-01").as_deref(), Some("2026-06-01"));
        assert_eq!(short_date(""), None);
        assert_eq!(short_date("June 1st"), None);
        assert_eq!(short_date("2026/06/01"), None);
        // A multi-byte char straddling byte 10 must not panic.
        assert_eq!(short_date("二〇二六年六月一日"), None);
    }

    #[test]
    fn deepseek_query_is_cut_to_128_chars_on_a_char_boundary() {
        let short = "DeepSeek 搜索";
        assert_eq!(clamp_deepseek_query(short), short);

        let long: String = "搜".repeat(300);
        let cut = clamp_deepseek_query(&long);
        assert_eq!(cut.chars().count(), DEEPSEEK_MAX_QUERY_CHARS);

        // Exactly at the limit is untouched; a trailing space at the cut is dropped.
        let exact: String = "a".repeat(DEEPSEEK_MAX_QUERY_CHARS);
        assert_eq!(clamp_deepseek_query(&exact), exact);
        let spaced = format!("{} tail", "a".repeat(DEEPSEEK_MAX_QUERY_CHARS - 1));
        assert!(!clamp_deepseek_query(&spaced).ends_with(' '));
    }

    #[test]
    fn map_brave_items_skips_incomplete_and_respects_max() {
        let items = vec![
            (
                Some("A".into()),
                Some("https://a.example".into()),
                Some("sa".into()),
            ),
            (Some("B".into()), None, Some("sb".into())),
            (
                Some("C".into()),
                Some("https://c.example".into()),
                Some("sc".into()),
            ),
            (
                Some("D".into()),
                Some("https://d.example".into()),
                Some("sd".into()),
            ),
        ];
        let results = map_brave_items(items, 2);
        assert_eq!(results.len(), 2);
        assert_eq!(results[0].title, "A");
        assert_eq!(results[1].title, "C");
        assert_eq!(results[0].snippet, "sa");
    }

    #[test]
    fn map_tavily_items_maps_content_to_snippet() {
        let items = vec![(
            Some("Tok".into()),
            Some("https://tokio.rs".into()),
            Some("async runtime".into()),
        )];
        let results = map_tavily_items(items, 5);
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].url, "https://tokio.rs");
        assert_eq!(results[0].snippet, "async runtime");
    }

    #[test]
    fn api_brave_mode_outcome_provider_label() {
        let results = map_brave_items(
            vec![(
                Some("X".into()),
                Some("https://x.example".into()),
                Some("sx".into()),
            )],
            5,
        );
        let outcome = SearchOutcome {
            provider: "api:brave",
            results,
            interception: None,
        };
        assert_eq!(outcome.provider, "api:brave");
        assert_eq!(outcome.results[0].title, "X");
    }

    #[test]
    fn api_tavily_mode_outcome_provider_label() {
        let results = map_tavily_items(
            vec![(
                Some("Y".into()),
                Some("https://y.example".into()),
                Some("sy".into()),
            )],
            5,
        );
        let outcome = SearchOutcome {
            provider: "api:tavily",
            results,
            interception: None,
        };
        assert_eq!(outcome.provider, "api:tavily");
        assert_eq!(outcome.results[0].snippet, "sy");
    }

    #[test]
    fn map_brave_and_tavily_empty_input() {
        assert!(map_brave_items(
            Vec::<(Option<String>, Option<String>, Option<String>)>::new(),
            5
        )
        .is_empty());
        assert!(map_tavily_items(
            Vec::<(Option<String>, Option<String>, Option<String>)>::new(),
            5
        )
        .is_empty());
    }
}
