use std::path::PathBuf;

pub fn find_binary(name: &str) -> Option<String> {
    let exe_name = if cfg!(windows) {
        format!("{}.exe", name)
    } else {
        name.to_string()
    };

    // 1. Try PATH
    if let Ok(path_var) = std::env::var("PATH") {
        let separator = if cfg!(windows) { ';' } else { ':' };
        for dir in path_var.split(separator) {
            let path = PathBuf::from(dir).join(&exe_name);
            if path.is_file() {
                return Some(path.to_string_lossy().to_string());
            }
        }
    }

    // 2. Try common install locations
    let common_dirs: Vec<PathBuf> = if cfg!(windows) {
        vec![
            "C:\\ffmpeg\\bin".into(),
            "C:\\Program Files\\ffmpeg\\bin".into(),
            "C:\\Program Files (x86)\\ffmpeg\\bin".into(),
        ]
    } else if cfg!(target_os = "macos") {
        vec![
            "/usr/local/bin".into(),
            "/opt/homebrew/bin".into(),
            "/usr/bin".into(),
        ]
    } else {
        vec![
            "/usr/bin".into(),
            "/usr/local/bin".into(),
            "/snap/bin".into(),
        ]
    };

    for dir in common_dirs {
        let path = dir.join(&exe_name);
        if path.is_file() {
            return Some(path.to_string_lossy().to_string());
        }
    }

    None
}
