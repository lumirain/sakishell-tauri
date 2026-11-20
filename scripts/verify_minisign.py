#!/usr/bin/env python3
"""校验 Tauri/minisign 签名，只依赖 cryptography。

用法：python3 scripts/verify_minisign.py <安装包> <安装包.sig> <公钥行>

二进制布局（两者都是 base64 文本）：
  公钥 42 字节 = "Ed" + 8 字节 keynum + 32 字节 Ed25519 公钥
  签名 74 字节 = "ED"/"Ed" + 8 字节 keynum + 64 字节签名
minisign 的 prehashed 模式对 BLAKE2b-512(文件) 签名，Tauri 默认用它；
这里两种都试一遍，任一通过即算通过。
"""
import base64
import pathlib
import sys

from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey


def verify(file_path: str, sig_path: str, pubkey_line: str) -> bool:
    text = base64.b64decode(pathlib.Path(sig_path).read_bytes()).decode()
    sig_line = [line for line in text.splitlines() if line.strip()][1].strip()
    raw = base64.b64decode(sig_line)

    if len(raw) != 74:
        raise ValueError(f"签名长度异常: {len(raw)}")
    sig = raw[10:74]

    pub_raw = base64.b64decode(pubkey_line.strip())
    if len(pub_raw) != 42:
        raise ValueError(f"公钥长度异常: {len(pub_raw)}")
    pub = Ed25519PublicKey.from_public_bytes(pub_raw[10:42])

    content = open(file_path, "rb").read()
    digest = hashes.Hash(hashes.BLAKE2b(64))
    digest.update(content)
    prehashed = digest.finalize()

    for label, message in (("prehashed", prehashed), ("raw", content)):
        try:
            pub.verify(sig, message)
            print(f"签名校验通过（{label}）")
            return True
        except InvalidSignature:
            continue
    return False


if __name__ == "__main__":
    ok = verify(sys.argv[1], sys.argv[2], sys.argv[3])
    if not ok:
        print("签名校验失败：内置公钥与签名私钥不匹配")
    sys.exit(0 if ok else 1)
