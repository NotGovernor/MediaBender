use crate::models::VideoFile;
use std::path::Path;
use walkdir::WalkDir;

const VIDEO_EXTENSIONS: &[&str] = &[
    "mkv", "mp4", "avi", "mov", "wmv", "flv", "webm", "m4v", "ts", "m2ts", "mts", "vob",
];

pub fn scan_directory(path: &str, recursive: bool) -> Vec<VideoFile> {
    let mut files = Vec::new();
    let base_path = Path::new(path);

    if base_path.is_file() {
        if let Some(file) = create_video_file(path, None) {
            files.push(file);
        }
        return files;
    }

    let walker = if recursive {
        WalkDir::new(path).into_iter()
    } else {
        WalkDir::new(path).max_depth(1).into_iter()
    };

    for entry in walker.filter_map(|e| e.ok()) {
        let entry_path = entry.path();
        if entry_path.is_file() {
            if let Some(ext) = entry_path.extension() {
                let ext = ext.to_string_lossy().to_lowercase();
                if VIDEO_EXTENSIONS.contains(&ext.as_str()) {
                    if let Some(file) =
                        create_video_file(entry_path.to_string_lossy().as_ref(), Some(path))
                    {
                        files.push(file);
                    }
                }
            }
        }
    }

    files
}

fn scan_root_for_added_folder(folder: &str) -> String {
    let trimmed = folder.replace('\\', "/");
    let trimmed = trimmed.trim_end_matches('/');
    let trimmed = if trimmed.is_empty() {
        "/".to_string()
    } else {
        trimmed.to_string()
    };
    let path = std::path::Path::new(folder.trim_end_matches(['/', '\\']));
    match path.parent() {
        Some(parent) if !parent.as_os_str().is_empty() => parent.to_string_lossy().to_string(),
        _ => trimmed,
    }
}

pub(crate) fn create_video_file(path: &str, scan_root: Option<&str>) -> Option<VideoFile> {
    let id = uuid::Uuid::new_v4().to_string();
    let input_size = std::fs::metadata(path).map(|m| m.len() as i64).unwrap_or(0);
    let now = chrono::Utc::now().to_rfc3339();

    let scan_root = scan_root
        .map(scan_root_for_added_folder)
        .or_else(|| {
            std::path::Path::new(path)
                .parent()
                .map(|p| p.to_string_lossy().to_string())
        })
        .unwrap_or_default();

    Some(VideoFile {
        id,
        input_path: path.to_string(),
        output_path: String::new(),
        scan_root,
        ffprobe_raw: String::new(),
        metadata: None,
        generated_command: String::new(),
        command_args: String::new(),
        description: String::new(),
        reasoning: String::new(),
        status: crate::models::FileStatus::Pending,
        is_approved: false,
        error_message: String::new(),
        user_notes: vec![],
        created_at: now.clone(),
        updated_at: now,
        input_size,
        output_size: 0,
        processing_duration: 0.0,
        completed_at: String::new(),
    })
}

pub fn is_video_file(path: &str) -> bool {
    Path::new(path)
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| {
            let e = e.to_lowercase();
            VIDEO_EXTENSIONS.contains(&e.as_str())
        })
        .unwrap_or(false)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn create_video_file_uses_parent_as_scan_root_for_single_file() {
        let f = create_video_file("/media/Show/Episode.mkv", None).unwrap();
        assert_eq!(f.input_path, "/media/Show/Episode.mkv");
        assert_eq!(f.scan_root, "/media/Show");
        assert!(f.metadata.is_none());
        assert_eq!(f.status, crate::models::FileStatus::Pending);
        assert!(!f.is_approved);
    }

    #[test]
    fn is_video_file_accepts_mkv_case_insensitive() {
        assert!(is_video_file("C:/a/B.MKV"));
        assert!(!is_video_file("C:/a/readme.txt"));
    }

    fn norm(p: impl AsRef<str>) -> String {
        p.as_ref()
            .replace('\\', "/")
            .trim_end_matches('/')
            .to_string()
    }

    #[test]
    fn scan_directory_nonrecursive_uses_folder_as_scan_root() {
        let dir = std::env::temp_dir().join(format!("mb_scan_{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let file = dir.join("clip.mkv");
        std::fs::write(&file, b"not a real mkv").unwrap();
        let files = scan_directory(dir.to_str().unwrap(), false);
        assert_eq!(files.len(), 1);
        let expected_root = dir.parent().unwrap().to_string_lossy().to_string();
        assert_eq!(norm(&files[0].scan_root), norm(&expected_root));
        assert_ne!(norm(&files[0].scan_root), norm(&dir.to_string_lossy()));
        assert!(files[0].input_path.replace('\\', "/").ends_with("clip.mkv"));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn scan_directory_uses_parent_of_added_folder_as_scan_root() {
        let media = std::env::temp_dir().join(format!("mb_scan_parent_{}", std::process::id()));
        let tv = media.join("TV");
        let show = tv.join("Show");
        std::fs::create_dir_all(&show).unwrap();
        std::fs::write(show.join("ep.mkv"), b"not a real mkv").unwrap();
        let files = scan_directory(tv.to_str().unwrap(), true);
        assert_eq!(files.len(), 1);
        assert_eq!(norm(&files[0].scan_root), norm(&media.to_string_lossy()));
        assert_ne!(norm(&files[0].scan_root), norm(&tv.to_string_lossy()));
        let _ = std::fs::remove_dir_all(&media);
    }

    #[test]
    fn scan_directory_trims_trailing_slash_before_parent() {
        let dir = std::env::temp_dir().join(format!("mb_scan_slash_{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("clip.mkv"), b"not a real mkv").unwrap();
        let with_slash = format!("{}/", dir.to_str().unwrap().trim_end_matches(['/', '\\']));
        let files = scan_directory(&with_slash, false);
        assert_eq!(files.len(), 1);
        let expected_root = dir.parent().unwrap().to_string_lossy().to_string();
        assert_eq!(norm(&files[0].scan_root), norm(&expected_root));
        assert_ne!(norm(&files[0].scan_root), norm(&dir.to_string_lossy()));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn create_video_file_none_still_uses_file_parent() {
        let f = create_video_file("/media/Show/Episode.mkv", None).unwrap();
        assert_eq!(f.scan_root, "/media/Show");
    }

    #[test]
    fn scan_root_for_added_folder_keeps_unix_root() {
        assert_eq!(scan_root_for_added_folder("/"), "/");
    }

    #[test]
    fn scan_root_for_added_folder_parent_of_first_level_unix_dir_is_root() {
        assert_eq!(scan_root_for_added_folder("/Movies"), "/");
        assert_eq!(scan_root_for_added_folder("/Movies/"), "/");
    }

    #[test]
    fn scan_root_for_added_folder_keeps_unix_root_after_slash_trim() {
        assert_eq!(scan_root_for_added_folder("///"), "/");
    }

    #[cfg(windows)]
    #[test]
    fn scan_root_for_added_folder_keeps_windows_drive_root() {
        for folder in ["C:\\", "C:/"] {
            let root = scan_root_for_added_folder(folder);
            assert!(
                !root.is_empty(),
                "scan_root for {folder:?} must not be empty"
            );
            let lowered = root.replace('\\', "/").to_ascii_uppercase();
            assert!(
                lowered == "C:" || lowered == "C:/" || lowered == "C:\\",
                "scan_root for {folder:?} must keep the volume, got {root:?}"
            );
            assert!(
                !lowered.starts_with("//") && lowered != "/",
                "scan_root for {folder:?} must not be a parent of the drive, got {root:?}"
            );
        }
    }
}
