/// Display helper: quoted ffmpeg preview of `assemble_argv`.
///
/// Known pre-input flags (`-y`, `-hwaccel`, `-hwaccel_device`,
/// `-hwaccel_output_format`) are placed before `-i`. Paths with spaces, tabs,
/// or quotes are wrapped in double quotes. Existing double quotes inside a
/// path are backslash-escaped.
pub fn assemble_command(args: &str, input_path: &str, output_path: &str) -> String {
    format_command_preview(&assemble_argv(args, input_path, output_path))
}

pub fn format_command_preview(argv: &[String]) -> String {
    let mut parts = vec!["ffmpeg".to_string()];
    for token in argv {
        parts.push(quote_token(token));
    }
    parts.join(" ")
}

fn classify_tokens(tokens: &[String]) -> (Vec<String>, Vec<String>) {
    let mut pre = Vec::new();
    let mut post = Vec::new();
    let mut i = 0;
    while i < tokens.len() {
        let t = &tokens[i];
        if t == "-y" {
            pre.push(t.clone());
            i += 1;
        } else if t == "-hwaccel" || t == "-hwaccel_device" || t == "-hwaccel_output_format" {
            pre.push(t.clone());
            i += 1;
            if i < tokens.len() && !tokens[i].starts_with('-') {
                pre.push(tokens[i].clone());
                i += 1;
            }
        } else {
            post.push(t.clone());
            i += 1;
        }
    }
    (pre, post)
}

pub fn assemble_argv(args: &str, input_path: &str, output_path: &str) -> Vec<String> {
    let input_path = normalize_path(input_path);
    let output_path = normalize_path(output_path);
    let mut tokens = split_args(args);
    if !tokens.is_empty() && tokens[0].eq_ignore_ascii_case("ffmpeg") {
        tokens.remove(0);
    }
    let (pre, post) = classify_tokens(&tokens);
    let mut argv = Vec::new();
    argv.extend(pre);
    argv.push("-i".to_string());
    argv.push(input_path);
    argv.extend(post);
    argv.push(output_path);
    argv
}

/// Quotes a token for shell usage if it contains spaces, tabs, or quotes.
fn quote_token(token: &str) -> String {
    let needs_quotes = token.chars().any(|c| c == ' ' || c == '\t' || c == '"');
    if needs_quotes {
        let escaped = token.replace('"', "\\\"");
        format!("\"{}\"", escaped)
    } else {
        token.to_string()
    }
}

/// Splits an argument string into individual tokens, respecting single and double
/// quotes and backslash escapes.
///
/// NOTE: This is the sole argv splitter. Keep quoting and escape behavior stable;
/// divergence here reintroduces the same class of quoting bug.
pub(crate) fn split_args(input: &str) -> Vec<String> {
    let mut result = Vec::new();
    let mut current = String::new();
    let mut in_quotes = false;
    let mut escape = false;

    for ch in input.chars() {
        if escape {
            current.push(ch);
            escape = false;
            continue;
        }

        match ch {
            '\\' => escape = true,
            '"' | '\'' => in_quotes = !in_quotes,
            ' ' | '\t' | '\n' | '\r' if !in_quotes => {
                if !current.is_empty() {
                    result.push(current.clone());
                    current.clear();
                }
            }
            _ => current.push(ch),
        }
    }

    if !current.is_empty() {
        result.push(current);
    }

    result
}

/// Resolves the output path for a transcoded file, preserving directory structure
/// unless `flatten` is true.
///
/// Given:
/// - `scan_root`: The root directory that was scanned
/// - `input_path`: The full path to the input file
/// - `output_folder`: The base output directory (empty = same directory as input)
/// - `naming_template`: Template for the output filename (empty = "{name}.mkv")
/// - `flatten`: When true, ignore the preserved relative directory and write the
///   file directly under `output_folder`. When false, keep today's relative-dir
///   logic. Does not uniquify collisions and does not prepend `scan_root`'s basename.
///
/// Returns the full output path with the same relative directory structure as the
/// input, rooted at `output_folder` (or flat under `output_folder` if `flatten`).
///
/// Template substitutions:
/// - `{name}` → filename without extension
/// - `{ext}` → original extension (without dot)
///
/// Path separators in the result are normalized to forward slashes.
pub fn resolve_output_path(
    scan_root: &str,
    input_path: &str,
    output_folder: &str,
    naming_template: &str,
    flatten: bool,
) -> String {
    // Normalize all paths to use forward slashes
    let scan_root = normalize_path(scan_root);
    let input_path = normalize_path(input_path);
    let output_folder = if output_folder.is_empty() {
        // Default to the same directory as the input file
        if let Some(last_slash) = input_path.rfind('/') {
            input_path[..last_slash].to_string()
        } else {
            ".".to_string()
        }
    } else {
        normalize_path(output_folder)
    };

    let naming_template = if naming_template.is_empty() {
        "{name}.mkv"
    } else {
        naming_template
    };

    // Extract filename and extension
    let filename = input_path.split('/').last().unwrap_or("output");
    let dot_pos = filename.rfind('.');
    let (stem, ext) = match dot_pos {
        Some(pos) => (&filename[..pos], &filename[pos + 1..]),
        None => (filename, "mkv"),
    };

    // Apply template substitutions
    let output_filename = naming_template
        .replace("{name}", stem)
        .replace("{ext}", ext);

    // Compute relative directory from scan_root to input's parent
    // A file at Unix `/clip.mkv` has its only slash at index 0; treat parent as `/`
    // so scan_root "/" does not look like a mismatch.
    let input_dir = if let Some(last_slash) = input_path.rfind('/') {
        if last_slash == 0 {
            "/"
        } else {
            &input_path[..last_slash]
        }
    } else {
        ""
    };

    let relative_dir = if flatten {
        ""
    } else if scan_root.is_empty() {
        ""
    } else if input_dir == scan_root {
        ""
    } else if scan_root == "/" && input_dir.starts_with('/') {
        // `format!("{}/", "/")` is "//" and would miss `/Movies/...`.
        &input_dir[1..]
    } else if input_dir.starts_with(&format!("{}/", scan_root)) {
        &input_dir[scan_root.len() + 1..]
    } else {
        // Input is not under scan_root (e.g., individual file added directly)
        ""
    };

    // Build output path
    let output_path = if relative_dir.is_empty() {
        format!("{}/{}", output_folder, output_filename)
    } else {
        format!("{}/{}/{}", output_folder, relative_dir, output_filename)
    };

    // Collision guard: prevent output path from matching input path
    if normalize_path(&output_path) == input_path {
        let guarded_filename = if let Some(dot_pos) = output_filename.rfind('.') {
            format!("{}_transcoded{}", &output_filename[..dot_pos], &output_filename[dot_pos..])
        } else {
            format!("{}_transcoded", output_filename)
        };
        if relative_dir.is_empty() {
            format!("{}/{}", output_folder, guarded_filename)
        } else {
            format!("{}/{}/{}", output_folder, relative_dir, guarded_filename)
        }
    } else {
        output_path
    }
}

/// Normalizes a path string to use forward slashes and removes trailing slashes.
/// Unix `/` is kept (it is a real scan root); empty input stays empty.
fn normalize_path(path: &str) -> String {
    let replaced = path.replace('\\', "/");
    let trimmed = replaced.trim_end_matches('/');
    if trimmed.is_empty() {
        if replaced.starts_with('/') {
            "/".to_string()
        } else {
            String::new()
        }
    } else {
        trimmed.to_string()
    }
}

/// Windows FFmpeg argv form. UNC `//server/share` → `\\server\share`.
/// Idempotent on already-native backslash paths. Not used on Unix spawn.
pub fn to_native_windows_path(path: &str) -> String {
    path.replace('/', "\\")
}

/// Convert the `-i` operand and the final output token only.
pub fn apply_windows_native_paths(argv: &mut [String]) {
    if let Some(i) = argv.iter().position(|t| t == "-i") {
        if let Some(slot) = argv.get_mut(i + 1) {
            *slot = to_native_windows_path(slot);
        }
    }
    if let Some(last) = argv.last_mut() {
        *last = to_native_windows_path(last);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // ── assemble_command tests ──

    #[test]
    fn test_assemble_command_basic() {
        let cmd = assemble_command("-c:v copy -c:a opus", "/input/video.mkv", "/output/video.mkv");
        assert_eq!(cmd, "ffmpeg -i /input/video.mkv -c:v copy -c:a opus /output/video.mkv");
    }

    #[test]
    fn test_assemble_command_spaces_in_input() {
        let cmd = assemble_command("-c:v copy", "/input/my video.mkv", "/output/out.mkv");
        assert_eq!(cmd, "ffmpeg -i \"/input/my video.mkv\" -c:v copy /output/out.mkv");
    }

    #[test]
    fn test_assemble_command_spaces_in_output() {
        let cmd = assemble_command("-c:v copy", "/input/in.mkv", "/output/my output.mkv");
        assert_eq!(cmd, "ffmpeg -i /input/in.mkv -c:v copy \"/output/my output.mkv\"");
    }

    #[test]
    fn test_assemble_command_spaces_in_both() {
        let cmd = assemble_command("-map 0", "/input/my video.mkv", "/output/my output.mkv");
        assert_eq!(cmd, "ffmpeg -i \"/input/my video.mkv\" -map 0 \"/output/my output.mkv\"");
    }

    #[test]
    fn test_assemble_command_quotes_in_path() {
        let cmd = assemble_command("-c:v copy", "/input/video\"quotes\".mkv", "/output/out.mkv");
        assert_eq!(cmd, "ffmpeg -i \"/input/video\\\"quotes\\\".mkv\" -c:v copy /output/out.mkv");
    }

    #[test]
    fn test_assemble_command_special_chars() {
        let cmd = assemble_command("-c:v copy", "/input/video@2x.mkv", "/output/out.mkv");
        assert_eq!(cmd, "ffmpeg -i /input/video@2x.mkv -c:v copy /output/out.mkv");
    }

    #[test]
    fn test_assemble_command_ffmpeg_prefix_stripped() {
        let cmd = assemble_command("ffmpeg -c:v copy", "/input/in.mkv", "/output/out.mkv");
        assert_eq!(cmd, "ffmpeg -i /input/in.mkv -c:v copy /output/out.mkv");
    }

    #[test]
    fn test_assemble_command_ffmpeg_prefix_case_insensitive() {
        let cmd = assemble_command("FFmpeg -c:v copy", "/input/in.mkv", "/output/out.mkv");
        assert_eq!(cmd, "ffmpeg -i /input/in.mkv -c:v copy /output/out.mkv");
    }

    #[test]
    fn test_assemble_command_empty_args() {
        let cmd = assemble_command("", "/input/in.mkv", "/output/out.mkv");
        assert_eq!(cmd, "ffmpeg -i /input/in.mkv /output/out.mkv");
    }

    #[test]
    fn test_assemble_command_metadata_title_quoted() {
        // Tracer bullet: tokens with spaces must be re-wrapped in quotes
        let cmd = assemble_command(
            "-metadata:s:a:0 title='Dolby TrueHD 7.1'",
            "/input/in.mkv",
            "/output/out.mkv",
        );
        assert_eq!(
            cmd,
            "ffmpeg -i /input/in.mkv -metadata:s:a:0 \"title=Dolby TrueHD 7.1\" /output/out.mkv"
        );
    }

    #[test]
    fn test_assemble_command_args_with_quotes() {
        let cmd = assemble_command(
            "-filter:v \"scale=1920:1080\"",
            "/input/in.mkv",
            "/output/out.mkv",
        );
        // Quotes in AI args are shell syntax — they get stripped during parsing
        // and re-added only if the argument actually contains spaces/tabs/quotes
        assert_eq!(cmd, "ffmpeg -i /input/in.mkv -filter:v scale=1920:1080 /output/out.mkv");
    }

    #[test]
    fn test_assemble_command_args_with_single_quotes() {
        let cmd = assemble_command(
            "-metadata:s:a:0 title='Dolby TrueHD 7.1'",
            "/input/in.mkv",
            "/output/out.mkv",
        );
        assert_eq!(
            cmd,
            "ffmpeg -i /input/in.mkv -metadata:s:a:0 \"title=Dolby TrueHD 7.1\" /output/out.mkv"
        );
    }

    #[test]
    fn test_assemble_command_args_with_mixed_quotes() {
        let cmd = assemble_command(
            "-af 'volume=0.5' -metadata title=\"My Video\"",
            "/input/in.mkv",
            "/output/out.mkv",
        );
        assert_eq!(
            cmd,
            "ffmpeg -i /input/in.mkv -af volume=0.5 -metadata \"title=My Video\" /output/out.mkv"
        );
    }

    #[test]
    fn test_assemble_command_args_with_escaped_single_quotes() {
        let cmd = assemble_command(
            "-metadata title='My \\'Special\\' Video'",
            "/input/in.mkv",
            "/output/out.mkv",
        );
        assert_eq!(
            cmd,
            "ffmpeg -i /input/in.mkv -metadata \"title=My 'Special' Video\" /output/out.mkv"
        );
    }

    #[test]
    fn test_assemble_command_filter_expression_quoted() {
        // Filter expressions with spaces must be re-wrapped in quotes
        let cmd = assemble_command(
            "-af \"volume=0.5, loudnorm=I=-16:LRA=11:TP=-1.5\"",
            "/input/in.mkv",
            "/output/out.mkv",
        );
        assert_eq!(
            cmd,
            "ffmpeg -i /input/in.mkv -af \"volume=0.5, loudnorm=I=-16:LRA=11:TP=-1.5\" /output/out.mkv"
        );
    }

    #[test]
    fn test_assemble_command_inner_quotes_escaped() {
        // Inner double quotes must be backslash-escaped when re-wrapped
        let cmd = assemble_command(
            "-metadata title=\"My \\\"Special\\\" Video\"",
            "/input/in.mkv",
            "/output/out.mkv",
        );
        assert_eq!(
            cmd,
            "ffmpeg -i /input/in.mkv -metadata \"title=My \\\"Special\\\" Video\" /output/out.mkv"
        );
    }

    #[test]
    fn test_assemble_command_tabs_in_path() {
        let cmd = assemble_command("-c:v copy", "/input/my\tvideo.mkv", "/output/out.mkv");
        assert_eq!(cmd, "ffmpeg -i \"/input/my\tvideo.mkv\" -c:v copy /output/out.mkv");
    }

    #[test]
    fn test_assemble_command_windows_path() {
        let cmd = assemble_command(
            "-c:v copy -c:a opus",
            "C:\\Users\\Not Governor\\Desktop\\file.mkv",
            "D:\\Transcoded\\Not Governor\\file.mkv",
        );
        assert_eq!(
            cmd,
            "ffmpeg -i \"C:/Users/Not Governor/Desktop/file.mkv\" -c:v copy -c:a opus \"D:/Transcoded/Not Governor/file.mkv\""
        );
    }

    // ── resolve_output_path tests ──

    #[test]
    fn test_resolve_output_path_basic() {
        let path = resolve_output_path(
            "/media/TV",
            "/media/TV/Show/Season 01/Episode.mkv",
            "/transcoded",
            "{name}.mkv",
            false
        );
        assert_eq!(path, "/transcoded/Show/Season 01/Episode.mkv");
    }

    #[test]
    fn test_resolve_output_path_flat_structure() {
        let path = resolve_output_path("/media/TV", "/media/TV/video.mkv", "/transcoded", "{name}.mkv", false);
        assert_eq!(path, "/transcoded/video.mkv");
    }

    #[test]
    fn test_resolve_output_path_individual_file() {
        // When a single file is added, scan_root is its parent directory
        let path = resolve_output_path(
            "/media/movies",
            "/media/movies/single.mkv",
            "/transcoded",
            "{name}.mkv",
            false
        );
        assert_eq!(path, "/transcoded/single.mkv");
    }

    #[test]
    fn test_resolve_output_path_windows_style() {
        let path = resolve_output_path(
            "C:\\Users\\Videos",
            "C:\\Users\\Videos\\Show\\Episode.mkv",
            "D:\\Transcoded",
            "{name}.mkv",
            false
        );
        assert_eq!(path, "D:/Transcoded/Show/Episode.mkv");
    }

    #[test]
    fn test_resolve_output_path_template_with_ext() {
        let path = resolve_output_path("/media", "/media/video.mp4", "/out", "{name}_transcoded.{ext}", false);
        assert_eq!(path, "/out/video_transcoded.mp4");
    }

    #[test]
    fn test_resolve_output_path_no_template_var() {
        let path = resolve_output_path("/media", "/media/video.mkv", "/out", "fixed_name.mkv", false);
        assert_eq!(path, "/out/fixed_name.mkv");
    }

    #[test]
    fn test_resolve_output_path_deep_nesting() {
        let path = resolve_output_path(
            "/media",
            "/media/A/B/C/D/E/video.mkv",
            "/out",
            "{name}.mkv",
            false
        );
        assert_eq!(path, "/out/A/B/C/D/E/video.mkv");
    }

    #[test]
    fn test_resolve_output_path_trailing_slashes() {
        let path = resolve_output_path("/media/", "/media/video.mkv", "/out/", "{name}.mkv", false);
        assert_eq!(path, "/out/video.mkv");
    }

    #[test]
    fn test_resolve_output_path_empty_scan_root() {
        let path = resolve_output_path("", "/media/video.mkv", "/out", "{name}.mkv", false);
        assert_eq!(path, "/out/video.mkv");
    }

    #[test]
    fn test_resolve_output_path_file_not_under_scan_root() {
        let path = resolve_output_path("/media/TV", "/other/path/video.mkv", "/out", "{name}.mkv", false);
        assert_eq!(path, "/out/video.mkv");
    }

    #[test]
    fn test_resolve_output_path_no_extension() {
        let path = resolve_output_path("/media", "/media/video", "/out", "{name}.{ext}", false);
        assert_eq!(path, "/out/video.mkv");
    }

    #[test]
    fn test_resolve_output_path_empty_output_folder() {
        // Empty output_folder defaults to the input's parent directory.
        // With template "{name}.mkv" this resolves to the same path as the
        // input, so the collision guard appends "_transcoded".
        let path = resolve_output_path("/media", "/media/video.mkv", "", "{name}.mkv", false);
        assert_eq!(path, "/media/video_transcoded.mkv");
    }

    #[test]
    fn test_resolve_output_path_empty_naming_template() {
        let path = resolve_output_path("/media", "/media/video.mkv", "/out", "", false);
        assert_eq!(path, "/out/video.mkv");
    }

    #[test]
    fn test_resolve_output_path_collision_guard_same_path() {
        let path = resolve_output_path("/media", "/media/video.mkv", "", "{name}.mkv", false);
        assert_eq!(path, "/media/video_transcoded.mkv");
    }

    #[test]
    fn test_resolve_output_path_collision_guard_different_folder() {
        let path = resolve_output_path("/media", "/media/video.mkv", "/transcoded", "{name}.mkv", false);
        assert_eq!(path, "/transcoded/video.mkv");
    }

    #[test]
    fn test_resolve_output_path_collision_guard_different_filename() {
        let path = resolve_output_path("/media", "/media/video.mkv", "/media", "{name}_backup.mkv", false);
        assert_eq!(path, "/media/video_backup.mkv");
    }

    #[test]
    fn test_resolve_output_path_collision_guard_no_extension() {
        // Template {name} produces output filename "video", matching input path exactly
        let path = resolve_output_path("/media", "/media/video", "", "{name}", false);
        assert_eq!(path, "/media/video_transcoded");
    }

    #[test]
    fn test_resolve_output_path_collision_guard_nested_path() {
        // With empty scan_root, relative_dir is empty, and empty output_folder
        // defaults to the input's parent directory. The resolved path equals the
        // input path, so the collision guard triggers.
        let path = resolve_output_path(
            "",
            "/media/Show/Season 01/Episode.mkv",
            "",
            "{name}.mkv",
            false
        );
        assert_eq!(path, "/media/Show/Season 01/Episode_transcoded.mkv");
    }

    #[test]
    fn test_resolve_output_path_collision_guard_windows_style() {
        let path = resolve_output_path(
            "C:\\Users\\Videos",
            "C:\\Users\\Videos\\Episode.mkv",
            "",
            "{name}.mkv",
            false
        );
        assert_eq!(path, "C:/Users/Videos/Episode_transcoded.mkv");
    }

    #[test]
    fn test_resolve_output_path_unicode_in_path() {
        let path = resolve_output_path(
            "/media/日本語",
            "/media/日本語/番組/エピソード.mkv",
            "/out",
            "{name}.mkv",
            false
        );
        assert_eq!(path, "/out/番組/エピソード.mkv");
    }

    #[test]
    fn test_resolve_output_path_unc_preserves_relative_dir() {
        let path = resolve_output_path(
            r"\\socrates\Movies\Hellboy",
            r"\\socrates\Movies\Hellboy\1\Hellboy.mkv",
            r"\\socrates\TheChasm\Media\MoviesTemp",
            "{name}.mkv",
            false
        );
        assert_eq!(
            path,
            "//socrates/TheChasm/Media/MoviesTemp/1/Hellboy.mkv"
        );
    }

    #[test]
    fn test_resolve_output_path_unc_drive_mixed_with_unc_output() {
        let path = resolve_output_path(
            r"J:\Movies\Hellboy",
            r"J:\Movies\Hellboy\1\Hellboy.mkv",
            r"\\socrates\TheChasm\Media\MoviesTemp",
            "{name}.mkv",
            false
        );
        assert_eq!(
            path,
            "//socrates/TheChasm/Media/MoviesTemp/1/Hellboy.mkv"
        );
    }

    #[test]
    fn test_resolve_output_path_flatten_true() {
        let path = resolve_output_path(
            "/media",
            "/media/TV/Show/Season 01/Episode.mkv",
            "/transcoded",
            "{name}.mkv",
            true,
        );
        assert_eq!(path, "/transcoded/Episode.mkv");
    }

    #[test]
    fn test_resolve_output_path_flatten_false() {
        let path = resolve_output_path(
            "/media",
            "/media/TV/Show/Season 01/Episode.mkv",
            "/transcoded",
            "{name}.mkv",
            false,
        );
        assert_eq!(path, "/transcoded/TV/Show/Season 01/Episode.mkv");
    }

    #[test]
    fn test_resolve_output_path_include_root_via_parent_scan_root() {
        let path = resolve_output_path(
            "/media",
            "/media/TV/video.mkv",
            "/transcoded",
            "{name}.mkv",
            false,
        );
        assert_eq!(path, "/transcoded/TV/video.mkv");
    }

    #[test]
    fn test_resolve_output_path_loose_file() {
        let path = resolve_output_path(
            "/media/movies",
            "/media/movies/single.mkv",
            "/transcoded",
            "{name}.mkv",
            false,
        );
        assert_eq!(path, "/transcoded/single.mkv");
    }

    #[test]
    fn test_resolve_output_path_unix_root_scan_root_keeps_first_component() {
        // Linux/macOS: adding /Movies stores scan_root "/". That must not
        // collapse to empty (normalize used to trim "/" to "").
        let path = resolve_output_path(
            "/",
            "/Movies/Show/ep.mkv",
            "/transcoded",
            "{name}.mkv",
            false,
        );
        assert_eq!(path, "/transcoded/Movies/Show/ep.mkv");
    }

    #[test]
    fn test_resolve_output_path_unix_root_file_at_root_stays_flat() {
        let path = resolve_output_path("/", "/clip.mkv", "/transcoded", "{name}.mkv", false);
        assert_eq!(path, "/transcoded/clip.mkv");
    }

    #[test]
    fn test_resolve_output_path_windows_drive_root_scan_root_keeps_folder() {
        let path = resolve_output_path(
            r"C:\",
            r"C:\Shows\Season 01\ep.mkv",
            r"D:\out",
            "{name}.mkv",
            false,
        );
        assert_eq!(path, "D:/out/Shows/Season 01/ep.mkv");
    }

    #[test]
    fn assemble_argv_places_hwaccel_before_dash_i() {
        let argv = assemble_argv(
            "-hwaccel cuda -hwaccel_output_format cuda -c:v hevc_nvenc -cq 23 -y",
            "/media/in.mkv",
            "/out/in.mkv",
        );
        assert_eq!(
            argv,
            vec![
                "-hwaccel",
                "cuda",
                "-hwaccel_output_format",
                "cuda",
                "-y",
                "-i",
                "/media/in.mkv",
                "-c:v",
                "hevc_nvenc",
                "-cq",
                "23",
                "/out/in.mkv",
            ]
        );
    }

    #[test]
    fn assemble_argv_keeps_spaces_in_path_as_single_token() {
        let argv = assemble_argv(
            "-c:v copy",
            "C:/Users/Not Governor/Desktop/file.mkv",
            "D:/Transcoded/Not Governor/file.mkv",
        );
        assert_eq!(argv[0], "-i");
        assert_eq!(argv[1], "C:/Users/Not Governor/Desktop/file.mkv");
        assert_eq!(argv[2], "-c:v");
        assert_eq!(argv[3], "copy");
        assert_eq!(argv[4], "D:/Transcoded/Not Governor/file.mkv");
        assert!(argv.iter().all(|t| !t.contains('"')));
    }

    #[test]
    fn assemble_argv_strips_leading_ffmpeg() {
        let argv = assemble_argv("ffmpeg -c:v copy", "/in.mkv", "/out.mkv");
        assert_eq!(argv, vec!["-i", "/in.mkv", "-c:v", "copy", "/out.mkv"]);
    }

    #[test]
    fn assemble_argv_peels_dash_y_to_pre_input() {
        let argv = assemble_argv("-c:v copy -y", "/in.mkv", "/out.mkv");
        assert_eq!(argv, vec!["-y", "-i", "/in.mkv", "-c:v", "copy", "/out.mkv"]);
    }

    #[test]
    fn to_native_windows_path_unc_forward_slash() {
        assert_eq!(
            to_native_windows_path("//socrates/TheChasm/Media/MoviesTemp/1/Hellboy.mkv"),
            r"\\socrates\TheChasm\Media\MoviesTemp\1\Hellboy.mkv"
        );
    }

    #[test]
    fn to_native_windows_path_drive_letter() {
        assert_eq!(
            to_native_windows_path("D:/Transcoded/Show/Episode.mkv"),
            r"D:\Transcoded\Show\Episode.mkv"
        );
    }

    #[test]
    fn to_native_windows_path_already_native_unc() {
        assert_eq!(
            to_native_windows_path(r"\\socrates\share\a.mkv"),
            r"\\socrates\share\a.mkv"
        );
    }

    #[test]
    fn apply_windows_native_paths_converts_input_and_output_only() {
        let mut argv = vec![
            "-i".to_string(),
            "//socrates/share/in.mkv".to_string(),
            "-c:v".to_string(),
            "copy".to_string(),
            "//socrates/share/out/1/Hellboy.mkv".to_string(),
        ];
        apply_windows_native_paths(&mut argv);
        assert_eq!(argv[1], r"\\socrates\share\in.mkv");
        assert_eq!(argv[2], "-c:v");
        assert_eq!(argv[3], "copy");
        assert_eq!(argv[4], r"\\socrates\share\out\1\Hellboy.mkv");
    }
}
