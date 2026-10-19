//! 跨读取块的 UTF-8 解码器（**字节流 → 文本的唯一来源**）。
//!
//! 一次 `read` / 一个 SSH 数据包可能恰好把一个多字节字符切成两半（大块输出 /
//! 包边界）。两边各自 `from_utf8_lossy` 就都解成 U+FFFD，中文输出中间冒出
//! 「�」：纯中文文本在每个包边界上有约 2/3 的概率切到汉字。
//!
//! 这里把末尾那段「合法的、还没读完的前缀」（最多 3 字节）留到下一块一起解。
//! 用到它的地方：交互终端（`ssh/session.rs`）、远端命令通道（`command_exec/
//! executor.rs`）、本机命令管道（`command_exec/local_transport.rs`）。新增任何
//! 「把字节流逐块转成文本」的路径都应经过它，不要再直接对单个 chunk 调
//! `from_utf8_lossy`。
//!
//! **每个流各持一份**：stdout 与 stderr 是两股独立字节流，交错时共用会把
//! stdout 的半截序列粘到 stderr 的开头上。
//!
//! 真·非法字节（不是合法前缀的残缺）不跨块保留，直接交给
//! `String::from_utf8_lossy`——与逐 chunk 解码时对非法字节的处理一致。

use std::borrow::Cow;

#[derive(Default)]
pub(crate) struct Utf8Carry {
    pending: Vec<u8>,
}

impl Utf8Carry {
    /// 解码一块字节，返回本次可以交付的文本（可能为空）。
    ///
    /// 常见情形（上一块没有遗留、整块是合法 UTF-8）零拷贝直接借用 `bytes`，
    /// 终端高吞吐输出时不为解码多分配一份。
    pub(crate) fn decode<'a>(&mut self, bytes: &'a [u8]) -> Cow<'a, str> {
        if self.pending.is_empty() {
            if let Ok(text) = std::str::from_utf8(bytes) {
                return Cow::Borrowed(text);
            }
            let keep = incomplete_tail_len(bytes);
            let split = bytes.len() - keep;
            self.pending.extend_from_slice(&bytes[split..]);
            return String::from_utf8_lossy(&bytes[..split]);
        }

        let mut buf = std::mem::take(&mut self.pending);
        buf.extend_from_slice(bytes);
        let split = buf.len() - incomplete_tail_len(&buf);
        self.pending.extend_from_slice(&buf[split..]);
        Cow::Owned(String::from_utf8_lossy(&buf[..split]).into_owned())
    }

    /// 流结束时取走尾巴：此刻留着的就是真·残缺数据，按 lossy 交付，不吞掉。
    pub(crate) fn flush(&mut self) -> String {
        String::from_utf8_lossy(&std::mem::take(&mut self.pending)).into_owned()
    }
}

/// `bytes` 末尾那段「合法的、还没写完的 UTF-8 前缀」的字节数（0..=3）。
///
/// 只看最后 3 个字节：一个合法序列最长 4 字节，缺的至少 1 字节，所以残缺前缀
/// 至多 3 字节。判据是标准库自己的：从该位置起整段既没有任何合法字符
/// （`valid_up_to == 0`）、又不是确定非法（`error_len == None`，即「只是
/// 不够长」）。落在中间的非法字节不会被当成尾巴。
fn incomplete_tail_len(bytes: &[u8]) -> usize {
    let len = bytes.len();
    for keep in 1..=3.min(len) {
        if let Err(error) = std::str::from_utf8(&bytes[len - keep..]) {
            if error.valid_up_to() == 0 && error.error_len().is_none() {
                return keep;
            }
        }
    }
    0
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn decode_carries_multibyte_chars_split_across_reads() {
        let mut carry = Utf8Carry::default();
        let mut decoded = String::new();
        // 逐字节喂：每一块都是「还没读完的合法前缀」，只有补全后才解得出字符。
        for byte in "你好a".as_bytes() {
            decoded.push_str(&carry.decode(&[*byte]));
        }
        decoded.push_str(&carry.flush());
        assert_eq!(decoded, "你好a");
        assert!(!decoded.contains('\u{fffd}'));
    }

    #[test]
    fn decode_treats_invalid_bytes_as_lossy_without_carrying_them() {
        let mut carry = Utf8Carry::default();
        assert_eq!(carry.decode(b"a\xffb"), "a\u{fffd}b");
        // 真·非法字节不跨块保留（否则会把后面的内容一起粘成乱码）。
        assert_eq!(carry.flush(), "");
    }

    /// 「尾巴不吞」这条保证的纯函数版本。
    #[test]
    fn a_partial_multibyte_tail_survives_flush() {
        let mut carry = Utf8Carry::default();
        // 「你」的前两字节：合法前缀，暂不交付。
        assert_eq!(carry.decode(&[0xE4, 0xBD]), "");
        // 流结束时必须把残缺尾巴按 lossy 交出来，而不是吞掉。
        assert_eq!(carry.flush(), "\u{fffd}");
        // flush 之后 carry 清空，不会把尾巴带到下一次解码。
        assert_eq!(carry.flush(), "");

        // 完整字符照常直通，不受 carry 影响。
        let mut carry = Utf8Carry::default();
        assert_eq!(carry.decode("你".as_bytes()), "你");
        assert_eq!(carry.flush(), "");
    }

    #[test]
    fn valid_chunks_are_borrowed_not_copied() {
        let mut carry = Utf8Carry::default();
        assert!(matches!(carry.decode(b"plain ascii"), Cow::Borrowed(_)));
        assert!(matches!(
            carry.decode("完整的中文".as_bytes()),
            Cow::Borrowed(_)
        ));
    }

    /// 不管包怎么切，拼起来必须和一次性解码完全相同——覆盖 1/2/3/4 字节字符。
    #[test]
    fn every_two_way_split_reassembles_exactly() {
        let text = "ab你好🙂c é 日本語\n🎉x";
        let bytes = text.as_bytes();
        for first in 0..=bytes.len() {
            for second in first..=bytes.len() {
                let mut carry = Utf8Carry::default();
                let mut decoded = String::new();
                for part in [&bytes[..first], &bytes[first..second], &bytes[second..]] {
                    decoded.push_str(&carry.decode(part));
                }
                decoded.push_str(&carry.flush());
                assert_eq!(decoded, text, "切点 {first}/{second}");
            }
        }
    }

    #[test]
    fn four_byte_char_is_held_until_complete() {
        let mut carry = Utf8Carry::default();
        let rocket = "🚀".as_bytes();
        assert_eq!(carry.decode(&rocket[..3]), "");
        assert_eq!(carry.decode(&rocket[3..]), "🚀");
        assert_eq!(carry.flush(), "");
    }

    /// 中间有真·非法字节、末尾又是残缺前缀：非法的按 lossy 立即交付，残缺前缀
    /// 仍然留到下一块（不能因为块里有一个坏字节就把末尾的好前缀也打成 U+FFFD）。
    #[test]
    fn invalid_byte_in_the_middle_does_not_spoil_a_valid_tail() {
        let mut carry = Utf8Carry::default();
        let you = "你".as_bytes();
        let mut first = b"a\xffb".to_vec();
        first.extend_from_slice(&you[..2]);
        assert_eq!(carry.decode(&first), "a\u{fffd}b");
        assert_eq!(carry.decode(&you[2..]), "你");
        assert_eq!(carry.flush(), "");
    }

    /// 遗留的半截前缀后面接上的不是后续字节：遗留部分按非法处理，新内容照常交付。
    #[test]
    fn a_dangling_prefix_followed_by_ascii_is_lossy_then_normal() {
        let mut carry = Utf8Carry::default();
        assert_eq!(carry.decode(&"你".as_bytes()[..2]), "");
        assert_eq!(carry.decode(b"ok"), "\u{fffd}ok");
        assert_eq!(carry.flush(), "");
    }

    #[test]
    fn an_empty_chunk_keeps_the_pending_prefix() {
        let mut carry = Utf8Carry::default();
        let you = "你".as_bytes();
        assert_eq!(carry.decode(&you[..1]), "");
        assert_eq!(carry.decode(&[]), "");
        assert_eq!(carry.decode(&you[1..]), "你");
    }

    /// 两个流各持一份：stdout 的半截序列不能粘到 stderr 的开头。
    #[test]
    fn independent_carries_do_not_leak_into_each_other() {
        let mut stdout = Utf8Carry::default();
        let mut stderr = Utf8Carry::default();
        let you = "你".as_bytes();
        assert_eq!(stdout.decode(&you[..2]), "");
        assert_eq!(stderr.decode(b"warn"), "warn");
        assert_eq!(stdout.decode(&you[2..]), "你");
    }
}
