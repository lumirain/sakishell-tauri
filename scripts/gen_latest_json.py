#!/usr/bin/env python3
"""按已发布的 Release 资产生成 latest.json（更新源）。

用法：python3 scripts/gen_latest_json.py <版本号> <签名目录>
签名目录里需要有每个安装包对应的 `<资产名>.sig`。
所有 sha256 / 体积都取自 Release 资产本身，不手抄。
"""
import json
import pathlib
import subprocess
import sys

REPO = "lumirain/sakishell-tauri"

ver = sys.argv[1] if len(sys.argv) > 1 else "1.0.20"
sigdir = pathlib.Path(sys.argv[2] if len(sys.argv) > 2 else "/tmp/sig2")

base = f"https://github.com/{REPO}/releases/download/v{ver}"
rel = f"https://github.com/{REPO}/releases/tag/v{ver}"

raw = subprocess.check_output(
    [
        "gh", "api", f"repos/{REPO}/releases/tags/v{ver}",
        "--jq", '.assets[] | "\\(.name)\\t\\(.size)\\t\\(.digest)"',
    ],
    text=True,
)

meta = {}
for line in raw.splitlines():
    if not line.strip():
        continue
    name, size, digest = line.split("\t")
    meta[name] = (int(size), digest.split(":", 1)[1])


def platform(asset: str) -> dict:
    size, sha = meta[asset]
    return {
        "installer_url": f"{base}/{asset}",
        "installer_mirrors": [],
        "signature": (sigdir / f"{asset}.sig").read_text().strip(),
        "sha256": sha,
        "size": size,
    }


x64_exe = f"SakiShell_{ver}_x64-setup.exe"
data = {
    "version": ver,
    "release_url": rel,
    "installer_url": f"{base}/{x64_exe}",
    "installer_mirrors": [],
    "signature": (sigdir / f"{x64_exe}.sig").read_text().strip(),
    "sha256": meta[x64_exe][1],
    "size": meta[x64_exe][0],
    "android": {
        "version": ver,
        "release_url": rel,
        "installer_url": "",
        "installer_mirrors": [],
        "sha256": "",
        "size": 0,
    },
    "platforms": {
        "windows-x86_64": platform(f"SakiShell_{ver}_x64-setup.exe"),
        "windows-aarch64": platform(f"SakiShell_{ver}_arm64-setup.exe"),
        "darwin-x86_64": platform(f"SakiShell_{ver}_x64.dmg"),
        "darwin-aarch64": platform(f"SakiShell_{ver}_aarch64.dmg"),
    },
}

pathlib.Path("latest.json").write_text(
    json.dumps(data, indent=2, ensure_ascii=False) + "\n"
)
print(f"latest.json 已写入：{ver}")
for name, item in data["platforms"].items():
    print(f"  {name:18} size={item['size']:>9} sha256={item['sha256'][:16]}")
