use crate::error::AppError;

/// Service name used in the system keychain. All entries for this app are scoped
/// under this service to avoid colliding with other apps.
const SERVICE: &str = "com.sakishell.app";

// ── Android ──────────────────────────────────────────────────────────────────
// keyring v4 的 `v1` 便利模块只覆盖 macOS/Windows/Linux，Android 不在其中
// （v1.rs set_credential_store 对 Android 无分支，Entry::new 返回 NoDefaultStore）。
// 因此 Android 直接用 android-native-keyring-store（SharedPreferences + Android
// Keystore AES 加密，hardware-backed），通过 keyring-core 的 Entry API 操作。
// ndk-context 由 Tauri Android 在启动时初始化（util.rs 已在用 android_context()）。

#[cfg(target_os = "android")]
mod android_store {
    use std::sync::{Arc, OnceLock};

    use keyring_core::{api::CredentialStoreApi, Entry, Error, Result};

    /// 单例 store，避免每次 Entry::new 都重建 vault 连接。
    fn store() -> Result<&'static Arc<android_native_keyring_store::Store>> {
        static STORE: OnceLock<Result<Arc<android_native_keyring_store::Store>>> = OnceLock::new();
        STORE
            .get_or_init(android_native_keyring_store::Store::new)
            .as_ref()
            .map_err(|e| {
                Error::PlatformFailure(
                    std::io::Error::new(
                        std::io::ErrorKind::Other,
                        format!("Android 密钥存储初始化失败：{e}"),
                    )
                    .into(),
                )
            })
    }

    pub fn entry(service: &str, user: &str) -> Result<Entry> {
        store()?.build(service, user, None)
    }

    /// 把 keyring-core 的 NoEntry 映射为 Ok(None)，其他错误原样冒泡。
    pub fn get_optional_password(entry: &Entry) -> Result<Option<String>> {
        match entry.get_password() {
            Ok(pw) => Ok(Some(pw)),
            Err(Error::NoEntry) => Ok(None),
            Err(e) => Err(e),
        }
    }

    /// 删除条目，NoEntry 视为成功（与桌面端 delete_password 语义一致）。
    pub fn delete_if_exists(entry: &Entry) -> Result<()> {
        match entry.delete_credential() {
            Ok(()) | Err(Error::NoEntry) => Ok(()),
            Err(e) => Err(e),
        }
    }
}

#[cfg(target_os = "android")]
use android_store as store_impl;

// ── Desktop ──────────────────────────────────────────────────────────────────

#[cfg(not(target_os = "android"))]
mod desktop_store {
    use keyring::{Entry, Error, Result};

    pub fn entry(service: &str, user: &str) -> Result<Entry> {
        Entry::new(service, user)
    }

    pub fn get_optional_password(entry: &Entry) -> Result<Option<String>> {
        match entry.get_password() {
            Ok(pw) => Ok(Some(pw)),
            Err(Error::NoEntry) => Ok(None),
            Err(e) => Err(e),
        }
    }

    pub fn delete_if_exists(entry: &Entry) -> Result<()> {
        match entry.delete_credential() {
            Ok(()) | Err(Error::NoEntry) => Ok(()),
            Err(e) => Err(e),
        }
    }
}

#[cfg(not(target_os = "android"))]
use desktop_store as store_impl;

/// Store a password in the system keychain, associated with `account` (e.g. connection id).
pub fn save_password(account: &str, password: &str) -> Result<(), AppError> {
    let entry = store_impl::entry(SERVICE, account)
        .map_err(|e| AppError::Config(format!("密钥链初始化失败：{}", e)))?;
    entry
        .set_password(password)
        .map_err(|e| AppError::Config(format!("保存密码到密钥链失败：{}", e)))?;
    Ok(())
}

/// Retrieve a password from the system keychain. Returns `Ok(None)` if not found.
pub fn get_password(account: &str) -> Result<Option<String>, AppError> {
    let entry = store_impl::entry(SERVICE, account)
        .map_err(|e| AppError::Config(format!("密钥链初始化失败：{}", e)))?;
    store_impl::get_optional_password(&entry)
        .map_err(|e| AppError::Config(format!("读取密钥链失败：{}", e)))
}

/// Remove a password from the system keychain. Missing entries are treated as success.
pub fn delete_password(account: &str) -> Result<(), AppError> {
    let entry = store_impl::entry(SERVICE, account)
        .map_err(|e| AppError::Config(format!("密钥链初始化失败：{}", e)))?;
    store_impl::delete_if_exists(&entry)
        .map_err(|e| AppError::Config(format!("删除密钥链条目失败：{}", e)))
}

/// Store the LLM API key in the system keychain.
pub fn save_llm_api_key(api_key: &str) -> Result<(), AppError> {
    let entry = store_impl::entry(SERVICE, "llm_api_key")
        .map_err(|e| AppError::Config(format!("密钥链初始化失败：{}", e)))?;
    entry
        .set_password(api_key)
        .map_err(|e| AppError::Config(format!("保存 API Key 到密钥链失败：{}", e)))?;
    Ok(())
}

/// Retrieve the LLM API key from the system keychain. Returns `Ok(None)` if not found.
pub fn get_llm_api_key() -> Result<Option<String>, AppError> {
    let entry = store_impl::entry(SERVICE, "llm_api_key")
        .map_err(|e| AppError::Config(format!("密钥链初始化失败：{}", e)))?;
    store_impl::get_optional_password(&entry)
        .map_err(|e| AppError::Config(format!("读取密钥链失败：{}", e)))
}

/// Remove the LLM API key from the system keychain.
pub fn delete_llm_api_key() -> Result<(), AppError> {
    let entry = store_impl::entry(SERVICE, "llm_api_key")
        .map_err(|e| AppError::Config(format!("密钥链初始化失败：{}", e)))?;
    store_impl::delete_if_exists(&entry)
        .map_err(|e| AppError::Config(format!("删除密钥链条目失败：{}", e)))
}

/// 分渠道 LLM API Key：account = `llm_channel_{channel_id}`。
/// 多渠道模型服务下每个渠道独立存放密钥，互不干扰。
fn channel_key_account(channel_id: &str) -> String {
    format!("llm_channel_{}", channel_id)
}

/// Store a per-channel LLM API key in the system keychain.
pub fn save_llm_channel_key(channel_id: &str, api_key: &str) -> Result<(), AppError> {
    let entry = store_impl::entry(SERVICE, &channel_key_account(channel_id))
        .map_err(|e| AppError::Config(format!("密钥链初始化失败：{}", e)))?;
    entry
        .set_password(api_key)
        .map_err(|e| AppError::Config(format!("保存 API Key 到密钥链失败：{}", e)))?;
    Ok(())
}

/// Retrieve a per-channel LLM API key. Returns `Ok(None)` if not found.
pub fn get_llm_channel_key(channel_id: &str) -> Result<Option<String>, AppError> {
    let entry = store_impl::entry(SERVICE, &channel_key_account(channel_id))
        .map_err(|e| AppError::Config(format!("密钥链初始化失败：{}", e)))?;
    store_impl::get_optional_password(&entry)
        .map_err(|e| AppError::Config(format!("读取密钥链失败：{}", e)))
}

/// Remove a per-channel LLM API key. Missing entries are treated as success.
pub fn delete_llm_channel_key(channel_id: &str) -> Result<(), AppError> {
    let entry = store_impl::entry(SERVICE, &channel_key_account(channel_id))
        .map_err(|e| AppError::Config(format!("密钥链初始化失败：{}", e)))?;
    store_impl::delete_if_exists(&entry)
        .map_err(|e| AppError::Config(format!("删除密钥链条目失败：{}", e)))
}

/// Store the web search API key in the system keychain.
pub fn save_web_search_api_key(api_key: &str) -> Result<(), AppError> {
    let entry = store_impl::entry(SERVICE, "web_search_api_key")
        .map_err(|e| AppError::Config(format!("密钥链初始化失败：{}", e)))?;
    entry
        .set_password(api_key)
        .map_err(|e| AppError::Config(format!("保存搜索 API Key 到密钥链失败：{}", e)))?;
    Ok(())
}

/// Store the DeepSeek tools API key (web search + web fetch) in the system keychain.
///
/// 独立槽位，**不要**并进 `web_search_api_key`：那一份由 Brave/Tavily 按用户当前选的提供商
/// 轮流占用，而「搜索提供商」与「网页获取方式」是两个互不相干的设置——共用的话，选了
/// Brave 搜索 + DeepSeek 获取的人，Brave 的 Key 会被原样发给 DeepSeek。也不复用 LLM 渠道
/// Key：渠道 Key 绑定在某个渠道上，随渠道增删，工具类接口不属于任何渠道。
pub fn save_deepseek_tools_api_key(api_key: &str) -> Result<(), AppError> {
    let entry = store_impl::entry(SERVICE, "deepseek_tools_api_key")
        .map_err(|e| AppError::Config(format!("密钥链初始化失败：{}", e)))?;
    entry
        .set_password(api_key)
        .map_err(|e| AppError::Config(format!("保存 DeepSeek API Key 到密钥链失败：{}", e)))?;
    Ok(())
}

/// Retrieve the DeepSeek tools API key. Returns `Ok(None)` if not found.
pub fn get_deepseek_tools_api_key() -> Result<Option<String>, AppError> {
    let entry = store_impl::entry(SERVICE, "deepseek_tools_api_key")
        .map_err(|e| AppError::Config(format!("密钥链初始化失败：{}", e)))?;
    store_impl::get_optional_password(&entry)
        .map_err(|e| AppError::Config(format!("读取 DeepSeek API Key 失败：{}", e)))
}

/// Remove the DeepSeek tools API key. Missing entries are treated as success.
pub fn delete_deepseek_tools_api_key() -> Result<(), AppError> {
    let entry = store_impl::entry(SERVICE, "deepseek_tools_api_key")
        .map_err(|e| AppError::Config(format!("密钥链初始化失败：{}", e)))?;
    store_impl::delete_if_exists(&entry)
        .map_err(|e| AppError::Config(format!("删除 DeepSeek API Key 失败：{}", e)))
}

/// Store the key of the user-configured ("custom") search API in the system keychain.
///
/// 又一个独立槽位：地址是用户自己填的任意主机，把 Brave/DeepSeek 的 Key 借给它就等于
/// 把别家的凭据发给一个我们完全不认识的服务。
pub fn save_custom_search_api_key(api_key: &str) -> Result<(), AppError> {
    let entry = store_impl::entry(SERVICE, "custom_search_api_key")
        .map_err(|e| AppError::Config(format!("密钥链初始化失败：{}", e)))?;
    entry
        .set_password(api_key)
        .map_err(|e| AppError::Config(format!("保存自定义搜索 API Key 到密钥链失败：{}", e)))?;
    Ok(())
}

/// Retrieve the custom search API key. Returns `Ok(None)` if not found.
pub fn get_custom_search_api_key() -> Result<Option<String>, AppError> {
    let entry = store_impl::entry(SERVICE, "custom_search_api_key")
        .map_err(|e| AppError::Config(format!("密钥链初始化失败：{}", e)))?;
    store_impl::get_optional_password(&entry)
        .map_err(|e| AppError::Config(format!("读取自定义搜索 API Key 失败：{}", e)))
}

/// Remove the custom search API key. Missing entries are treated as success.
pub fn delete_custom_search_api_key() -> Result<(), AppError> {
    let entry = store_impl::entry(SERVICE, "custom_search_api_key")
        .map_err(|e| AppError::Config(format!("密钥链初始化失败：{}", e)))?;
    store_impl::delete_if_exists(&entry)
        .map_err(|e| AppError::Config(format!("删除自定义搜索 API Key 失败：{}", e)))
}

/// Store the key of the user-configured ("custom") page-fetch service in the system keychain.
///
/// 与自定义搜索 Key 也分开：搜索与抓取是两个互不相干的设置，各指向各的地址，
/// 共用就等于把一个服务的凭据发给另一个。
pub fn save_custom_fetch_api_key(api_key: &str) -> Result<(), AppError> {
    let entry = store_impl::entry(SERVICE, "custom_fetch_api_key")
        .map_err(|e| AppError::Config(format!("密钥链初始化失败：{}", e)))?;
    entry
        .set_password(api_key)
        .map_err(|e| AppError::Config(format!("保存自定义抓取 API Key 到密钥链失败：{}", e)))?;
    Ok(())
}

/// Retrieve the custom fetch API key. Returns `Ok(None)` if not found.
pub fn get_custom_fetch_api_key() -> Result<Option<String>, AppError> {
    let entry = store_impl::entry(SERVICE, "custom_fetch_api_key")
        .map_err(|e| AppError::Config(format!("密钥链初始化失败：{}", e)))?;
    store_impl::get_optional_password(&entry)
        .map_err(|e| AppError::Config(format!("读取自定义抓取 API Key 失败：{}", e)))
}

/// Remove the custom fetch API key. Missing entries are treated as success.
pub fn delete_custom_fetch_api_key() -> Result<(), AppError> {
    let entry = store_impl::entry(SERVICE, "custom_fetch_api_key")
        .map_err(|e| AppError::Config(format!("密钥链初始化失败：{}", e)))?;
    store_impl::delete_if_exists(&entry)
        .map_err(|e| AppError::Config(format!("删除自定义抓取 API Key 失败：{}", e)))
}

/// Store the Tavily Extract key (the "Tavily" page-fetch mode) in the system keychain.
///
/// 与 Brave/Tavily 搜索共用的 `web_search_api_key` 分开：那个槽位可能装着 Brave 的 Key，
/// 选了 Brave 搜索 + Tavily 抓取的人，借它就会把 Brave 的 Key 发给 Tavily。
/// 抓取时优先用这里；留空且搜索提供商恰好是 Tavily 才沿用搜索那把（见 `http_get`）。
pub fn save_tavily_fetch_api_key(api_key: &str) -> Result<(), AppError> {
    let entry = store_impl::entry(SERVICE, "tavily_fetch_api_key")
        .map_err(|e| AppError::Config(format!("密钥链初始化失败：{}", e)))?;
    entry
        .set_password(api_key)
        .map_err(|e| AppError::Config(format!("保存 Tavily 抓取 API Key 到密钥链失败：{}", e)))?;
    Ok(())
}

/// Retrieve the Tavily fetch API key. Returns `Ok(None)` if not found.
pub fn get_tavily_fetch_api_key() -> Result<Option<String>, AppError> {
    let entry = store_impl::entry(SERVICE, "tavily_fetch_api_key")
        .map_err(|e| AppError::Config(format!("密钥链初始化失败：{}", e)))?;
    store_impl::get_optional_password(&entry)
        .map_err(|e| AppError::Config(format!("读取 Tavily 抓取 API Key 失败：{}", e)))
}

/// Remove the Tavily fetch API key. Missing entries are treated as success.
pub fn delete_tavily_fetch_api_key() -> Result<(), AppError> {
    let entry = store_impl::entry(SERVICE, "tavily_fetch_api_key")
        .map_err(|e| AppError::Config(format!("密钥链初始化失败：{}", e)))?;
    store_impl::delete_if_exists(&entry)
        .map_err(|e| AppError::Config(format!("删除 Tavily 抓取 API Key 失败：{}", e)))
}

/// Store the TypeSafe (Jev) API key in the system keychain.
///
/// 全局一份凭据（不像 LLM 渠道按 `channel_id` 分）：命令审批引擎只有一个，
/// 不像模型服务那样可以配多个渠道。
pub fn save_jev_api_key(api_key: &str) -> Result<(), AppError> {
    let entry = store_impl::entry(SERVICE, "jev_api_key")
        .map_err(|e| AppError::Config(format!("密钥链初始化失败：{}", e)))?;
    entry
        .set_password(api_key)
        .map_err(|e| AppError::Config(format!("保存 TypeSafe API Key 到密钥链失败：{}", e)))?;
    Ok(())
}

/// Retrieve the TypeSafe (Jev) API key. Returns `Ok(None)` if not found.
pub fn get_jev_api_key() -> Result<Option<String>, AppError> {
    let entry = store_impl::entry(SERVICE, "jev_api_key")
        .map_err(|e| AppError::Config(format!("密钥链初始化失败：{}", e)))?;
    store_impl::get_optional_password(&entry)
        .map_err(|e| AppError::Config(format!("读取 TypeSafe API Key 失败：{}", e)))
}

/// Remove the TypeSafe (Jev) API key. Missing entries are treated as success.
pub fn delete_jev_api_key() -> Result<(), AppError> {
    let entry = store_impl::entry(SERVICE, "jev_api_key")
        .map_err(|e| AppError::Config(format!("密钥链初始化失败：{}", e)))?;
    store_impl::delete_if_exists(&entry)
        .map_err(|e| AppError::Config(format!("删除 TypeSafe API Key 失败：{}", e)))
}

/// Retrieve the web search API key. Returns `Ok(None)` if not found.
pub fn get_web_search_api_key() -> Result<Option<String>, AppError> {
    let entry = store_impl::entry(SERVICE, "web_search_api_key")
        .map_err(|e| AppError::Config(format!("密钥链初始化失败：{}", e)))?;
    store_impl::get_optional_password(&entry)
        .map_err(|e| AppError::Config(format!("读取搜索 API Key 失败：{}", e)))
}

/// Remove the web search API key from the system keychain.
pub fn delete_web_search_api_key() -> Result<(), AppError> {
    let entry = store_impl::entry(SERVICE, "web_search_api_key")
        .map_err(|e| AppError::Config(format!("密钥链初始化失败：{}", e)))?;
    store_impl::delete_if_exists(&entry)
        .map_err(|e| AppError::Config(format!("删除搜索 API Key 失败：{}", e)))
}
