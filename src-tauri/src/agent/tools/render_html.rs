//! `render_html` — render an interactive HTML fragment inline in the conversation.

use async_trait::async_trait;
use serde_json::json;

use crate::agent::risk::Disposition;
use crate::agent::tools::{AgentTool, ToolContext, ToolOutput};
use crate::error::AppError;

const MAX_FRAGMENT_BYTES: usize = 1024 * 1024;

/// 判定「被二次转义」所需的字面 `\n` / `\"` 个数下限。脚本字符串里零星出现的
/// `'a\nb'`、`"say \"hi\""` 是正常写法，达不到门槛。
const MIN_ESCAPE_SEQUENCES: usize = 3;

/// fragment 里转义序列的统计（按解码后的字符串数，不是原始 JSON 文本）。
struct EscapeCounts {
    /// 字面的反斜杠 + `n`（两个字符）。
    backslash_n: usize,
    /// 字面的反斜杠 + 双引号。
    backslash_quote: usize,
    /// 前面没有反斜杠的双引号。
    bare_quotes: usize,
    /// 是否含真实的换行字符（`\n` / `\r`）。
    has_real_newline: bool,
}

fn count_escapes(fragment: &str) -> EscapeCounts {
    // 只数 ASCII 字节：UTF-8 多字节序列里不会出现 ASCII 字节，按字节扫描是安全的。
    let bytes = fragment.as_bytes();
    let mut counts = EscapeCounts {
        backslash_n: 0,
        backslash_quote: 0,
        bare_quotes: 0,
        has_real_newline: false,
    };
    for (i, &b) in bytes.iter().enumerate() {
        match b {
            b'\n' | b'\r' => counts.has_real_newline = true,
            b'\\' => match bytes.get(i + 1) {
                Some(b'n') => counts.backslash_n += 1,
                Some(b'"') => counts.backslash_quote += 1,
                _ => {}
            },
            b'"' if i == 0 || bytes[i - 1] != b'\\' => counts.bare_quotes += 1,
            _ => {}
        }
    }
    counts
}

/// 模型把 fragment「预先转义」了一层：参数 JSON 解码之后，换行、引号仍是字面的
/// 反斜杠序列，而不是真实字符。页面会把这些反斜杠原样显示出来，脚本以它们开头更是
/// 语法错误 —— 整个可视化是坏的，而且没有任何报错，用户只看到一页乱码和一张空图。
///
/// 判据只看解码后的字符串本身，与模型走哪种工具调用格式无关：
/// - 没有一个真实换行，却有 ≥ 3 个字面 `\n`；
/// - 或者字面 `\"` ≥ 3 个，且比正常引号还多。
/// 带着真实换行的正常 fragment 不会走第一条；脚本里零星的 `\n` / `\"` 达不到门槛。
///
/// 返回命中的症状（给模型看的英文描述），空 = 没问题。按症状分别描述，是为了不把
/// 与病因无关的事实（比如单行 fragment 本来就没有换行）说成原因。
fn double_escape_findings(counts: &EscapeCounts) -> Vec<String> {
    let mut findings = Vec::new();
    if !counts.has_real_newline && counts.backslash_n >= MIN_ESCAPE_SEQUENCES {
        findings.push(format!(
            "{} literal backslash-n sequences and no real line breaks",
            counts.backslash_n
        ));
    }
    if counts.backslash_quote >= MIN_ESCAPE_SEQUENCES && counts.backslash_quote > counts.bare_quotes
    {
        findings.push(format!(
            "{} literal backslash-quote sequences versus {} plain quotes",
            counts.backslash_quote, counts.bare_quotes
        ));
    }
    findings
}

fn document_skeleton_tag(fragment: &str) -> Option<&'static str> {
    let lower = fragment.to_ascii_lowercase();
    let bytes = lower.as_bytes();
    let mut cursor = 0;
    while cursor < bytes.len() {
        if bytes[cursor] != b'<' {
            cursor += 1;
            continue;
        }
        let mut i = cursor + 1;
        while i < bytes.len() && bytes[i].is_ascii_whitespace() {
            i += 1;
        }
        if bytes.get(i) == Some(&b'!') {
            i += 1;
            while i < bytes.len() && bytes[i].is_ascii_whitespace() {
                i += 1;
            }
            if lower[i..].starts_with("doctype") {
                return Some("doctype");
            }
        }
        if bytes.get(i) == Some(&b'/') {
            i += 1;
            while i < bytes.len() && bytes[i].is_ascii_whitespace() {
                i += 1;
            }
        }
        let start = i;
        while i < bytes.len() && bytes[i].is_ascii_alphabetic() {
            i += 1;
        }
        match &lower[start..i] {
            "html" => return Some("html"),
            "head" => return Some("head"),
            "body" => return Some("body"),
            "frameset" => return Some("frameset"),
            _ => cursor += 1,
        }
    }
    None
}

fn run(params: &serde_json::Value) -> ToolOutput {
    let title = params
        .get("title")
        .and_then(|v| v.as_str())
        .unwrap_or("Visualization")
        .trim();
    let fragment = params
        .get("fragment")
        .and_then(|v| v.as_str())
        .unwrap_or("");
    let mode = params
        .get("mode")
        .and_then(|v| v.as_str())
        .unwrap_or("inline");

    if title.is_empty() {
        return ToolOutput::fail("render_html: 缺少 title", "Missing 'title' parameter");
    }
    if fragment.trim().is_empty() {
        return ToolOutput::fail(
            "render_html: 缺少 fragment",
            "Missing or empty 'fragment' parameter",
        );
    }
    if !matches!(mode, "inline" | "wide") {
        return ToolOutput::fail(
            "render_html: mode 无效",
            "Invalid 'mode': expected 'inline' or 'wide'",
        );
    }
    if fragment.len() > MAX_FRAGMENT_BYTES {
        return ToolOutput::fail(
            "render_html: fragment 过大",
            format!(
                "Fragment is {} bytes, exceeding the {} KB limit. Reduce inline data first.",
                fragment.len(),
                MAX_FRAGMENT_BYTES / 1024
            ),
        );
    }

    let findings = double_escape_findings(&count_escapes(fragment));
    if !findings.is_empty() {
        // 不落「已展示」：坏页面一旦成功落库，用户重载也是坏的。把原因和写法回给模型，
        // 让它原样重发一次；调用失败后前端（HtmlVisualization）把页面换成一行失败提示，
        // 生成过程中页面照常长出来。
        return ToolOutput::fail(
            "render_html: 内容被二次转义，已请模型重发",
            format!(
                "Fragment is double-escaped: it contains {}. The page would show these backslashes verbatim and its script would fail with a syntax error. Tool arguments are JSON-encoded for you, so write the fragment as plain HTML — real line breaks and ordinary quotes, no pre-escaping — and call render_html again with the same content.",
                findings.join(" and ")
            ),
        );
    }

    if let Some(tag) = document_skeleton_tag(fragment) {
        return ToolOutput::fail(
            "render_html: 只接受 HTML fragment",
            format!(
                "Fragment contains document skeleton tag '{tag}'. Pass body markup only; the host supplies the document, CSP, theme, and runtime."
            ),
        );
    }

    ToolOutput::ok(
        format!("已展示: {}", title),
        format!(
            "Rendered \"{}\" inline ({} bytes). The user can see and interact with it; do not repeat the markup in your reply.",
            title,
            fragment.len()
        ),
    )
    .with_metadata(json!({
        "kind": "renderHtml",
        "title": title,
        "fragment": fragment,
        "mode": mode,
        "sizeBytes": fragment.len(),
    }))
}

pub struct RenderHtmlTool;

impl RenderHtmlTool {
    pub fn new() -> Self {
        Self
    }
}

impl Default for RenderHtmlTool {
    fn default() -> Self {
        Self::new()
    }
}

#[async_trait]
impl AgentTool for RenderHtmlTool {
    fn name(&self) -> &str {
        "render_html"
    }

    fn description(&self) -> &str {
        "Show an interactive HTML visualization directly in the conversation — it is rendered inside the app, nothing is written to the server. Proactively use it for charts, simulations, comparisons, parameter exploration, algorithm walkthroughs, dashboards, and UI mockups whenever visual presentation would improve understanding; the user need not explicitly ask for a visualization. `fragment` is literal inline body markup only (no document skeleton); optional `title` names it and `mode` is inline or wide. The page appears while you generate it. Before the first call, follow the enabled Visualize skill for the design rules, motion contract, CSP limits, and response rules."
    }

    fn parameters_schema(&self) -> serde_json::Value {
        json!({
            "type": "object",
            "properties": {
                "title": {
                    "type": "string",
                    "description": "Concise title; defaults to Visualization"
                },
                "mode": {
                    "type": "string",
                    "enum": ["inline", "wide"],
                    "description": "Conversation width: inline (default) or wide for side-by-side comparisons"
                },
                "fragment": {
                    "type": "string",
                    "description": "Required inline HTML body fragment (markup, style, and script; no document skeleton)"
                }
            },
            "required": ["fragment"]
        })
    }

    fn disposition(&self) -> Disposition {
        Disposition::Allow
    }

    async fn execute(
        &self,
        params: serde_json::Value,
        _ctx: &ToolContext,
    ) -> Result<ToolOutput, AppError> {
        Ok(run(&params))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_fragment_and_persists_presentation_metadata() {
        let out = run(&json!({
            "title": "CPU 对比",
            "fragment": "<section><h2>CPU</h2></section>",
            "mode": "wide"
        }));
        assert!(out.success);
        assert!(!out.output.contains("<section>"));
        let meta = out.metadata.expect("metadata");
        assert_eq!(meta["kind"], "renderHtml");
        assert_eq!(meta["fragment"], "<section><h2>CPU</h2></section>");
        assert_eq!(meta["mode"], "wide");
    }

    #[test]
    fn defaults_title_and_mode() {
        let out = run(&json!({ "fragment": "<p>x</p>" }));
        let meta = out.metadata.expect("metadata");
        assert_eq!(meta["title"], "Visualization");
        assert_eq!(meta["mode"], "inline");
    }

    #[test]
    fn rejects_empty_fragment() {
        assert!(!run(&json!({ "fragment": "   " })).success);
    }

    #[test]
    fn rejects_document_skeleton() {
        for fragment in [
            "<!DOCTYPE html><p>x</p>",
            "<HTML><body>x</body></HTML>",
            "<head><title>x</title></head>",
            "<section>x</section></body>",
            "<  /  BODY>",
        ] {
            assert!(!run(&json!({ "fragment": fragment })).success);
        }
    }

    #[test]
    fn rejects_invalid_mode() {
        assert!(!run(&json!({ "fragment": "<p>x</p>", "mode": "fullscreen" })).success);
    }

    #[test]
    fn rejects_oversized_fragment() {
        let big = "x".repeat(MAX_FRAGMENT_BYTES + 1);
        assert!(!run(&json!({ "fragment": big })).success);
    }

    // 下面的 fragment 用原始字符串写：`\n` / `\"` 是字面的反斜杠序列，正是模型把页面
    // 预先转义一层之后、参数 JSON 解码出来的样子。

    #[test]
    fn rejects_fragment_with_literal_newlines_and_no_real_ones() {
        let out = run(&json!({
            "fragment": r##"<div id="x">\n<style>\n#x{color:red}\n</style>\n<p>hi</p>\n</div>"##
        }));
        assert!(!out.success);
        assert!(out.summary.contains("二次转义"));
        assert!(out.output.contains("double-escaped"));
        assert!(out.output.contains("no real line breaks"));
        assert!(out.metadata.is_none(), "坏页面不能带着展示元数据落库");
    }

    #[test]
    fn rejects_fragment_with_mostly_escaped_quotes() {
        let out = run(&json!({
            "fragment": "<input type=\\\"range\\\" id=\\\"k\\\" value=\\\"2\\\">"
        }));
        assert!(!out.success);
        assert!(out.output.contains("double-escaped"));
        assert!(out.output.contains("plain quotes"));
        assert!(
            !out.output.contains("no real line breaks"),
            "只有引号被转义时，不该把「单行本来就没有换行」说成病因"
        );
    }

    #[test]
    fn rejects_the_mixed_shape_seen_in_the_wild() {
        // 实际出过的样子：开头引号还是对的，越往后转义越乱，换行全是字面的。
        let out = run(&json!({
            "fragment": r##"<div id="recip-root" class="rc-intro">\n<style>\n#recip-root{gap:12px}\n</style>\n<input type=\"range\" id=\"rc-k\" value=\"2\">\n<script>\n(function(){})();\n</script>\n</div>"##
        }));
        assert!(!out.success);
        assert!(out.output.contains("double-escaped"));
    }

    #[test]
    fn accepts_real_newlines_even_with_escapes_inside_script_strings() {
        let fragment = "<div id=\"x\"></div>\n<script>\nvar s = 'a\\nb\\nc\\nd';\nvar t = \"say \\\"hi\\\"\";\n</script>";
        assert!(run(&json!({ "fragment": fragment })).success);
    }

    #[test]
    fn accepts_one_line_fragment_with_a_single_literal_newline() {
        let fragment = "<div id=\"x\"></div><script>alert('a\\nb')</script>";
        assert!(run(&json!({ "fragment": fragment })).success);
    }

    #[test]
    fn escape_counts_only_count_ascii_sequences_inside_multibyte_text() {
        let counts = count_escapes("反比例函数\\n\\\"图\\\"\n");
        assert_eq!(counts.backslash_n, 1);
        assert_eq!(counts.backslash_quote, 2);
        assert_eq!(counts.bare_quotes, 0);
        assert!(counts.has_real_newline);
    }
}
