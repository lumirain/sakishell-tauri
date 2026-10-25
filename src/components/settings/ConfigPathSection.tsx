import { useState, useEffect, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-dialog';
import Button from '@/components/ui/Button';
import { Card, SettingItem } from './helpers';
import { getErrorMessage } from '@/lib/errors';

interface ConfigPathInfo {
  /** 当前生效的配置目录 */
  current: string;
  /** 平台默认配置目录（Windows = 程序安装目录/config） */
  default: string;
  /** 是否使用了自定义路径（覆盖文件） */
  usingOverride: boolean;
  /** 覆盖文件记录的自定义路径（未设置时为空字符串） */
  overridePath: string;
  /** 当前平台是否支持自定义（Android 不支持） */
  configurable: boolean;
  /** 本次启动是否执行过「旧目录 → 新默认目录」迁移 */
  migrated: boolean;
}

export default function ConfigPathSection() {
  const [info, setInfo] = useState<ConfigPathInfo | null>(null);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const data = await invoke<ConfigPathInfo>('config_path_get');
      setInfo(data);
      setDraft(data.overridePath || data.current);
    } catch (e) {
      setError(getErrorMessage(e));
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  if (!info) return null;
  // Android 等平台不支持自定义配置路径，不展示该设置项
  if (!info.configurable) return null;

  const handleBrowse = async () => {
    try {
      const selected = await open({
        directory: true,
        multiple: false,
        title: '选择配置文件夹',
      });
      if (typeof selected === 'string') {
        setDraft(selected);
        setError(null);
        setNotice(null);
      }
    } catch (e) {
      setError(getErrorMessage(e));
    }
  };

  const handleSave = async () => {
    const path = draft.trim();
    if (!path) {
      setError('配置路径不能为空');
      return;
    }
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      await invoke('config_path_set', { path });
      setNotice('已保存，重启应用后按新目录加载。');
      void refresh();
    } catch (e) {
      setError(getErrorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  const handleReset = async () => {
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      await invoke('config_path_reset');
      setNotice('已恢复默认目录，重启应用后生效。');
      void refresh();
    } catch (e) {
      setError(getErrorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  const sourceLabel = info.usingOverride ? '自定义路径' : '默认目录';

  return (
    <Card
      id="settings-config-path"
      title="配置文件路径"
      description="自定义配置文件（连接、密钥、对话记录、插件等）的存放位置，重启应用后生效。"
    >
      <SettingItem
        id="config-path-current"
        label="当前配置目录"
        description={`来源：${sourceLabel}${info.migrated ? '（本次启动已自动迁移旧目录数据）' : ''}`}
        keywords={['配置', '路径', 'config', '目录', 'storage']}
        sectionId="settings-config-path"
      >
        <div className="min-w-0">
          <code className="block text-xs text-zinc-300 bg-zinc-800/80 border border-zinc-700 rounded px-2 py-1.5 break-all">
            {info.current}
          </code>
          {!info.usingOverride && (
            <div className="text-[11px] text-zinc-500 mt-1.5">
              默认位置：程序安装目录下的 config 文件夹
            </div>
          )}
        </div>
      </SettingItem>

      <SettingItem
        id="config-path-custom"
        label="自定义配置路径"
        description="选择一个目录存放配置；修改后重启应用生效。"
        keywords={['配置', '路径', '自定义', '选择目录', 'browse', 'config dir']}
        sectionId="settings-config-path"
      >
        <div className="space-y-2">
          <div className="flex gap-2">
            <input
              type="text"
              value={draft}
              onChange={(e) => {
                setDraft(e.target.value);
                setError(null);
                setNotice(null);
              }}
              placeholder="输入绝对路径，或点击“浏览…”选择"
              className={`flex-1 min-w-0 text-xs rounded px-2 py-1.5 outline-none ${
                error ? 'bg-red-900/20 border border-red-500/50' : 'bg-zinc-800 border border-zinc-700'
              }`}
              spellCheck={false}
            />
            <Button variant="secondary" size="sm" onClick={handleBrowse}>
              浏览…
            </Button>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="primary" size="sm" onClick={handleSave} loading={saving}>
              保存
            </Button>
            <Button variant="secondary" size="sm" onClick={handleReset} loading={saving}>
              恢复默认
            </Button>
          </div>
          {error && <div className="text-xs text-red-400">{error}</div>}
          {notice && <div className="text-xs text-emerald-400">{notice}</div>}
        </div>
      </SettingItem>
    </Card>
  );
}
