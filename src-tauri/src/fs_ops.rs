use std::path::PathBuf;

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
