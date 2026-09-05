use crate::models::InterviewResponse;

pub fn os_label_from_consts(os: &str) -> &str {
    match os {
        "windows" => "Windows",
        "macos" => "macOS",
        "linux" => "Linux",
        other => other,
    }
}

pub fn host_os_label() -> &'static str {
    os_label_from_consts(std::env::consts::OS)
}

pub fn interview_begin_user(os_label: &str) -> String {
    format!(
        "Begin the interview. The user's operating system is {os_label}. Do not ask which OS they use."
    )
}

pub fn interview_system_prompt() -> &'static str {
    include_str!("../../GuidelinesInterviewPrompt.md")
}

fn strip_optional_fence(s: &str) -> &str {
    let t = s.trim();
    let Some(rest) = t.strip_prefix("```") else {
        return t;
    };
    let after_info = match rest.find('\n') {
        Some(i) => &rest[i + 1..],
        None => rest,
    };
    after_info.trim().strip_suffix("```").unwrap_or(after_info).trim()
}

pub fn parse_interview_reply(raw: &str) -> InterviewResponse {
    let candidate = strip_optional_fence(raw);
    let Ok(value) = serde_json::from_str::<serde_json::Value>(candidate) else {
        return InterviewResponse::Message {
            content: raw.to_string(),
        };
    };
    let Some(obj) = value.as_object() else {
        return InterviewResponse::Message {
            content: raw.to_string(),
        };
    };
    let complete = obj.get("interview_complete") == Some(&serde_json::Value::Bool(true));
    let markdown = obj
        .get("guidelines_markdown")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    if complete && !markdown.trim().is_empty() {
        InterviewResponse::Complete {
            guidelines_markdown: markdown,
        }
    } else {
        InterviewResponse::Message {
            content: raw.to_string(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_interview_reply_valid_envelope_returns_complete() {
        let raw = "{\"interview_complete\":true,\"guidelines_markdown\":\"# Title\\n\\nHello\"}";
        assert_eq!(
            parse_interview_reply(raw),
            InterviewResponse::Complete {
                guidelines_markdown: "# Title\n\nHello".to_string(),
            }
        );
    }

    #[test]
    fn parse_interview_reply_fenced_json_returns_complete() {
        let raw = "```json\n{\"interview_complete\":true,\"guidelines_markdown\":\"# G\"}\n```";
        assert_eq!(
            parse_interview_reply(raw),
            InterviewResponse::Complete {
                guidelines_markdown: "# G".to_string(),
            }
        );
    }

    #[test]
    fn parse_interview_reply_fence_without_language_returns_complete() {
        let raw = "```\n{\"interview_complete\":true,\"guidelines_markdown\":\"# G\"}\n```";
        assert_eq!(
            parse_interview_reply(raw),
            InterviewResponse::Complete {
                guidelines_markdown: "# G".to_string(),
            }
        );
    }

    #[test]
    fn parse_interview_reply_prose_returns_message() {
        let raw = "What GPU do you have?";
        assert_eq!(
            parse_interview_reply(raw),
            InterviewResponse::Message {
                content: raw.to_string(),
            }
        );
    }

    #[test]
    fn parse_interview_reply_malformed_json_returns_message() {
        let raw = "{\"interview_complete\": true,";
        assert_eq!(
            parse_interview_reply(raw),
            InterviewResponse::Message {
                content: raw.to_string(),
            }
        );
    }

    #[test]
    fn parse_interview_reply_missing_complete_flag_returns_message() {
        let raw = "{\"guidelines_markdown\":\"# G\"}";
        assert_eq!(
            parse_interview_reply(raw),
            InterviewResponse::Message {
                content: raw.to_string(),
            }
        );
    }

    #[test]
    fn parse_interview_reply_complete_false_returns_message() {
        let raw = "{\"interview_complete\":false,\"guidelines_markdown\":\"# G\"}";
        assert_eq!(
            parse_interview_reply(raw),
            InterviewResponse::Message {
                content: raw.to_string(),
            }
        );
    }

    #[test]
    fn parse_interview_reply_empty_markdown_returns_message() {
        let raw = "{\"interview_complete\":true,\"guidelines_markdown\":\"  \"}";
        assert_eq!(
            parse_interview_reply(raw),
            InterviewResponse::Message {
                content: raw.to_string(),
            }
        );
    }

    #[test]
    fn parse_interview_reply_empty_string_returns_message() {
        let raw = "";
        assert_eq!(
            parse_interview_reply(raw),
            InterviewResponse::Message {
                content: "".to_string(),
            }
        );
    }

    #[test]
    fn parse_interview_reply_prose_then_json_returns_message() {
        let raw = "Here you go:\n{\"interview_complete\":true,\"guidelines_markdown\":\"# G\"}";
        assert_eq!(
            parse_interview_reply(raw),
            InterviewResponse::Message {
                content: raw.to_string(),
            }
        );
    }

    #[test]
    fn parse_interview_reply_complete_string_true_returns_message() {
        let raw = "{\"interview_complete\":\"true\",\"guidelines_markdown\":\"# G\"}";
        assert_eq!(
            parse_interview_reply(raw),
            InterviewResponse::Message {
                content: raw.to_string(),
            }
        );
    }

    #[test]
    fn interview_system_prompt_is_the_consultant_not_docs() {
        let prompt = interview_system_prompt();
        assert!(prompt.contains("consultant"));
        assert!(prompt.contains("interview_complete"));
        assert!(!prompt.contains("Notes for Developers"));
        assert!(!prompt.contains("How to Use This Prompt"));
        assert!(!prompt.contains("Expected Final Output"));
        assert!(prompt.contains("The first user message states the host OS"));
        assert!(!prompt.contains("What OS are they running?"));
    }

    #[test]
    fn os_label_from_consts_windows() {
        assert_eq!(os_label_from_consts("windows"), "Windows");
    }

    #[test]
    fn os_label_from_consts_macos() {
        assert_eq!(os_label_from_consts("macos"), "macOS");
    }

    #[test]
    fn os_label_from_consts_linux() {
        assert_eq!(os_label_from_consts("linux"), "Linux");
    }

    #[test]
    fn os_label_from_consts_other_passthrough() {
        assert_eq!(os_label_from_consts("freebsd"), "freebsd");
    }

    #[test]
    fn interview_begin_user_includes_os_and_forbids_asking() {
        assert_eq!(
            interview_begin_user("Windows"),
            "Begin the interview. The user's operating system is Windows. Do not ask which OS they use."
        );
    }
}
