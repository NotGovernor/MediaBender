use crate::models::{AppSettings, WorkQueue};

pub fn default_guidelines() -> String {
    include_str!("../../DefaultGuidelines.md").to_string()
}

pub fn default_queue(guidelines: String) -> WorkQueue {
    WorkQueue {
        output_folder: String::new(),
        guidelines,
        files: Vec::new(),
        created_at: chrono::Utc::now().to_rfc3339(),
        last_modified: chrono::Utc::now().to_rfc3339(),
    }
}

pub fn default_settings() -> AppSettings {
    AppSettings {
        providers: vec![],
        active_provider_index: 0,
        ffmpeg_path: String::new(),
        ffprobe_path: String::new(),
        default_output_folder: String::new(),
        naming_template: "{name}.mkv".to_string(),
        max_parallel: 1,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_guidelines_contains_your_task_section() {
        let guidelines = default_guidelines();
        assert!(guidelines.contains("Your Task"), "Should contain 'Your Task' section");
    }

    #[test]
    fn default_guidelines_contains_key_sections() {
        let guidelines = default_guidelines();
        assert!(guidelines.contains("Environment"), "Should contain 'Environment' section");
        assert!(guidelines.contains("Video"), "Should contain 'Video' section");
        assert!(guidelines.contains("Audio"), "Should contain 'Audio' section");
        assert!(guidelines.contains("Example Commands"), "Should contain 'Example Commands' section");
        assert!(guidelines.contains("Fallback Rule"), "Should contain 'Fallback Rule' section");
    }

    #[test]
    fn default_guidelines_contains_at_least_nine_example_command_blocks() {
        let guidelines = default_guidelines();
        // Count fenced code blocks (```) in the guidelines
        let fence_count = guidelines.matches("```").count();
        // Each example has one ``` block, and there are a few other blocks in the doc
        // We expect at least 9 example blocks, which means at least 18 fence markers
        // plus a few from other sections. The exact count isn't important — we just
        // need enough fenced blocks to cover 9 examples.
        assert!(fence_count >= 18, "Expected at least 9 fenced code blocks (18 fence markers), found {}", fence_count / 2);

        // Also verify specific example titles are present
        assert!(guidelines.contains("Example 1:"));
        assert!(guidelines.contains("Example 2:"));
        assert!(guidelines.contains("Example 3:"));
        assert!(guidelines.contains("Example 4:"));
        assert!(guidelines.contains("Example 5:"));
        assert!(guidelines.contains("Example 6:"));
        assert!(guidelines.contains("Example 7:"));
        assert!(guidelines.contains("Example 8:"));
        assert!(guidelines.contains("Example 9:"));
    }
}
