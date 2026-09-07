use std::process::Stdio;
use tokio::process::Command;

/// Win32 `CREATE_NO_WINDOW`. Hides the console for ffmpeg/ffprobe without
/// detaching stdio. Do **not** use `DETACHED_PROCESS` (0x8) — it breaks pipes.
pub const WINDOWS_CREATE_NO_WINDOW: u32 = 0x0800_0000;

pub fn media_command(program: &str) -> Command {
    let mut cmd = Command::new(program);
    cmd.stdin(Stdio::null());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(WINDOWS_CREATE_NO_WINDOW);
    }
    cmd
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn windows_create_no_window_is_the_hide_console_flag() {
        assert_eq!(WINDOWS_CREATE_NO_WINDOW, 0x0800_0000);
        assert_ne!(WINDOWS_CREATE_NO_WINDOW, 0x0000_0008, "must not be DETACHED_PROCESS");
    }

    #[test]
    fn media_command_returns_a_command_for_the_program() {
        let cmd = media_command("ffmpeg");
        drop(cmd);
    }
}
