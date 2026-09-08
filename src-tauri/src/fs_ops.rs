use std::path::{Path, PathBuf};

pub async fn delete_output_file(output_path: String) -> Result<(), String> {
    if output_path.is_empty() {
        return Err("Output path is empty".to_string());
    }
    let path = PathBuf::from(&output_path);
    if !path.exists() {
        return Ok(()); // Already gone, that's fine
    }
    tokio::fs::remove_file(&path)
        .await
        .map_err(|e| format!("Failed to delete output file: {}", e))
}

pub fn ensure_output_parent(output_path: &str) -> Result<(), String> {
    if output_path.trim().is_empty() {
        return Err("Output path is empty".to_string());
    }
    let path = Path::new(output_path);
    let Some(parent) = path.parent() else {
        return Ok(());
    };
    if parent.as_os_str().is_empty() {
        return Ok(());
    }
    std::fs::create_dir_all(parent).map_err(|e| {
        format!(
            "Could not create output directory {}: {}",
            parent.display(),
            e
        )
    })
}

pub fn output_file_exists(output_path: &str) -> bool {
    if output_path.is_empty() {
        return false;
    }
    Path::new(output_path).is_file()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn ensure_output_parent_creates_nested_dirs() {
        let root = std::env::temp_dir().join(format!("mb-mkdir-{}", uuid::Uuid::new_v4()));
        let output = root.join("1").join("Hellboy.mkv");
        ensure_output_parent(&output.to_string_lossy()).unwrap();
        assert!(root.join("1").is_dir());
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn ensure_output_parent_ok_when_parent_exists() {
        let output = std::env::temp_dir().join(format!("mb-exists-{}.mkv", uuid::Uuid::new_v4()));
        ensure_output_parent(&output.to_string_lossy()).unwrap();
    }

    #[test]
    fn ensure_output_parent_errors_on_empty() {
        let err = ensure_output_parent("").unwrap_err();
        assert!(err.contains("empty"));
    }

    #[test]
    fn ensure_output_parent_errors_when_parent_is_a_file() {
        let file = std::env::temp_dir().join(format!("mb-notdir-{}", uuid::Uuid::new_v4()));
        fs::write(&file, b"x").unwrap();
        let output = file.join("Hellboy.mkv");
        let err = ensure_output_parent(&output.to_string_lossy()).unwrap_err();
        assert!(
            err.starts_with("Could not create output directory"),
            "got {err}"
        );
        let _ = fs::remove_file(&file);
    }

    #[test]
    fn output_file_exists_true_for_file() {
        let p = std::env::temp_dir().join(format!("mb_exists_{}.mkv", std::process::id()));
        std::fs::write(&p, b"x").unwrap();
        assert!(output_file_exists(&p.to_string_lossy()));
        let _ = std::fs::remove_file(&p);
    }

    #[test]
    fn output_file_exists_false_if_missing() {
        let p = std::env::temp_dir().join("mb_exists_missing_should_not_exist.mkv");
        let _ = std::fs::remove_file(&p);
        assert!(!output_file_exists(&p.to_string_lossy()));
    }

    #[test]
    fn output_file_exists_false_if_empty_path() {
        assert!(!output_file_exists(""));
    }
}
