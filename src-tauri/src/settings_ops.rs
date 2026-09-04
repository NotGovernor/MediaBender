use crate::binary_discovery::find_binary;
use crate::models::AppSettings;

pub fn verify_ffmpeg_paths(settings: &mut AppSettings) -> (bool, bool) {
    if settings.ffmpeg_path.is_empty() {
        if let Some(path) = find_binary("ffmpeg") {
            settings.ffmpeg_path = path;
        }
    }

    if settings.ffprobe_path.is_empty() {
        if let Some(path) = find_binary("ffprobe") {
            settings.ffprobe_path = path;
        }
    }

    let ffmpeg_found = !settings.ffmpeg_path.is_empty();
    let ffprobe_found = !settings.ffprobe_path.is_empty();

    (ffmpeg_found, ffprobe_found)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::AppSettings;

    #[test]
    fn verify_ffmpeg_paths_with_empty_paths_attempts_discovery() {
        let mut settings = AppSettings {
            providers: vec![],
            active_provider_index: 0,
            ffmpeg_path: String::new(),
            ffprobe_path: String::new(),
            default_output_folder: String::new(),
            naming_template: String::new(),
            max_parallel: 1,
        };

        let (ffmpeg_found, ffprobe_found) = verify_ffmpeg_paths(&mut settings);

        // Discovery may or may not find binaries on the host system.
        // The only invariant we can assert without mocking is consistency.
        assert_eq!(ffmpeg_found, !settings.ffmpeg_path.is_empty());
        assert_eq!(ffprobe_found, !settings.ffprobe_path.is_empty());
    }

    #[test]
    fn verify_ffmpeg_paths_with_populated_paths_does_not_mutate() {
        let mut settings = AppSettings {
            providers: vec![],
            active_provider_index: 0,
            ffmpeg_path: "/custom/ffmpeg".to_string(),
            ffprobe_path: "/custom/ffprobe".to_string(),
            default_output_folder: String::new(),
            naming_template: String::new(),
            max_parallel: 1,
        };

        let (ffmpeg_found, ffprobe_found) = verify_ffmpeg_paths(&mut settings);

        assert!(ffmpeg_found);
        assert!(ffprobe_found);
        assert_eq!(settings.ffmpeg_path, "/custom/ffmpeg");
        assert_eq!(settings.ffprobe_path, "/custom/ffprobe");
    }
}
