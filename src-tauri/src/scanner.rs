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

pub(crate) fn create_video_file(path: &str, scan_root: Option<&str>) -> Option<VideoFile> {
    let id = uuid::Uuid::new_v4().to_string();
    let input_size = std::fs::metadata(path).map(|m| m.len() as i64).unwrap_or(0);
    let now = chrono::Utc::now().to_rfc3339();

    let scan_root = scan_root
        .map(|s| s.to_string())
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

    #[test]
    fn scan_directory_nonrecursive_uses_folder_as_scan_root() {
        let dir = std::env::temp_dir().join(format!("mb_scan_{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let file = dir.join("clip.mkv");
        std::fs::write(&file, b"not a real mkv").unwrap();
        let files = scan_directory(dir.to_str().unwrap(), false);
        assert_eq!(files.len(), 1);
        assert_eq!(files[0].scan_root.replace('\\', "/"), dir.to_string_lossy().replace('\\', "/"));
        assert!(files[0].input_path.replace('\\', "/").ends_with("clip.mkv"));
        let _ = std::fs::remove_dir_all(&dir);
    }
}
