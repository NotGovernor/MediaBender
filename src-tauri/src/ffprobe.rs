use crate::models::{AudioStream, FileMetadata, SubtitleStream, VideoMetadata};
use serde_json::Value;
use std::process::Stdio;

#[derive(Debug, thiserror::Error)]
pub enum FfprobeError {
    #[error("Failed to execute ffprobe: {0}")]
    Execution(String),
    #[error("Invalid JSON output: {0}")]
    JsonParse(String),
    #[error("Missing required stream data")]
    MissingData,
}

pub async fn analyze_file(path: &str, ffprobe_path: &str) -> Result<(FileMetadata, String), FfprobeError> {
    let output = crate::process_cmd::media_command(ffprobe_path)
        .args([
            "-v", "error",
            "-print_format", "json",
            "-show_format",
            "-show_streams",
            path,
        ])
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output()
        .await
        .map_err(|e| FfprobeError::Execution(e.to_string()))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(FfprobeError::Execution(stderr.to_string()));
    }

    let raw_json = String::from_utf8_lossy(&output.stdout).to_string();
    let value: Value = serde_json::from_str(&raw_json)
        .map_err(|e| FfprobeError::JsonParse(e.to_string()))?;

    let metadata = parse_ffprobe_output(&value)?;
    Ok((metadata, raw_json))
}

fn parse_ffprobe_output(value: &Value) -> Result<FileMetadata, FfprobeError> {
    let streams = value
        .get("streams")
        .and_then(|s| s.as_array())
        .ok_or(FfprobeError::MissingData)?;

    let format = value.get("format").and_then(|f| f.as_object());

    // Parse video stream
    let video_stream = streams
        .iter()
        .find(|s| s.get("codec_type").and_then(|c| c.as_str()) == Some("video"))
        .ok_or(FfprobeError::MissingData)?;

    let video = parse_video_stream(video_stream)?;

    // Parse audio streams
    let audio_streams: Vec<AudioStream> = streams
        .iter()
        .filter(|s| s.get("codec_type").and_then(|c| c.as_str()) == Some("audio"))
        .map(|s| parse_audio_stream(s))
        .collect::<Result<Vec<_>, _>>()?;

    // Parse subtitle streams
    let subtitle_streams: Vec<SubtitleStream> = streams
        .iter()
        .filter(|s| s.get("codec_type").and_then(|c| c.as_str()) == Some("subtitle"))
        .map(|s| parse_subtitle_stream(s))
        .collect::<Result<Vec<_>, _>>()?;

    let subtitle_count = subtitle_streams.len() as i32;

    // Check for chapters
    let has_chapters = value.get("chapters").and_then(|c| c.as_array()).map(|c| !c.is_empty()).unwrap_or(false);

    // Parse format info
    let (duration, bitrate) = format.map(|f| {
        let duration = f
            .get("duration")
            .and_then(|d| d.as_str())
            .and_then(|d| d.parse::<f64>().ok())
            .unwrap_or(0.0);
        let bitrate = f
            .get("bit_rate")
            .and_then(|b| b.as_str())
            .and_then(|b| b.parse::<i64>().ok())
            .unwrap_or(0);
        (duration, bitrate)
    }).unwrap_or((0.0, 0));

    // Get container from format_name
    let container = format
        .and_then(|f| f.get("format_name").and_then(|n| n.as_str()))
        .unwrap_or("unknown")
        .split(',')
        .next()
        .unwrap_or("unknown")
        .to_string();

    Ok(FileMetadata {
        container,
        video,
        audio_streams,
        subtitle_streams,
        subtitle_count,
        has_chapters,
        duration,
        bitrate,
    })
}

fn parse_video_stream(stream: &Value) -> Result<VideoMetadata, FfprobeError> {
    let codec = stream
        .get("codec_name")
        .and_then(|c| c.as_str())
        .unwrap_or("unknown")
        .to_string();

    let width = stream
        .get("width")
        .and_then(|w| w.as_i64())
        .unwrap_or(0) as i32;

    let height = stream
        .get("height")
        .and_then(|h| h.as_i64())
        .unwrap_or(0) as i32;

    // Detect HDR from color_transfer or side_data
    let color_transfer = stream
        .get("color_transfer")
        .and_then(|c| c.as_str())
        .unwrap_or("");
    let hdr = color_transfer.contains("smpte2084") || color_transfer.contains("arib-std-b67");

    // Bit depth from pix_fmt
    let pix_fmt = stream
        .get("pix_fmt")
        .and_then(|p| p.as_str())
        .unwrap_or("");
    let bit_depth = if pix_fmt.contains("p10") {
        10
    } else if pix_fmt.contains("p12") {
        12
    } else {
        8
    };

    // FPS from avg_frame_rate
    let fps = stream
        .get("avg_frame_rate")
        .and_then(|f| f.as_str())
        .and_then(|f| {
            let parts: Vec<&str> = f.split('/').collect();
            if parts.len() == 2 {
                let num = parts[0].parse::<f64>().ok()?;
                let den = parts[1].parse::<f64>().ok()?;
                if den > 0.0 {
                    Some(num / den)
                } else {
                    None
                }
            } else {
                f.parse::<f64>().ok()
            }
        })
        .unwrap_or(0.0);

    Ok(VideoMetadata {
        codec,
        width,
        height,
        hdr,
        bit_depth,
        fps,
    })
}

fn parse_audio_stream(stream: &Value) -> Result<AudioStream, FfprobeError> {
    let index = stream
        .get("index")
        .and_then(|i| i.as_i64())
        .unwrap_or(0) as i32;

    let codec = stream
        .get("codec_name")
        .and_then(|c| c.as_str())
        .unwrap_or("unknown")
        .to_string();

    let channels = stream
        .get("channels")
        .and_then(|c| c.as_i64())
        .unwrap_or(2) as i32;

    let layout = stream
        .get("channel_layout")
        .and_then(|l| l.as_str())
        .unwrap_or("stereo")
        .to_string();

    let language = stream
        .get("tags")
        .and_then(|t| t.get("language"))
        .and_then(|l| l.as_str())
        .map(|s| s.to_string());

    let title = stream
        .get("tags")
        .and_then(|t| t.get("title"))
        .and_then(|t| t.as_str())
        .map(|s| s.to_string());

    Ok(AudioStream {
        index,
        codec,
        channels,
        layout,
        language,
        title,
    })
}

fn parse_subtitle_stream(stream: &Value) -> Result<SubtitleStream, FfprobeError> {
    let index = stream
        .get("index")
        .and_then(|i| i.as_i64())
        .unwrap_or(0) as i32;

    let codec = stream
        .get("codec_name")
        .and_then(|c| c.as_str())
        .unwrap_or("unknown")
        .to_string();

    let language = stream
        .get("tags")
        .and_then(|t| t.get("language"))
        .and_then(|l| l.as_str())
        .map(|s| s.to_string());

    let title = stream
        .get("tags")
        .and_then(|t| t.get("title"))
        .and_then(|t| t.as_str())
        .map(|s| s.to_string());

    Ok(SubtitleStream {
        index,
        codec,
        language,
        title,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_subtitle_stream_with_language_and_title() {
        let json = serde_json::json!({
            "streams": [
                {
                    "codec_type": "video",
                    "codec_name": "hevc",
                    "width": 1920,
                    "height": 1080,
                    "avg_frame_rate": "24000/1001"
                },
                {
                    "codec_type": "subtitle",
                    "index": 2,
                    "codec_name": "subrip",
                    "tags": {
                        "language": "eng",
                        "title": "English (SDH)"
                    }
                }
            ],
            "format": {
                "format_name": "matroska,webm",
                "duration": "3600.0",
                "bit_rate": "5000000"
            }
        });

        let metadata = parse_ffprobe_output(&json).unwrap();
        assert_eq!(metadata.subtitle_streams.len(), 1);
        assert_eq!(metadata.subtitle_streams[0].index, 2);
        assert_eq!(metadata.subtitle_streams[0].codec, "subrip");
        assert_eq!(metadata.subtitle_streams[0].language, Some("eng".to_string()));
        assert_eq!(metadata.subtitle_streams[0].title, Some("English (SDH)".to_string()));
        assert_eq!(metadata.subtitle_count, 1);
    }

    #[test]
    fn parses_subtitle_stream_with_missing_tags() {
        let json = serde_json::json!({
            "streams": [
                {
                    "codec_type": "video",
                    "codec_name": "hevc",
                    "width": 1920,
                    "height": 1080,
                    "avg_frame_rate": "24000/1001"
                },
                {
                    "codec_type": "subtitle",
                    "index": 3,
                    "codec_name": "ass"
                }
            ],
            "format": {
                "format_name": "matroska,webm",
                "duration": "3600.0",
                "bit_rate": "5000000"
            }
        });

        let metadata = parse_ffprobe_output(&json).unwrap();
        assert_eq!(metadata.subtitle_streams.len(), 1);
        assert_eq!(metadata.subtitle_streams[0].index, 3);
        assert_eq!(metadata.subtitle_streams[0].codec, "ass");
        assert_eq!(metadata.subtitle_streams[0].language, None);
        assert_eq!(metadata.subtitle_streams[0].title, None);
        assert_eq!(metadata.subtitle_count, 1);
    }
}
