use crate::interview_ops::{host_os_label, interview_begin_user, interview_system_prompt, parse_interview_reply};
use crate::models::{AiProviderConfig, AiResponse, ChatMessage, FileMetadata, InterviewResponse};
use reqwest::header::{HeaderMap, HeaderValue, AUTHORIZATION, CONTENT_TYPE};
use serde::{Deserialize, Serialize};

#[derive(Debug, thiserror::Error)]
pub enum AiError {
    #[error("HTTP request failed: {0}")]
    Http(#[from] reqwest::Error),
    #[error("Invalid response: {0}")]
    InvalidResponse(String),
    #[error("API error: {0}")]
    ApiError(String),
}

#[derive(Debug, Serialize)]
struct ChatRequest {
    model: String,
    messages: Vec<ChatMessage>,
    temperature: f64,
    max_tokens: i32,
    #[serde(skip_serializing_if = "Option::is_none")]
    response_format: Option<ResponseFormat>,
}

#[derive(Debug, Serialize)]
struct ResponseFormat {
    #[serde(rename = "type")]
    format_type: String,
}

#[derive(Debug, Deserialize)]
struct ChatResponse {
    choices: Vec<Choice>,
}

#[derive(Debug, Deserialize)]
struct Choice {
    message: ChoiceMessage,
}

#[derive(Debug, Deserialize)]
struct ChoiceMessage {
    content: String,
}

#[derive(Debug, Deserialize)]
struct ModelsResponse {
    data: Vec<ModelEntry>,
}

#[derive(Debug, Deserialize)]
struct ModelEntry {
    id: String,
}

pub async fn fetch_models(
    base_url: &str,
    api_key: &str,
) -> Result<Vec<String>, AiError> {
    let client = reqwest::Client::new();

    let mut headers = HeaderMap::new();
    headers.insert(CONTENT_TYPE, HeaderValue::from_static("application/json"));

    if !api_key.is_empty() {
        let auth = format!("Bearer {}", api_key);
        headers.insert(
            AUTHORIZATION,
            HeaderValue::from_str(&auth).unwrap_or_else(|_| HeaderValue::from_static("")),
        );
    }

    let url = format!("{}/models", base_url.trim_end_matches('/'));

    let response = client
        .get(&url)
        .headers(headers)
        .send()
        .await?;

    if !response.status().is_success() {
        let error_text = response.text().await.unwrap_or_else(|_| "Unknown error".to_string());
        return Err(AiError::ApiError(error_text));
    }

    let models_response: ModelsResponse = response.json().await?;

    let mut model_ids: Vec<String> = models_response
        .data
        .into_iter()
        .map(|m| m.id)
        .collect();

    model_ids.sort_by(|a, b| a.to_lowercase().cmp(&b.to_lowercase()));

    Ok(model_ids)
}

pub async fn chat_completion(
    provider: &AiProviderConfig,
    messages: Vec<ChatMessage>,
    temperature: f64,
    max_tokens: i32,
    json_object: bool,
) -> Result<String, AiError> {
    let client = reqwest::Client::new();

    let mut headers = HeaderMap::new();
    headers.insert(CONTENT_TYPE, HeaderValue::from_static("application/json"));

    if !provider.api_key.is_empty() {
        let auth = format!("Bearer {}", provider.api_key);
        headers.insert(
            AUTHORIZATION,
            HeaderValue::from_str(&auth).unwrap_or_else(|_| HeaderValue::from_static("")),
        );
    }

    let request_body = ChatRequest {
        model: provider.model.clone(),
        messages,
        temperature,
        max_tokens,
        response_format: if json_object {
            Some(ResponseFormat {
                format_type: "json_object".to_string(),
            })
        } else {
            None
        },
    };

    let url = format!("{}/chat/completions", provider.base_url.trim_end_matches('/'));

    let response = client
        .post(&url)
        .headers(headers)
        .json(&request_body)
        .send()
        .await?;

    if !response.status().is_success() {
        let error_text = response.text().await.unwrap_or_else(|_| "Unknown error".to_string());
        return Err(AiError::ApiError(error_text));
    }

    let chat_response: ChatResponse = response.json().await?;

    chat_response
        .choices
        .first()
        .map(|c| c.message.content.clone())
        .ok_or_else(|| AiError::InvalidResponse("No choices in response".to_string()))
}

pub async fn generate_command(
    provider: &AiProviderConfig,
    guidelines: &str,
    metadata: &FileMetadata,
    previous_command: &str,
    user_notes: &[String],
    error_message: &str,
) -> Result<AiResponse, AiError> {
    let system_prompt = build_system_prompt(guidelines);
    let user_prompt = build_user_prompt(metadata, previous_command, user_notes, error_message);

    let content = chat_completion(
        provider,
        vec![
            ChatMessage { role: "system".to_string(), content: system_prompt },
            ChatMessage { role: "user".to_string(), content: user_prompt },
        ],
        0.3,
        4096,
        true,
    ).await?;

    // Try to parse as JSON
    let ai_response: AiResponse = match serde_json::from_str(&content) {
        Ok(parsed) => parsed,
        Err(_) => {
            // Fallback: wrap raw text as description
            AiResponse {
                command: content.clone(),
                description: content,
                reasoning: String::new(),
            }
        }
    };

    Ok(ai_response)
}

pub async fn interview_turn(
    provider: &AiProviderConfig,
    mut messages: Vec<ChatMessage>,
) -> Result<InterviewResponse, AiError> {
    if messages.is_empty() {
        messages.push(ChatMessage {
            role: "user".to_string(),
            content: interview_begin_user(host_os_label()),
        });
    }

    let mut with_system = Vec::with_capacity(messages.len() + 1);
    with_system.push(ChatMessage {
        role: "system".to_string(),
        content: interview_system_prompt().to_string(),
    });
    with_system.extend(messages);

    let content = chat_completion(provider, with_system, 0.4, 16384, false).await?;
    Ok(parse_interview_reply(&content))
}

pub fn build_system_prompt(guidelines: &str) -> String {
    format!(
        r#"You are an expert FFmpeg command generator for video library transcoding.

Your task is to analyze video metadata and generate the optimal FFmpeg arguments.

## Guidelines
{}

## Output Format
You MUST respond with a JSON object containing exactly these fields:
- "command": The ffmpeg arguments only (do NOT include the ffmpeg executable name, do NOT include -i input, and do NOT include the output path — those will be added automatically)
- "description": A brief human-readable explanation of what the command does
- "reasoning": Your reasoning for the decisions made (codec choice, mapping, etc.)

Rules:
1. Output ONLY ffmpeg arguments (e.g., "-c:v copy -c:a opus -map 0")
2. Do NOT include "ffmpeg" prefix
3. Do NOT include -i or the input/output file paths
4. Always include -y flag to overwrite output
5. Use single-line format (no backticks or line continuations)
"#,
        guidelines
    )
}

fn build_user_prompt(
    metadata: &FileMetadata,
    previous_command: &str,
    user_notes: &[String],
    error_message: &str,
) -> String {
    let mut audio_info = String::new();
    for stream in &metadata.audio_streams {
        audio_info.push_str(&format!(
            "  - Stream {}: {} codec, {} channels ({}), language: {}\n",
            stream.index,
            stream.codec,
            stream.channels,
            stream.layout,
            stream.language.as_deref().unwrap_or("unknown")
        ));
    }

    let subtitle_section = if metadata.subtitle_streams.is_empty() {
        String::new()
    } else {
        let mut subtitle_info = String::new();
        for stream in &metadata.subtitle_streams {
            subtitle_info.push_str(&format!(
                "  - Stream {}: {} codec, language: {}, title: {}\n",
                stream.index,
                stream.codec,
                stream.language.as_deref().unwrap_or("unknown"),
                stream.title.as_deref().unwrap_or("none")
            ));
        }
        format!(
            "\nSubtitle Streams ({}):\n{}",
            metadata.subtitle_streams.len(),
            subtitle_info
        )
    };

    let mut prompt = format!(
        r#"Analyze this video file and generate the optimal FFmpeg transcoding command.

## File Metadata

Container: {}

Video:
  - Codec: {}
  - Resolution: {}x{}
  - HDR: {}
  - Bit Depth: {}-bit
  - FPS: {:.2}

Audio Streams ({}):
{}{}

Chapters: {}

Duration: {:.2} seconds
Bitrate: {} bps
"#,
        metadata.container,
        metadata.video.codec,
        metadata.video.width,
        metadata.video.height,
        if metadata.video.hdr { "Yes" } else { "No" },
        metadata.video.bit_depth,
        metadata.video.fps,
        metadata.audio_streams.len(),
        audio_info,
        subtitle_section,
        if metadata.has_chapters { "Yes" } else { "No" },
        metadata.duration,
        metadata.bitrate,
    );

    if !previous_command.trim().is_empty() {
        prompt.push_str("\n## Previous command arguments\n");
        prompt.push_str(previous_command.trim());
        prompt.push('\n');
    }

    if !user_notes.is_empty() {
        prompt.push_str("\n## Standing user notes\n");
        for note in user_notes {
            prompt.push_str(&format!("- {}\n", note));
        }
    }

    let error = error_message.trim();
    let has_error = !error.is_empty();
    let has_previous = !previous_command.trim().is_empty();

    if has_error {
        if has_previous {
            prompt.push_str(
                "\n## Last 8 non-progress lines of this file's FFmpeg stderr (truncated)\n",
            );
        } else {
            prompt.push_str("\n## Last error\n");
        }
        prompt.push_str(error);
        prompt.push('\n');
    }

    let closing = if has_error && has_previous {
        "We attempted this transcode with the previous command arguments above (the app adds ffmpeg, -i, and the output path). It failed. Below are the last 8 non-progress stderr lines, not the full log. Propose revised arguments only — same JSON contract — honoring guidelines and standing notes. Do not invent a retry for GPU session-limit / disk-full / missing output dir / corrupt source; those need a human."
    } else if has_error {
        "Generation failed; propose arguments from metadata, guidelines, and standing notes."
    } else if has_previous {
        "Revise the previous command using the standing notes; do not silently revert earlier notes."
    } else {
        "Generate the best ffmpeg command following the guidelines."
    };
    prompt.push('\n');
    prompt.push_str(closing);
    prompt
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::{AudioStream, FileMetadata, SubtitleStream, VideoMetadata};

    #[test]
    fn prompt_includes_subtitle_stream_details_when_present() {
        let metadata = FileMetadata {
            container: "mkv".to_string(),
            video: VideoMetadata {
                codec: "hevc".to_string(),
                width: 1920,
                height: 1080,
                hdr: false,
                bit_depth: 8,
                fps: 24.0,
            },
            audio_streams: vec![AudioStream {
                index: 1,
                codec: "aac".to_string(),
                channels: 2,
                layout: "stereo".to_string(),
                language: Some("eng".to_string()),
                title: None,
            }],
            subtitle_streams: vec![
                SubtitleStream {
                    index: 2,
                    codec: "subrip".to_string(),
                    language: Some("eng".to_string()),
                    title: Some("English".to_string()),
                },
                SubtitleStream {
                    index: 3,
                    codec: "ass".to_string(),
                    language: Some("jpn".to_string()),
                    title: None,
                },
            ],
            subtitle_count: 2,
            has_chapters: false,
            duration: 3600.0,
            bitrate: 5_000_000,
        };

        let prompt = build_user_prompt(&metadata, "", &[], "");

        assert!(prompt.contains("Subtitle Streams (2):"), "Should contain subtitle stream count");
        assert!(prompt.contains("Stream 2: subrip codec, language: eng, title: English"), "Should contain first subtitle stream details");
        assert!(prompt.contains("Stream 3: ass codec, language: jpn, title: none"), "Should contain second subtitle stream details");
    }

    #[test]
    fn prompt_omits_subtitle_section_when_no_subtitle_streams() {
        let metadata = FileMetadata {
            container: "mp4".to_string(),
            video: VideoMetadata {
                codec: "h264".to_string(),
                width: 1920,
                height: 1080,
                hdr: false,
                bit_depth: 8,
                fps: 30.0,
            },
            audio_streams: vec![AudioStream {
                index: 1,
                codec: "aac".to_string(),
                channels: 2,
                layout: "stereo".to_string(),
                language: Some("eng".to_string()),
                title: None,
            }],
            subtitle_streams: vec![],
            subtitle_count: 0,
            has_chapters: false,
            duration: 1800.0,
            bitrate: 2_000_000,
        };

        let prompt = build_user_prompt(&metadata, "", &[], "");

        assert!(!prompt.contains("Subtitle Streams"), "Should not contain subtitle section when no streams exist");
    }

    #[test]
    fn user_prompt_omits_previous_command_and_notes_when_empty() {
        let metadata = FileMetadata {
            container: "mkv".to_string(),
            video: VideoMetadata {
                codec: "hevc".to_string(),
                width: 1920,
                height: 1080,
                hdr: false,
                bit_depth: 8,
                fps: 24.0,
            },
            audio_streams: vec![AudioStream {
                index: 1,
                codec: "aac".to_string(),
                channels: 2,
                layout: "stereo".to_string(),
                language: Some("eng".to_string()),
                title: None,
            }],
            subtitle_streams: vec![],
            subtitle_count: 0,
            has_chapters: false,
            duration: 3600.0,
            bitrate: 5_000_000,
        };

        let prompt = build_user_prompt(&metadata, "   ", &[], "  ");

        assert!(prompt.contains("## File Metadata"), "Should keep the metadata block");
        assert!(
            !prompt.contains("## Previous command arguments"),
            "Should omit previous command heading when argv is empty/whitespace"
        );
        assert!(
            !prompt.contains("## Standing user notes"),
            "Should omit standing notes heading when notes are empty"
        );
        assert!(
            !prompt.contains("## Last FFmpeg / generate error"),
            "Should omit error heading when error is empty/whitespace"
        );
        assert!(
            prompt.contains("Generate the best ffmpeg command following the guidelines."),
            "Should keep the default closing instruction"
        );
        assert!(
            !prompt.contains("Revise the previous command"),
            "Should not use a revise closing instruction when context is empty"
        );
    }

    #[test]
    fn user_prompt_includes_previous_command_notes_and_error() {
        let metadata = FileMetadata {
            container: "mkv".to_string(),
            video: VideoMetadata {
                codec: "hevc".to_string(),
                width: 1920,
                height: 1080,
                hdr: false,
                bit_depth: 8,
                fps: 24.0,
            },
            audio_streams: vec![AudioStream {
                index: 1,
                codec: "aac".to_string(),
                channels: 2,
                layout: "stereo".to_string(),
                language: Some("eng".to_string()),
                title: None,
            }],
            subtitle_streams: vec![],
            subtitle_count: 0,
            has_chapters: false,
            duration: 3600.0,
            bitrate: 5_000_000,
        };
        let notes = vec![
            "keep English subtitles".to_string(),
            "prefer Opus audio".to_string(),
        ];

        let prompt = build_user_prompt(
            &metadata,
            "-c:v copy -c:a libopus -map 0",
            &notes,
            "Stream map does not match any existing streams",
        );

        assert!(prompt.contains("## File Metadata"), "Should keep the metadata block");
        assert!(
            prompt.contains("## Previous command arguments"),
            "Should include previous command heading"
        );
        assert!(
            prompt.contains("-c:v copy -c:a libopus -map 0"),
            "Should include the previous argv string, not an assembled ffmpeg -i line"
        );
        assert!(
            !prompt.contains("ffmpeg -i"),
            "Must not assemble a full ffmpeg -i command line"
        );
        assert!(
            prompt.contains("## Standing user notes"),
            "Should include standing notes heading"
        );
        assert!(prompt.contains("- keep English subtitles"));
        assert!(prompt.contains("- prefer Opus audio"));
        assert!(
            prompt.contains("## Last 8 non-progress lines of this file's FFmpeg stderr (truncated)"),
            "Encode repair should label the stderr tail"
        );
        assert!(prompt.contains("Stream map does not match any existing streams"));
        assert!(
            prompt.contains(
                "We attempted this transcode with the previous command arguments above (the app adds ffmpeg, -i, and the output path). It failed. Below are the last 8 non-progress stderr lines, not the full log. Propose revised arguments only — same JSON contract — honoring guidelines and standing notes. Do not invent a retry for GPU session-limit / disk-full / missing output dir / corrupt source; those need a human."
            ),
            "Encode repair should use the locked encode closer"
        );
        assert!(
            !prompt.contains("## Last FFmpeg / generate error"),
            "Old combined heading must not remain"
        );
        assert!(
            !prompt.contains("Revise the previous command arguments to resolve this error while honoring guidelines and standing notes."),
            "Old one-line closer must not remain"
        );
        assert!(
            !prompt.contains("## Last error\n"),
            "Encode repair must not use the generate heading"
        );
        assert!(
            !prompt.contains("Generate the best ffmpeg command following the guidelines."),
            "Should not keep the default closing instruction when error is present"
        );
    }

    #[test]
    fn user_prompt_generate_repair_uses_last_error_heading() {
        let metadata = FileMetadata {
            container: "mkv".to_string(),
            video: VideoMetadata {
                codec: "hevc".to_string(),
                width: 1920,
                height: 1080,
                hdr: false,
                bit_depth: 8,
                fps: 24.0,
            },
            audio_streams: vec![AudioStream {
                index: 1,
                codec: "aac".to_string(),
                channels: 2,
                layout: "stereo".to_string(),
                language: Some("eng".to_string()),
                title: None,
            }],
            subtitle_streams: vec![],
            subtitle_count: 0,
            has_chapters: false,
            duration: 3600.0,
            bitrate: 5_000_000,
        };

        let prompt = build_user_prompt(
            &metadata,
            "   ",
            &[],
            "AI returned an empty command",
        );
        assert!(prompt.contains("## File Metadata"));
        assert!(!prompt.contains("## Previous command arguments"));
        assert!(prompt.contains("## Last error"), "Generate/API fail should not claim FFmpeg stderr");
        assert!(!prompt.contains("## Last 8 non-progress lines of this file's FFmpeg stderr (truncated)"));
        assert!(prompt.contains("AI returned an empty command"));
        assert!(prompt.contains("Generation failed; propose arguments from metadata, guidelines, and standing notes."));
        assert!(!prompt.contains("ffmpeg -i"));
        assert!(!prompt.contains("Generate the best ffmpeg command following the guidelines."));
    }

    #[test]
    fn build_system_prompt_contains_contract_elements() {
        let guidelines = "## Environment\n\nTest guidelines.";
        let prompt = build_system_prompt(guidelines);

        // Role description
        assert!(prompt.contains("expert FFmpeg command generator"), "Should contain role description");

        // Guidelines section with user text inserted
        assert!(prompt.contains("## Guidelines"), "Should contain Guidelines section header");
        assert!(prompt.contains("Test guidelines."), "Should contain the provided guidelines text");

        // Output Format section with JSON schema
        assert!(prompt.contains("## Output Format"), "Should contain Output Format section header");
        assert!(prompt.contains("\"command\""), "Should contain command field in JSON schema");
        assert!(prompt.contains("\"description\""), "Should contain description field in JSON schema");
        assert!(prompt.contains("\"reasoning\""), "Should contain reasoning field in JSON schema");

        // Non-negotiable rules
        assert!(prompt.contains("Rules:"), "Should contain Rules section");
        assert!(prompt.contains("Do NOT include \"ffmpeg\" prefix"), "Should contain no-ffmpeg-prefix rule");
        assert!(prompt.contains("Do NOT include -i or the input/output file paths"), "Should contain no-input-output-paths rule");
        assert!(prompt.contains("Always include -y flag"), "Should contain always-y rule");
        assert!(prompt.contains("single-line format"), "Should contain single-line-format rule");
    }

    #[test]
    fn build_system_prompt_contains_contract_regardless_of_guidelines() {
        // Even with empty guidelines, the contract elements must be present
        let prompt = build_system_prompt("");

        assert!(prompt.contains("## Guidelines"), "Should always contain Guidelines section header");
        assert!(prompt.contains("## Output Format"), "Should always contain Output Format section header");
        assert!(prompt.contains("Rules:"), "Should always contain Rules section");

        // The contract rules should be present
        assert!(prompt.contains("Do NOT include \"ffmpeg\" prefix"));
        assert!(prompt.contains("Do NOT include -i"));
        assert!(prompt.contains("Always include -y flag"));
        assert!(prompt.contains("single-line format"));
    }
}
