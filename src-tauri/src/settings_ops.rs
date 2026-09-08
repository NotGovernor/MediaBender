use crate::binary_discovery::find_binary;
use crate::models::AppSettings;

pub fn clamp_max_parallel(n: i32) -> i32 {
    n.clamp(1, 4)
}

pub fn clamp_settings_max_parallel(settings: &mut AppSettings) {
    settings.max_parallel = clamp_max_parallel(settings.max_parallel);
}

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
            check_updates_on_startup: true,
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
            check_updates_on_startup: true,
        };

        let (ffmpeg_found, ffprobe_found) = verify_ffmpeg_paths(&mut settings);

        assert!(ffmpeg_found);
        assert!(ffprobe_found);
        assert_eq!(settings.ffmpeg_path, "/custom/ffmpeg");
        assert_eq!(settings.ffprobe_path, "/custom/ffprobe");
    }

    #[test]
    fn clamp_max_parallel_leaves_1_through_4() {
        assert_eq!(clamp_max_parallel(1), 1);
        assert_eq!(clamp_max_parallel(4), 4);
    }

    #[test]
    fn clamp_max_parallel_low_and_high() {
        assert_eq!(clamp_max_parallel(0), 1);
        assert_eq!(clamp_max_parallel(-2), 1);
        assert_eq!(clamp_max_parallel(5), 4);
        assert_eq!(clamp_max_parallel(8), 4);
        assert_eq!(clamp_max_parallel(99), 4);
    }

    #[test]
    fn clamp_settings_max_parallel_mutates_field() {
        let mut settings = AppSettings {
            providers: vec![],
            active_provider_index: 0,
            ffmpeg_path: String::new(),
            ffprobe_path: String::new(),
            default_output_folder: String::new(),
            naming_template: String::new(),
            max_parallel: 8,
            check_updates_on_startup: true,
        };
        clamp_settings_max_parallel(&mut settings);
        assert_eq!(settings.max_parallel, 4);
    }
}
