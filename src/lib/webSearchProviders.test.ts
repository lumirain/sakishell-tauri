import { describe, expect, it } from 'vitest';
import {
  CUSTOM_FETCH_DESCRIPTION,
  CUSTOM_FETCH_KEY_DESCRIPTION,
  CUSTOM_FETCH_PRIVATE_DESCRIPTION,
  CUSTOM_KEY_DESCRIPTION,
  DEEPSEEK_FETCH_DESCRIPTION,
  DEEPSEEK_KEY_DESCRIPTION,
  FETCH_API_PROTOCOLS,
  SEARCH_API_PROTOCOLS,
  TAVILY_FETCH_DESCRIPTION,
  TAVILY_FETCH_KEY_DESCRIPTION,
  WEB_SEARCH_API_PROVIDERS,
  checkCustomEndpointUrl,
  searchKeyDescription,
} from './webSearchProviders';

describe('WEB_SEARCH_API_PROVIDERS', () => {
  it('lists every backend provider once, using the wire names the Rust enum serializes to', () => {
    expect(WEB_SEARCH_API_PROVIDERS.map((p) => p.value)).toEqual([
      'brave',
      'tavily',
      'deepseek',
      'custom',
    ]);
  });
});

describe('SEARCH_API_PROTOCOLS', () => {
  it('offers exactly the protocols the backend can speak, with a hint to tell them apart', () => {
    expect(SEARCH_API_PROTOCOLS.map((p) => p.value)).toEqual(['brave', 'tavily', 'deepseek']);
    for (const p of SEARCH_API_PROTOCOLS) expect(p.hint.length).toBeGreaterThan(10);
  });
});

describe('searchKeyDescription', () => {
  it('warns Brave/Tavily users that the key is shared, so a stale key after switching is not a mystery', () => {
    for (const provider of ['brave', 'tavily'] as const) {
      expect(searchKeyDescription(provider)).toContain('切换后请重新填写');
    }
  });

  it('tells DeepSeek users which key to use, that it is shared with fetch, and that it is billed', () => {
    const text = searchKeyDescription('deepseek');
    expect(text).toBe(DEEPSEEK_KEY_DESCRIPTION);
    expect(text).toContain('DeepSeek 开放平台');
    expect(text).toContain('网页获取共用');
    expect(text).toContain('计费');
    // DeepSeek has its own slot: the "re-enter after switching" warning would be wrong.
    expect(text).not.toContain('切换后请重新填写');
  });

  it('tells custom users the key is optional and never mixed with the vendor keys', () => {
    const text = searchKeyDescription('custom');
    expect(text).toBe(CUSTOM_KEY_DESCRIPTION);
    expect(text).toContain('可留空');
    expect(text).toContain('只会发给你填的这个地址');
    expect(text).not.toContain('切换后请重新填写');
  });
});

describe('DEEPSEEK_FETCH_DESCRIPTION', () => {
  it('states where the page goes, what it needs, and the local-only exception', () => {
    expect(DEEPSEEK_FETCH_DESCRIPTION).toContain('DeepSeek 服务器');
    expect(DEEPSEEK_FETCH_DESCRIPTION).toContain('API Key');
    expect(DEEPSEEK_FETCH_DESCRIPTION).toContain('计费');
    expect(DEEPSEEK_FETCH_DESCRIPTION).toContain('内网');
  });
});

describe('checkCustomEndpointUrl', () => {
  it('treats an empty field as "not filled in yet", not as an error', () => {
    expect(checkCustomEndpointUrl('')).toEqual({ ok: false });
    expect(checkCustomEndpointUrl('   ')).toEqual({ ok: false });
  });

  it('accepts http(s) addresses with a host', () => {
    expect(checkCustomEndpointUrl('https://search.example.com/v1/search')).toEqual({ ok: true });
    expect(checkCustomEndpointUrl('  https://search.example.com  ').ok).toBe(true);
  });

  it('rejects non-http schemes, bare words and credentials embedded in the URL', () => {
    for (const bad of ['ftp://example.com', 'file:///etc/passwd', 'javascript:alert(1)']) {
      const r = checkCustomEndpointUrl(bad);
      expect(r.ok, bad).toBe(false);
      expect(r.error, bad).toBeTruthy();
    }
    expect(checkCustomEndpointUrl('search.example.com').error).toContain('格式');
    // settings.json is plaintext; secrets belong in the keychain.
    const cred = checkCustomEndpointUrl('https://user:pass@example.com/search');
    expect(cred.ok).toBe(false);
    expect(cred.error).toContain('API Key');
  });

  it('warns about cleartext http to the public internet but not to local or LAN hosts', () => {
    const pub = checkCustomEndpointUrl('http://search.example.com/q');
    expect(pub.ok).toBe(true);
    expect(pub.warning).toContain('明文 http');

    for (const local of [
      'http://localhost:8080/search',
      'http://127.0.0.1:8888/',
      'http://192.168.1.20/search',
      'http://10.0.0.5/search',
      'http://172.16.3.4/search',
      'http://[::1]:8080/',
      'http://nas.local/search',
    ]) {
      expect(checkCustomEndpointUrl(local), local).toEqual({ ok: true });
    }
    // 172.32.x is public, not RFC1918.
    expect(checkCustomEndpointUrl('http://172.32.0.1/').warning).toBeTruthy();
  });
});

describe('custom fetch copy', () => {
  it('says where URLs go, that a protocol must be picked, and that failure degrades locally', () => {
    expect(CUSTOM_FETCH_DESCRIPTION).toContain('网址会发给这个服务');
    expect(CUSTOM_FETCH_DESCRIPTION).toContain('兼容哪家');
    expect(CUSTOM_FETCH_DESCRIPTION).toContain('降级');
  });

  it('offers exactly the wire formats the backend can speak, each described by its payload shape', () => {
    expect(FETCH_API_PROTOCOLS.map((p) => p.value)).toEqual(['deepseek', 'tavily']);
    const hints = Object.fromEntries(FETCH_API_PROTOCOLS.map((p) => [p.value, p.hint]));
    expect(hints.deepseek).toContain('content');
    expect(hints.tavily).toContain('raw_content');
    expect(hints.tavily).toContain('failed_results');
  });

  it('states where Tavily fetch sends pages, and why the shared Brave key is never borrowed', () => {
    expect(TAVILY_FETCH_DESCRIPTION).toContain('Tavily 服务器');
    expect(TAVILY_FETCH_DESCRIPTION).toContain('计费');
    expect(TAVILY_FETCH_DESCRIPTION).toContain('内网');
    expect(TAVILY_FETCH_KEY_DESCRIPTION).toContain('留空');
    expect(TAVILY_FETCH_KEY_DESCRIPTION).toContain('不会把 Brave 的 Key 发给 Tavily');
  });

  it('keeps the key optional and isolated, and the private-address opt-in off by default', () => {
    expect(CUSTOM_FETCH_KEY_DESCRIPTION).toContain('可留空');
    expect(CUSTOM_FETCH_KEY_DESCRIPTION).toContain('只会发给你填的这个地址');
    expect(CUSTOM_FETCH_PRIVATE_DESCRIPTION).toContain('默认关闭');
    expect(CUSTOM_FETCH_PRIVATE_DESCRIPTION).toContain('带账号密码的网址无论如何都不会发出');
  });
});
