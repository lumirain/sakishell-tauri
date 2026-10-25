//! 配置目录相关命令：读取当前生效路径 / 自定义设置 / 恢复默认。
//! 改动为「重启生效」：config_dir 在启动时解析，写入后需重启应用按新目录加载。

use serde::Serialize;
use tauri::State;

use crate::{config_dir, AppState};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConfigPathInfo {
    /// 当前生效的配置目录
    pub current: String,
    /// 平台默认配置目录（Windows = 程序安装目录/config）
    pub default: String,
    /// 是否使用了自定义路径（覆盖文件）
    pub using_override: bool,
    /// 覆盖文件记录的自定义路径（未设置时为空字符串）
    pub override_path: String,
    /// 当前平台是否支持自定义（Android 不支持）
    pub configurable: bool,
    /// 本次启动是否执行过「旧目录 → 新默认目录」迁移
    pub migrated: bool,
}

#[tauri::command]
pub fn config_path_get(state: State<'_, AppState>) -> ConfigPathInfo {
    let current = state.config_dir.display().to_string();
    let override_path = config_dir::read_override()
        .map(|p| p.display().to_string())
        .unwrap_or_default();
    let default = platform_default(&state);
    let configurable = config_dir::override_file_path().is_some();
    ConfigPathInfo {
        current,
        default,
        using_override: !override_path.is_empty(),
        override_path,
        configurable,
        migrated: config_dir::migrated_this_run(),
    }
}

/// 设置自定义配置目录（重启后生效）。
#[tauri::command]
pub fn config_path_set(path: String) -> Result<(), String> {
    config_dir::write_override(&path)
}

/// 恢复平台默认配置目录（重启后生效）。
#[tauri::command]
pub fn config_path_reset() -> Result<(), String> {
    config_dir::clear_override()
}

/// 平台默认配置目录（与启动时解析逻辑一致；Windows = 安装目录/config）。
fn platform_default(state: &AppState) -> String {
    #[cfg(target_os = "windows")]
    {
        std::env::current_exe()
            .ok()
            .and_then(|exe| exe.parent().map(|p| p.to_path_buf()))
            .map(|dir| dir.join("config").display().to_string())
            .unwrap_or_else(|| state.config_dir.display().to_string())
    }
    #[cfg(not(target_os = "windows"))]
    {
        state.config_dir.display().to_string()
    }
}
