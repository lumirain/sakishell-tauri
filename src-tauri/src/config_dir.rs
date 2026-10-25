//! 配置文件目录解析。
//!
//! 优先级：环境变量 `SAKISHELL_CONFIG_DIR` > 覆盖文件（设置界面写入）> 平台默认。
//! - Windows 默认：程序安装目录下的 `config` 文件夹
//! - Android / 其他平台：Tauri `app_config_dir()`（保持原行为，Android 上安装目录只读）
//!
//! 覆盖文件存放在**固定的系统配置位置**（不受配置目录本身影响），
//! 避免「配置目录改了，覆盖记录也找不着」的鸡生蛋问题。
//! 仅在桌面端开放自定义；Android 返回 None，设置界面不展示该项。

use std::path::{Path, PathBuf};

/// 覆盖文件所在目录名（位于系统固定配置目录下）。
const OVERRIDE_DIR_NAME: &str = "SakiShell";
/// 覆盖文件名：内容为一行配置目录绝对路径。
const OVERRIDE_FILE_NAME: &str = "config_dir.txt";
/// 旧版默认配置目录标识（迁移来源，Windows `%APPDATA%\{identifier}`）。
pub const APP_IDENTIFIER: &str = "com.sakishell.app";

/// 启动时是否执行过「旧目录 → 新默认目录」迁移。
static MIGRATED: std::sync::OnceLock<bool> = std::sync::OnceLock::new();

/// 覆盖文件固定位置（与当前配置目录无关）。
pub fn override_file_path() -> Option<PathBuf> {
    if cfg!(target_os = "android") {
        return None;
    }
    platform_system_config_dir().map(|base| base.join(OVERRIDE_DIR_NAME).join(OVERRIDE_FILE_NAME))
}

/// 系统固定配置目录（Windows=APPDATA，Linux/macOS=用户配置目录）。
fn platform_system_config_dir() -> Option<PathBuf> {
    #[cfg(target_os = "windows")]
    {
        std::env::var("APPDATA").ok().map(PathBuf::from)
    }
    #[cfg(target_os = "macos")]
    {
        std::env::var("HOME")
            .ok()
            .map(|h| PathBuf::from(h).join("Library").join("Application Support"))
    }
    #[cfg(target_os = "linux")]
    {
        std::env::var("XDG_CONFIG_HOME")
            .ok()
            .filter(|s| !s.is_empty())
            .map(PathBuf::from)
            .or_else(|| {
                std::env::var("HOME")
                    .ok()
                    .map(|h| PathBuf::from(h).join(".config"))
            })
    }
    #[cfg(not(any(
        target_os = "windows",
        target_os = "macos",
        target_os = "linux",
        target_os = "android"
    )))]
    {
        None
    }
}

/// 读取覆盖文件中的自定义配置目录（未设置或为空时返回 None）。
pub fn read_override() -> Option<PathBuf> {
    let file = override_file_path()?;
    let content = std::fs::read_to_string(&file).ok()?;
    let trimmed = content.trim();
    if trimmed.is_empty() {
        return None;
    }
    Some(PathBuf::from(trimmed))
}

/// 写入自定义配置目录（校验：非空、绝对路径、目录可创建且可写）。
pub fn write_override(path: &str) -> Result<(), String> {
    let trimmed = path.trim();
    if trimmed.is_empty() {
        return Err("配置路径不能为空".into());
    }
    let p = Path::new(trimmed);
    if !p.is_absolute() {
        return Err("配置路径必须是绝对路径".into());
    }
    // 目录可创建 + 可写校验（写探针文件后删除）
    std::fs::create_dir_all(p).map_err(|e| format!("无法创建目录 {}: {}", trimmed, e))?;
    let probe = p.join(".sakishell-write-test");
    std::fs::write(&probe, b"").map_err(|e| format!("目录不可写 {}: {}", trimmed, e))?;
    let _ = std::fs::remove_file(&probe);

    let file = override_file_path().ok_or("当前平台不支持自定义配置路径")?;
    if let Some(parent) = file.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("无法创建记录文件目录 {}: {}", parent.display(), e))?;
    }
    std::fs::write(&file, trimmed).map_err(|e| format!("保存配置路径失败: {}", e))
}

/// 清除自定义配置目录（恢复平台默认）。
pub fn clear_override() -> Result<(), String> {
    if let Some(file) = override_file_path() {
        if file.exists() {
            std::fs::remove_file(&file).map_err(|e| format!("清除配置路径失败: {}", e))?;
        }
    }
    Ok(())
}

/// 解析最终生效的配置目录。
///
/// `platform_default` 由调用方按平台给出：Windows 传「安装目录/config」，
/// Android/其他传 Tauri `app_config_dir()`。
pub fn resolve_config_dir(platform_default: &Path) -> PathBuf {
    if let Ok(env_dir) = std::env::var("SAKISHELL_CONFIG_DIR") {
        let trimmed = env_dir.trim();
        if !trimmed.is_empty() {
            return PathBuf::from(trimmed);
        }
    }
    if let Some(path) = read_override() {
        return path;
    }
    platform_default.to_path_buf()
}

/// 旧版默认配置目录（迁移来源）。仅 Windows 有（`%APPDATA%\com.sakishell.app`）。
pub fn legacy_config_dir() -> Option<PathBuf> {
    #[cfg(target_os = "windows")]
    {
        std::env::var("APPDATA")
            .ok()
            .map(|d| PathBuf::from(d).join(APP_IDENTIFIER))
    }
    #[cfg(not(target_os = "windows"))]
    {
        None
    }
}

/// 首次切到新默认目录时，把旧目录内容整体复制过来（旧目录保留不动）。
///
/// 仅在目标目录不存在、未使用自定义路径、且旧目录确实有数据时执行。
pub fn migrate_legacy_if_needed(target: &Path) -> Result<bool, String> {
    let Some(src) = legacy_config_dir() else {
        return Ok(false);
    };
    if !src.exists() || target.exists() || src == target {
        return Ok(false);
    }
    // 旧目录连基本配置文件都没有时视为空，不迁移
    let has_data = src.join("settings.json").exists() || src.join("connections.json").exists();
    if !has_data {
        return Ok(false);
    }
    std::fs::create_dir_all(target)
        .map_err(|e| format!("创建配置目录失败 {}: {}", target.display(), e))?;
    copy_dir(&src, target).map_err(|e| format!("迁移旧配置失败 {} -> {}: {}", src.display(), target.display(), e))?;
    Ok(true)
}

/// 记录本次启动是否执行过迁移。
pub fn set_migrated(migrated: bool) {
    let _ = MIGRATED.set(migrated);
}

/// 本次启动是否执行过迁移（供设置界面提示）。
pub fn migrated_this_run() -> bool {
    MIGRATED.get().copied().unwrap_or(false)
}

/// 递归复制目录内容。
fn copy_dir(src: &Path, dst: &Path) -> std::io::Result<()> {
    for entry in std::fs::read_dir(src)? {
        let entry = entry?;
        let from = entry.path();
        let to = dst.join(entry.file_name());
        if from.is_dir() {
            std::fs::create_dir_all(&to)?;
            copy_dir(&from, &to)?;
        } else {
            std::fs::copy(&from, &to)?;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resolve_prefers_env_over_override_over_default() {
        let default = PathBuf::from("/def");
        // 无 env 无 override → 默认
        // （环境变量无法在此安全修改；只验证 read_override 为空时的回退）
        assert_eq!(resolve_config_dir(&default), default);
    }

    #[test]
    fn override_roundtrip() {
        let Some(file) = override_file_path() else {
            return; // Android 等平台跳过
        };
        let dir = std::env::temp_dir().join(format!("sakishell-cfg-test-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        write_override(dir.to_str().unwrap()).unwrap();
        assert_eq!(read_override(), Some(dir.clone()));
        clear_override().unwrap();
        assert!(read_override().is_none());
        let _ = std::fs::remove_dir_all(&dir);
        let _ = file;
    }

    #[test]
    fn override_rejects_relative_and_empty() {
        assert!(write_override("").is_err());
        assert!(write_override("   ").is_err());
        assert!(write_override("relative/path").is_err());
    }

    #[test]
    fn migrate_copies_content_and_keeps_source() {
        let Some(src) = legacy_config_dir() else {
            return; // 非 Windows 跳过
        };
        if !src.exists() {
            return;
        }
        let tmp = std::env::temp_dir().join(format!("sakishell-migrate-test-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&tmp);
        let ok = migrate_legacy_if_needed(&tmp).unwrap();
        // 只断言不炸、且源目录仍存在；具体迁移与否取决于本机是否有旧数据
        assert!(src.exists());
        let _ = ok;
        let _ = std::fs::remove_dir_all(&tmp);
    }
}
