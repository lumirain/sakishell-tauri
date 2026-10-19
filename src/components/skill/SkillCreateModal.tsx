import { useRef, useState, useCallback } from 'react';
import Modal from '@/components/ui/Modal';
import SkillFormFields from './SkillFormFields';
import * as tauri from '@/lib/tauri';
import type { DiscoveredSkill, ParsedSkill, SkillResource } from '@/lib/types';
import { useSkillStore } from '@/stores/skillStore';
import { getErrorMessage } from '@/lib/errors';
import { useFileDrop } from '@/hooks/useFileDrop';
import { isCancelledError, useSkillImportProgress } from '@/hooks/useSkillImportProgress';
import SkillImportProgressBar from './SkillImportProgressBar';
import GithubImportGuide, { GithubImportGuideButton } from './GithubImportGuide';

interface Props {
  open: boolean;
  onClose: () => void;
}

/** 地址里带 tree/blob 段 = 已指向具体目录/文件，直接拉取，不必先发现。 */
function hasExplicitPath(url: string): boolean {
  return /\/(tree|blob)\//.test(url);
}

export default function SkillCreateModal({ open, onClose }: Props) {
  const addSkill = useSkillStore((s) => s.addSkill);
  const fetchSkills = useSkillStore((s) => s.fetchSkills);
  const discoverFromUrl = useSkillStore((s) => s.discoverFromUrl);
  const importFromUrl = useSkillStore((s) => s.importFromUrl);

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [prompt, setPrompt] = useState('');
  const [resources, setResources] = useState<SkillResource[]>([]);
  const [importError, setImportError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // GitHub 导入
  const [ghUrl, setGhUrl] = useState('');
  const [ghBusy, setGhBusy] = useState(false);
  const imp = useSkillImportProgress();
  const [guideOpen, setGuideOpen] = useState(false);
  const [ghStatus, setGhStatus] = useState<string | null>(null);
  const [found, setFound] = useState<{ repo: string; skills: DiscoveredSkill[] } | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const fileInputRef = useRef<HTMLInputElement>(null);

  const valid = name.trim().length > 0 && prompt.trim().length > 0;

  const reset = () => {
    setName('');
    setDescription('');
    setPrompt('');
    setResources([]);
    setImportError(null);
    setGhUrl('');
    setGhStatus(null);
    setFound(null);
    setSelected(new Set());
    setGuideOpen(false);
  };

  const handleClose = () => {
    if (imp.active) imp.cancel();
    reset();
    onClose();
  };

  /** 把解析结果填进表单（预览后由用户确认保存）。 */
  const fillForm = (parsed: ParsedSkill) => {
    setName(parsed.name);
    setDescription(parsed.description);
    setPrompt(parsed.prompt);
    setResources(parsed.resources ?? []);
  };

  // ── 本地文件导入 ──

  const handleFilePath = useCallback(async (filePath: string) => {
    setImportError(null);
    try {
      const { readFile } = await import('@tauri-apps/plugin-fs');
      const content = await readFile(filePath);
      const base64 = btoa(String.fromCharCode(...content));
      const fileName = filePath.split(/[/\\]/).pop() || 'file';
      const parsed: ParsedSkill = await tauri.importSkillFile(base64, fileName);
      fillForm(parsed);
    } catch (err) {
      setImportError(getErrorMessage(err));
    }
  }, []);

  const handleFile = async (file: File) => {
    setImportError(null);
    try {
      const buffer = await file.arrayBuffer();
      const bytes = Array.from(new Uint8Array(buffer));
      const base64 = btoa(String.fromCharCode(...bytes));
      const parsed: ParsedSkill = await tauri.importSkillFile(base64, file.name);
      fillForm(parsed);
    } catch (err) {
      setImportError(getErrorMessage(err));
    }
  };

  const handleFileDrop = useCallback((paths: string[]) => {
    if (paths.length > 0) {
      handleFilePath(paths[0]);
    }
  }, [handleFilePath]);

  const { isDragging } = useFileDrop(handleFileDrop, open);

  const onFilesSelected = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  // ── GitHub 导入 ──

  const handleFetchFromUrl = async () => {
    const url = ghUrl.trim();
    if (!url) return;
    setImportError(null);
    setFound(null);
    setSelected(new Set());
    setGhBusy(true);
    setGhStatus('正在从 GitHub 拉取…');
    const importId = imp.begin();
    try {
      if (hasExplicitPath(url)) {
        // 地址已指向具体目录/文件：直接拉取并预览
        const parsed = await importFromUrl(url, undefined, importId);
        fillForm(parsed);
        setGhStatus(`已拉取「${parsed.name}」`);
        return;
      }
      // 仓库根：先发现有哪些 skill
      const discovery = await discoverFromUrl(url, importId);
      if (discovery.skills.length === 1) {
        const parsed = await importFromUrl(url, discovery.skills[0].subpath, importId);
        fillForm(parsed);
        setGhStatus(`已拉取「${parsed.name}」`);
        return;
      }
      setFound(discovery);
      setSelected(new Set(discovery.skills.map((s) => s.subpath)));
      setGhStatus(`在 ${discovery.repo} 发现 ${discovery.skills.length} 个 skill`);
    } catch (err) {
      if (isCancelledError(err)) {
        setGhStatus('已取消');
      } else {
        setImportError(getErrorMessage(err));
        setGhStatus(null);
      }
    } finally {
      imp.end();
      setGhBusy(false);
    }
  };

  const toggleSelected = (subpath: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(subpath)) next.delete(subpath);
      else next.add(subpath);
      return next;
    });
  };

  /** 批量导入：逐个拉取并直接保存（无预览，结果用一行汇总）。 */
  const handleImportSelected = async () => {
    if (!found || selected.size === 0) return;
    const targets = found.skills.filter((s) => selected.has(s.subpath));
    setImportError(null);
    setGhBusy(true);
    let ok = 0;
    const failed: string[] = [];
    const importId = imp.begin();
    for (let i = 0; i < targets.length; i++) {
      if (imp.isCancelled()) break;
      const t = targets[i];
      setGhStatus(`正在导入 ${i + 1}/${targets.length}：${t.name}…`);
      try {
        const parsed = await importFromUrl(ghUrl.trim(), t.subpath, importId);
        await addSkill(
          parsed.name,
          parsed.description,
          parsed.prompt,
          parsed.resources ?? [],
        );
        ok++;
      } catch (err) {
        if (isCancelledError(err)) break;
        failed.push(`${t.name}（${getErrorMessage(err)}）`);
      }
    }
    const cancelled = imp.isCancelled();
    imp.end();
    setGhBusy(false);
    if (cancelled) {
      setGhStatus(`已取消（已导入 ${ok} 个）`);
      if (failed.length > 0) setImportError(`失败 ${failed.length} 个：\n${failed.join('\n')}`);
    } else if (failed.length > 0) {
      setImportError(`导入完成：成功 ${ok} 个，失败 ${failed.length} 个：\n${failed.join('\n')}`);
      setGhStatus(null);
    } else {
      handleClose();
    }
  };

  // ── 保存 ──

  const handleConfirm = async () => {
    if (!valid) return;
    setSaving(true);
    try {
      await addSkill(name.trim(), description.trim(), prompt.trim(), resources);
      await fetchSkills();
      handleClose();
    } catch (err) {
      setImportError(getErrorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open={open} onClose={handleClose} title='创建 Skill'>
      <div className='px-4 pb-4 space-y-4'>
        {/* Upload zone */}
        <div
          onClick={() => fileInputRef.current?.click()}
          className={
            'rounded-xl border-2 border-dashed cursor-pointer select-none transition-colors p-5 flex flex-col items-center gap-1.5 ' +
            (isDragging
              ? 'border-indigo-400 bg-indigo-950/30'
              : 'border-zinc-600 hover:border-zinc-500 hover:bg-zinc-700/40')
          }
        >
          <svg className='w-7 h-7 text-zinc-500' fill='none' stroke='currentColor' viewBox='0 0 24 24'>
            <path strokeLinecap='round' strokeLinejoin='round' strokeWidth={1.5}
              d='M9 13h6m-3-3v6m5 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z' />
          </svg>
          <span className='text-sm text-zinc-300 font-medium'>
            {isDragging ? '松手导入 skill' : '上传进行智能解析'}
          </span>
          <span className='text-xs text-zinc-500 text-center leading-relaxed'>
            支持 .md 文件或 .zip / .skill 压缩包<br />
            多文件 skill 需包含 SKILL.md 作为入口
          </span>
          <input
            ref={fileInputRef}
            type='file'
            accept='.md,.zip,.skill'
            onChange={onFilesSelected}
            className='hidden'
          />
        </div>

        {/* GitHub import */}
        <div className='rounded-xl border border-zinc-700 bg-zinc-900/40 p-3 space-y-2'>
          <div className='flex items-center justify-between'>
            <div className='text-xs text-zinc-400'>或从 GitHub 导入（仓库 / 目录 / 文件地址）</div>
            <GithubImportGuideButton open={guideOpen} onToggle={() => setGuideOpen((v) => !v)} />
          </div>
          {guideOpen && <GithubImportGuide />}
          <div className='flex gap-2'>
            <input
              type='text'
              value={ghUrl}
              onChange={(e) => setGhUrl(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !ghBusy) void handleFetchFromUrl();
              }}
              placeholder='https://github.com/owner/repo[/tree/main/skills]'
              disabled={ghBusy}
              className='flex-1 rounded-lg bg-zinc-900 border border-zinc-700 px-3 py-2 text-xs text-zinc-100 placeholder-zinc-600 focus:outline-none focus:border-indigo-500'
            />
            <button
              onClick={() => void handleFetchFromUrl()}
              disabled={ghBusy || !ghUrl.trim()}
              className='flex-shrink-0 rounded-lg bg-zinc-700 px-3 py-2 text-xs text-zinc-200 hover:bg-zinc-600 disabled:opacity-40 disabled:cursor-not-allowed transition-colors'
            >
              {ghBusy ? '拉取中…' : '拉取'}
            </button>
          </div>

          {ghStatus && <div className='text-xs text-zinc-500'>{ghStatus}</div>}
          {imp.active && <SkillImportProgressBar progress={imp.progress} onCancel={imp.cancel} />}

          {found && (
            <div className='space-y-1.5'>
              <div className='max-h-56 overflow-y-auto space-y-1'>
                {found.skills.map((s) => (
                  <label
                    key={s.subpath}
                    className='flex items-start gap-2 rounded-lg px-2 py-1.5 hover:bg-zinc-800/60 cursor-pointer'
                  >
                    <input
                      type='checkbox'
                      checked={selected.has(s.subpath)}
                      onChange={() => toggleSelected(s.subpath)}
                      className='mt-0.5 accent-indigo-500'
                    />
                    <span className='min-w-0 flex-1'>
                      <span className='block text-xs text-zinc-200 truncate'>{s.name}</span>
                      <span className='block text-[11px] text-zinc-500 truncate'>
                        {s.subpath}
                        {s.resourceCount > 0 ? ` · ${s.resourceCount} 个资源文件` : ''}
                      </span>
                    </span>
                  </label>
                ))}
              </div>
              <button
                onClick={() => void handleImportSelected()}
                disabled={ghBusy || selected.size === 0}
                className='w-full rounded-lg bg-indigo-600 px-3 py-2 text-xs text-white hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed transition-colors'
              >
                导入选中（{selected.size}）
              </button>
            </div>
          )}
        </div>

        {/* Error banner */}
        {importError && (
          <div className='rounded-lg bg-red-500/10 border border-red-500/30 px-3 py-2 text-xs text-red-400 whitespace-pre-wrap break-words'>
            {importError}
          </div>
        )}

        {/* Divider */}
        <div className='relative'>
          <div className='absolute inset-0 flex items-center'>
            <div className='w-full border-t border-zinc-700' />
          </div>
          <div className='relative flex justify-center text-xs'>
            <span className='bg-zinc-800 px-2 text-zinc-500'>或手动填写</span>
          </div>
        </div>

        {/* Form */}
        <SkillFormFields
          name={name}
          description={description}
          prompt={prompt}
          resources={resources}
          onResourcesChange={setResources}
          onNameChange={setName}
          onDescriptionChange={setDescription}
          onPromptChange={setPrompt}
        />

        {/* Actions */}
        <div className='flex justify-end gap-2 pt-2'>
          <button
            onClick={handleClose}
            className='px-4 py-1.5 text-sm rounded-lg bg-zinc-700 text-zinc-200 hover:bg-zinc-600 transition-colors'
          >
            取消
          </button>
          <button
            onClick={handleConfirm}
            disabled={!valid || saving}
            className='px-4 py-1.5 text-sm rounded-lg bg-indigo-600 text-white hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed transition-colors'
          >
            {saving ? '保存中...' : '确认'}
          </button>
        </div>
      </div>
    </Modal>
  );
}
