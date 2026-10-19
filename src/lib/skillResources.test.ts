import { describe, expect, it } from 'vitest';
import {
  buildResourcePath,
  buildResourceTree,
  listResourceDirs,
  resourceDir,
  removeResourceDir,
  resourceDirExists,
  uniqueResourcePath,
  validateResourcePath,
} from './skillResources';

const r = (path: string) => ({ path, content: '' });

describe('skill resource path helpers', () => {
  it('builds a path from a local file name', () => {
    expect(buildResourcePath('', 'api.md')).toBe('api.md');
    expect(buildResourcePath('references', 'API.MD')).toBe('references/API.md');
    expect(buildResourcePath('references', 'notes.txt')).toBe('references/notes.md');
    expect(buildResourcePath('references', 'guide.markdown')).toBe('references/guide.md');
    expect(buildResourcePath('', '无扩展名')).toBe('无扩展名.md');
  });

  it('drops directories carried by a file name and never yields an invalid path', () => {
    expect(buildResourcePath('docs', 'a\\b\\c.md')).toBe('docs/c.md');
    expect(buildResourcePath('', '.md')).toBe('untitled.md');
    for (const name of ['x.md', '中文 名.txt', '.md', '..md']) {
      expect(validateResourcePath(buildResourcePath('references', name), [])).toBeNull();
    }
  });

  it('refuses a root-level SKILL.md resource but allows it in a subfolder', () => {
    expect(validateResourcePath('SKILL.md', [])).not.toBeNull();
    expect(validateResourcePath('skill.md', [])).not.toBeNull();
    expect(validateResourcePath('references/SKILL.md', [])).toBeNull();
  });

  it('de-duplicates against taken paths', () => {
    expect(uniqueResourcePath('a.md', new Set())).toBe('a.md');
    expect(uniqueResourcePath('a.md', new Set(['a.md']))).toBe('a-2.md');
    expect(uniqueResourcePath('a.md', new Set(['a.md', 'a-2.md']))).toBe('a-3.md');
  });

  it('lists used directories, most used first', () => {
    const list = [r('references/a.md'), r('x.md'), r('guides/b.md'), r('guides/c.md')];
    expect(listResourceDirs(list)).toEqual(['guides', 'references']);
    expect(resourceDir('a/b/c.md')).toBe('a/b');
    expect(resourceDir('c.md')).toBe('');
  });
});

describe('buildResourceTree', () => {
  const list = [
    { path: 'references/b.md', content: '' },
    { path: 'guide.md', content: '' },
    { path: 'references/a.md', content: '' },
    { path: 'references/deep/c.md', content: '' },
  ];

  it('nests files under directories, dirs first then files, sorted', () => {
    const tree = buildResourceTree(list);
    expect(tree.fileCount).toBe(4);
    expect(tree.children.map((c) => `${c.kind}:${c.name}`)).toEqual(['dir:references', 'file:guide.md']);
    const refs = tree.children[0];
    if (refs.kind !== 'dir') throw new Error('expected dir');
    expect(refs.fileCount).toBe(3);
    expect(refs.children.map((c) => c.name)).toEqual(['deep', 'a.md', 'b.md']);
  });

  it('keeps the index of each file in the original array', () => {
    const tree = buildResourceTree(list);
    const refs = tree.children[0];
    if (refs.kind !== 'dir') throw new Error('expected dir');
    const b = refs.children.find((c) => c.name === 'b.md');
    expect(b && b.kind === 'file' && b.index).toBe(0);
  });

  it('shows empty extra dirs and can tell which dirs exist', () => {
    const tree = buildResourceTree(list, ['notes/sub']);
    expect(resourceDirExists(tree, 'notes/sub')).toBe(true);
    expect(resourceDirExists(tree, 'notes')).toBe(true);
    expect(resourceDirExists(tree, 'missing')).toBe(false);
    expect(resourceDirExists(tree, '')).toBe(true);
    expect(tree.fileCount).toBe(4);
  });
});

describe('removeResourceDir', () => {
  it('removes a folder with its subfolders but not look-alike siblings', () => {
    const list = [
      { path: 'references/a.md', content: '' },
      { path: 'references/deep/b.md', content: '' },
      { path: 'references-old/c.md', content: '' },
      { path: 'guide.md', content: '' },
    ];
    expect(removeResourceDir(list, 'references').map((r) => r.path)).toEqual([
      'references-old/c.md',
      'guide.md',
    ]);
    expect(removeResourceDir(list, 'missing')).toHaveLength(4);
  });
});
