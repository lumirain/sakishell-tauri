import type { FetchApiProtocol, SearchApiProtocol, WebSearchApiProvider } from './types';

/**
 * 「搜索 API」模式可选的提供商——桌面设置页与移动端设置页共用这一份，
 * 新增提供商只改这里（以及后端 `WebSearchApiProvider` 枚举，线上取值须一致；
 * 它用哪个 Key 槽位见 `toolApiKeys.searchProviderKeySlot`）。
 */
export const WEB_SEARCH_API_PROVIDERS: readonly { value: WebSearchApiProvider; label: string }[] = [
  { value: 'brave', label: 'Brave Search' },
  { value: 'tavily', label: 'Tavily' },
  { value: 'deepseek', label: 'DeepSeek 搜索' },
  { value: 'custom', label: '自定义' },
];

/**
 * 「自定义」提供商可选的兼容协议——也就是你的服务**长得像谁家的接口**。
 * `hint` 写清请求/响应形状，让人能对照自己的服务判断选哪个。线上取值与后端 `SearchApiProtocol` 一致。
 */
export const SEARCH_API_PROTOCOLS: readonly {
  value: SearchApiProtocol;
  label: string;
  hint: string;
}[] = [
  {
    value: 'brave',
    label: 'Brave 格式',
    hint: 'GET 请求，查询参数 q、count；Key 放在 X-Subscription-Token 头；结果在 web.results[]。适合 SearXNG 等自建网关的 Brave 兼容层。',
  },
  {
    value: 'tavily',
    label: 'Tavily 格式',
    hint: 'POST JSON：query、max_results（有 Key 时另带 api_key）；结果在 results[]（title / url / content）。',
  },
  {
    value: 'deepseek',
    label: 'DeepSeek 格式',
    hint: 'POST JSON：query、count；Key 以 Bearer 方式放在 Authorization 头；结果在 results[]（带发布日期）。',
  },
];

/** 自定义搜索 API 的 Key 说明：可留空，且与其它提供商的 Key 完全隔离。 */
export const CUSTOM_KEY_DESCRIPTION =
  '可留空（自建服务常常不鉴权）。加密保存在本设备，只会发给你填的这个地址，不会与 Brave / Tavily / DeepSeek 的 Key 混用。';

export const CUSTOM_URL_PLACEHOLDER = 'https://search.example.com/v1/search';

export interface CustomUrlCheck {
  /** 能否保存/使用：为 false 时后端调用也会拒绝，界面要给出原因。 */
  ok: boolean;
  /** 不通过时的原因；或者通过但值得提醒（见 warning）。 */
  error?: string;
  /** 能用但有风险的提示（明文 http）。 */
  warning?: string;
}

/**
 * 检查自定义服务地址（搜索与网页获取共用），规则与后端 `validate_endpoint_url` 一致：只收 http/https、必须有主机、
 * 不许内嵌用户名密码（配置文件是明文，Key 该走密钥链）。空串视为「还没填」，不报错。
 * 明文 http 到公网主机会把请求内容与 Key 暴露在链路上，提示一下；本机/内网地址不提示。
 */
export function checkCustomEndpointUrl(raw: string): CustomUrlCheck {
  const text = raw.trim();
  if (!text) return { ok: false };
  let parsed: URL;
  try {
    parsed = new URL(text);
  } catch {
    return { ok: false, error: '地址格式不正确，请填写完整的 http:// 或 https:// 地址' };
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { ok: false, error: '只支持 http:// 或 https:// 地址' };
  }
  if (parsed.username || parsed.password) {
    return { ok: false, error: '地址里不能带用户名或密码，请把 Key 填到下方的 API Key 框' };
  }
  if (parsed.protocol === 'http:' && !isLocalHost(parsed.hostname)) {
    return {
      ok: true,
      warning: '使用的是明文 http，请求内容和 Key 会在网络上裸传；除内网自建服务外建议改用 https。',
    };
  }
  return { ok: true };
}

function isLocalHost(host: string): boolean {
  const h = host.replace(/^\[|\]$/g, '').toLowerCase();
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local') || h === '::1') return true;
  const m = /^(\d+)\.(\d+)\.\d+\.\d+$/.exec(h);
  if (!m) return false;
  const a = Number(m[1]);
  const b = Number(m[2]);
  return a === 10 || a === 127 || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31);
}

/** DeepSeek Key 输入框的说明——搜索与网页获取两处共用，免得两边各写各的。 */
export const DEEPSEEK_KEY_DESCRIPTION =
  '加密保存在本设备，不会写入配置文件。填 DeepSeek 开放平台的 API Key（与对话用的是同一种）；网页搜索与网页获取共用这一份，各自按成功请求计费，详见 DeepSeek 官方定价。';

/** 「获取方式 = DeepSeek 抓取」的说明：数据去向、需要 Key、计费、内网例外都要讲清。 */
export const DEEPSEEK_FETCH_DESCRIPTION =
  '由 DeepSeek 服务器代为抓取公网网页并转成 Markdown，需要 DeepSeek API Key，按成功请求计费。内网 / 本机地址不会发给 DeepSeek，始终在本机读取。';

/** 「获取方式 = Tavily 抓取」的说明：数据去向、需要 Key、计费、内网例外都要讲清。 */
export const TAVILY_FETCH_DESCRIPTION =
  '由 Tavily 服务器代为抓取公网网页并转成 Markdown，需要 Tavily API Key，按成功提取的页面计费，详见 Tavily 官方定价。内网 / 本机地址不会发给 Tavily，始终在本机读取。';

/**
 * Tavily 抓取 Key 的说明。它和「搜索 API = Tavily」是同一家，所以搜索选了 Tavily 时留空即可；
 * 但搜索槽位可能装着 Brave 的 Key，因此搜索不是 Tavily 时**不会**去借，必须在这里单独填。
 */
export const TAVILY_FETCH_KEY_DESCRIPTION =
  '加密保存在本设备。留空时：若「搜索 API」选的是 Tavily，则沿用搜索那把 Key；否则（例如搜索用 Brave）需要在这里单独填 Tavily 的 Key——不会把 Brave 的 Key 发给 Tavily。';

/**
 * 「自定义」网页获取可选的兼容协议——你的抓取服务**长得像谁家的接口**。
 * `hint` 写清请求/响应形状，让人能对照自己的服务判断选哪个。线上取值与后端 `FetchApiProtocol` 一致。
 */
export const FETCH_API_PROTOCOLS: readonly {
  value: FetchApiProtocol;
  label: string;
  hint: string;
}[] = [
  {
    value: 'deepseek',
    label: 'DeepSeek 格式',
    hint: 'POST JSON：{"url": 网址}；Key 以 Bearer 方式放在 Authorization 头；返回 {"title", "content"}（content 为 Markdown）。',
  },
  {
    value: 'tavily',
    label: 'Tavily 格式',
    hint: 'POST JSON：{"urls": [网址], "format"}；Key 以 Bearer 方式放在 Authorization 头；返回 results[]（url / raw_content），抓不到的在 failed_results[]。',
  },
];

/** 「获取方式 = 自定义」的说明：数据去向、协议、内网策略都要讲清。 */
export const CUSTOM_FETCH_DESCRIPTION =
  '由你自己的抓取服务代为抓取网页并返回 Markdown 正文，下方选择它兼容哪家的接口格式。网址会发给这个服务，请只填你信任的地址。失败时自动降级为本机裸 HTTP。';

/** 自定义抓取 Key：可留空，且与其它 Key 完全隔离。 */
export const CUSTOM_FETCH_KEY_DESCRIPTION =
  '可留空（自建服务常常不鉴权）。有 Key 时以 Bearer 方式发送。加密保存在本设备，只会发给你填的这个地址，不与搜索或 DeepSeek 的 Key 混用。';

export const CUSTOM_FETCH_PRIVATE_DESCRIPTION =
  '默认关闭：内网 / 本机地址只在本机读取，主机名不会外泄。仅当你的抓取服务部署在同一内网、确实需要代抓内网页面时再打开。带账号密码的网址无论如何都不会发出。';

export const CUSTOM_FETCH_URL_PLACEHOLDER = 'https://fetch.example.com/v1/fetch';

/** 获取方式的 DeepSeek Key 行补充一句：它和搜索那一行是同一把 Key，别让人以为要填两遍。 */
export const DEEPSEEK_KEY_SHARED_NOTE = '与「搜索 API = DeepSeek 搜索」共用同一把 Key。';

/**
 * 搜索 API Key 的说明文案。
 *
 * Brave 与 Tavily 共用本机的同一份 Key，所以切换后旧 Key 仍显示「已保存」却会被新提供商
 * 拒绝——这里明说，免得用户对着 401 发懵。DeepSeek 有独立槽位，不受此限。
 */
export function searchKeyDescription(provider: WebSearchApiProvider): string {
  if (provider === 'deepseek') return DEEPSEEK_KEY_DESCRIPTION;
  if (provider === 'custom') return CUSTOM_KEY_DESCRIPTION;
  return '加密保存在本设备，不会写入配置文件；Brave 与 Tavily 共用这一份，切换后请重新填写。';
}
