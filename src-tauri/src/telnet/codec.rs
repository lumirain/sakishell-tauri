//! Telnet 协议的最小实现：IAC 解析、选项协商、子协商。
//!
//! 只做「能正常连上并交互」所需的那部分（RFC 854 / 855 / 857 / 1073 / 1091）：
//! - IAC（0xFF）转义：`IAC IAC` 是一个字面 0xFF；
//! - 选项协商 `IAC WILL/WONT/DO/DONT <option>`；
//! - 子协商 `IAC SB <option> ... IAC SE`（TTYPE / NAWS 用）。
//!
//! 解析器是**增量**的：TCP 包边界可能把 `IAC WILL TTYPE` 切成两半，状态机
//! 跨包保留，不会把半个命令当数据吐出去。

/// IAC：命令前缀，同时也是数据里需要转义的字节。
pub const IAC: u8 = 255;
pub const DONT: u8 = 254;
pub const DO: u8 = 253;
pub const WONT: u8 = 252;
pub const WILL: u8 = 251;
pub const SB: u8 = 250;
pub const SE: u8 = 240;

/// 选项：二进制传输（RFC 856）。
pub const OPT_BINARY: u8 = 0;
/// 选项：回显（RFC 857）。
pub const OPT_ECHO: u8 = 1;
/// 选项：抑制 GO AHEAD（RFC 858）。
pub const OPT_SGA: u8 = 3;
/// 选项：终端类型（RFC 1091）。
pub const OPT_TTYPE: u8 = 24;
/// 选项：窗口大小（RFC 1073）。
pub const OPT_NAWS: u8 = 31;

/// TTYPE 子协商命令：客户端回报终端类型。
pub const TTYPE_IS: u8 = 0;
/// TTYPE 子协商命令：服务端要求客户端回报终端类型。
pub const TTYPE_SEND: u8 = 1;

/// 解析器吐出的事件。
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum CodecEvent {
    /// 可以交给终端的可见数据（已去掉协议字节、已反转义）。
    Data(Vec<u8>),
    /// 一次选项协商请求，需要调用方决定回 WILL/WONT/DO/DONT。
    Negotiation { command: u8, option: u8 },
    /// 一段子协商内容（`payload` 已反转义）。
    Subnegotiation { option: u8, payload: Vec<u8> },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum State {
    Data,
    Iac,
    Negotiation(u8),
    SubnegStart,
    Subneg,
    SubnegIac,
}

/// 增量 Telnet 解析器。
#[derive(Debug, Clone)]
pub struct Codec {
    state: State,
    option: u8,
    payload: Vec<u8>,
}

impl Default for Codec {
    fn default() -> Self {
        Self::new()
    }
}

impl Codec {
    pub fn new() -> Self {
        Self {
            state: State::Data,
            option: 0,
            payload: Vec::new(),
        }
    }

    /// 喂一块字节，把解析出的事件追加到 `out`。
    ///
    /// 事件顺序与字节流顺序一致：先攒可见数据，遇到协商 / 子协商时先把已攒的
    /// 数据事件推出去，再推协商事件，避免「同一包里文本与协商的相对顺序」被打乱。
    pub fn feed(&mut self, bytes: &[u8], out: &mut Vec<CodecEvent>) {
        let mut data: Vec<u8> = Vec::new();
        macro_rules! flush_data {
            () => {
                if !data.is_empty() {
                    out.push(CodecEvent::Data(std::mem::take(&mut data)));
                }
            };
        }
        for &byte in bytes {
            match self.state {
                State::Data => {
                    if byte == IAC {
                        self.state = State::Iac;
                    } else {
                        data.push(byte);
                    }
                }
                State::Iac => match byte {
                    IAC => {
                        // 转义的字面 0xFF
                        data.push(IAC);
                        self.state = State::Data;
                    }
                    WILL | WONT | DO | DONT => {
                        self.state = State::Negotiation(byte);
                    }
                    SB => {
                        self.payload.clear();
                        self.state = State::SubnegStart;
                    }
                    _ => {
                        // 单字节命令（NOP / GA / DM 等）直接忽略
                        self.state = State::Data;
                    }
                },
                State::Negotiation(command) => {
                    flush_data!();
                    out.push(CodecEvent::Negotiation {
                        command,
                        option: byte,
                    });
                    self.state = State::Data;
                }
                State::SubnegStart => {
                    self.option = byte;
                    self.payload.clear();
                    self.state = State::Subneg;
                }
                State::Subneg => {
                    if byte == IAC {
                        self.state = State::SubnegIac;
                    } else {
                        self.payload.push(byte);
                    }
                }
                State::SubnegIac => match byte {
                    SE => {
                        flush_data!();
                        if let Some(event) = self.take_subnegotiation() {
                            out.push(event);
                        }
                        self.state = State::Data;
                    }
                    IAC => {
                        self.payload.push(IAC);
                        self.state = State::Subneg;
                    }
                    _ => {
                        // 非法序列：按「IAC 被吞掉」处理，继续收内容
                        self.payload.push(byte);
                        self.state = State::Subneg;
                    }
                },
            }
        }
        if !data.is_empty() {
            out.push(CodecEvent::Data(data));
        }
    }

    /// 只在上一个字节是 `IAC SE` 时才应调用：把当前子协商收成一个事件。
    fn take_subnegotiation(&mut self) -> Option<CodecEvent> {
        if self.option == 0 && self.payload.is_empty() {
            return None;
        }
        let option = self.option;
        let payload = std::mem::take(&mut self.payload);
        Some(CodecEvent::Subnegotiation { option, payload })
    }
}

/// 把一段二进制数据里的 0xFF 转义成 `IAC IAC`，用于 NAWS 载荷。
pub fn escape_iac(payload: &[u8]) -> Vec<u8> {
    let mut out = Vec::with_capacity(payload.len());
    for &byte in payload {
        out.push(byte);
        if byte == IAC {
            out.push(IAC);
        }
    }
    out
}

/// 构造 NAWS 子协商（宽、高各两字节大端，0xFF 需转义）。
pub fn naws(cols: u16, rows: u16) -> Vec<u8> {
    let raw = [
        (cols >> 8) as u8,
        (cols & 0xff) as u8,
        (rows >> 8) as u8,
        (rows & 0xff) as u8,
    ];
    let mut out = vec![IAC, SB, OPT_NAWS];
    out.extend(escape_iac(&raw));
    out.push(IAC);
    out.push(SE);
    out
}

/// 构造选项协商回复 `IAC <command> <option>`。
pub fn negotiation_reply(command: u8, option: u8) -> Vec<u8> {
    vec![IAC, command, option]
}

/// 构造 TTYPE 的 `IS` 回复。
pub fn ttype_is(term: &str) -> Vec<u8> {
    let mut out = vec![IAC, SB, OPT_TTYPE, TTYPE_IS];
    out.extend(escape_iac(term.as_bytes()));
    out.push(IAC);
    out.push(SE);
    out
}

/// 去掉文本里的 ANSI 转义序列（CSI / OSC / 其他 ESC 序列）。
///
/// 只给**命令输出**用（Agent 读的命令结果不该带配色控制符）；交互终端
/// 必须保留原始转义，否则颜色和高亮全丢，所以不要在输出事件路径上调用它。
pub fn strip_ansi(input: &str) -> String {
    let mut out = String::with_capacity(input.len());
    let mut chars = input.chars().peekable();
    while let Some(ch) = chars.next() {
        if ch != '\x1b' {
            out.push(ch);
            continue;
        }
        match chars.peek() {
            // CSI：ESC [ ... 终止字符（0x40..=0x7E）
            Some('[') => {
                chars.next();
                for c in chars.by_ref() {
                    if ('\x40'..='\x7e').contains(&c) {
                        break;
                    }
                }
            }
            // OSC：ESC ] ... BEL 或 ESC \
            Some(']') => {
                chars.next();
                while let Some(c) = chars.next() {
                    if c == '\x07' {
                        break;
                    }
                    if c == '\x1b' {
                        if chars.peek() == Some(&'\\') {
                            chars.next();
                        }
                        break;
                    }
                }
            }
            // 其他两字符序列（ESC ( B、ESC = 等）
            Some(_) => {
                chars.next();
            }
            None => {}
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn plain_data_passes_through() {
        let mut codec = Codec::new();
        let mut out = Vec::new();
        codec.feed(b"hello", &mut out);
        assert_eq!(out, vec![CodecEvent::Data(b"hello".to_vec())]);
    }

    #[test]
    fn escaped_iac_becomes_literal_byte() {
        let mut codec = Codec::new();
        let mut out = Vec::new();
        codec.feed(&[b'a', IAC, IAC, b'b'], &mut out);
        assert_eq!(out, vec![CodecEvent::Data(vec![b'a', IAC, b'b'])]);
    }

    #[test]
    fn negotiation_split_across_packets() {
        let mut codec = Codec::new();
        let mut out = Vec::new();
        // 第一个包只到 WILL，选项字节在第二个包里
        codec.feed(&[IAC, WILL], &mut out);
        assert!(out.is_empty());
        codec.feed(&[OPT_TTYPE], &mut out);
        assert_eq!(
            out,
            vec![CodecEvent::Negotiation {
                command: WILL,
                option: OPT_TTYPE
            }]
        );
    }

    #[test]
    fn subnegotiation_parsed_and_unescaped() {
        let mut codec = Codec::new();
        let mut out = Vec::new();
        codec.feed(
            &[IAC, SB, OPT_TTYPE, TTYPE_SEND, IAC, SE, b'x'],
            &mut out,
        );
        assert_eq!(
            out,
            vec![
                CodecEvent::Subnegotiation {
                    option: OPT_TTYPE,
                    payload: vec![TTYPE_SEND]
                },
                CodecEvent::Data(vec![b'x'])
            ]
        );
    }

    #[test]
    fn naws_escapes_ff_byte() {
        // 255 列 / 255 行：两个维度各有一个 0x00FF 字节
        let payload = naws(255, 255);
        assert_eq!(
            payload,
            vec![
                IAC, SB, OPT_NAWS, 0, IAC, IAC, 0, IAC, IAC, IAC, SE
            ]
        );
    }

    #[test]
    fn strip_ansi_removes_csi_and_osc() {
        let raw = "\x1b[1;31mred\x1b[0m normal \x1b]0;title\x07end";
        assert_eq!(strip_ansi(raw), "red normal end");
    }
}
