import { useState } from 'react';
import { checkCustomEndpointUrl, type CustomUrlCheck } from '@/lib/webSearchProviders';

export interface EndpointUrlDraft {
  /** 输入框里的当前文本（可能还没提交）。 */
  urlDraft: string;
  setUrlDraft: (text: string) => void;
  /** 对当前草稿的检查结果；空草稿 = 还没填，`ok=false` 但没有 `error`。 */
  check: CustomUrlCheck;
  /** 失焦时调用：合法或清空就提交，不合法的留在输入框里等用户改，不写进配置。 */
  commitUrl: () => void;
}

/**
 * 「自定义服务地址」输入框的草稿状态——自定义搜索与自定义网页获取共用。
 *
 * 按失焦提交而不是逐字写入：`settings.update` 每次都整份序列化落盘，打一个 URL 会写几十次；
 * 而且写到一半的 `https://exa` 也没有存的价值。配置从外部变了（首次加载、另一窗口改了）时，
 * 草稿跟着对齐，免得输入框显示旧值。
 */
export function useEndpointUrlDraft(
  committedUrl: string,
  onCommit: (url: string) => void,
): EndpointUrlDraft {
  const [urlDraft, setUrlDraft] = useState(committedUrl);
  const [seen, setSeen] = useState(committedUrl);
  if (seen !== committedUrl) {
    // 渲染期同步外部变化（React 推荐的「由 props 派生 state」写法，不用 effect）。
    setSeen(committedUrl);
    setUrlDraft(committedUrl);
  }

  const check = checkCustomEndpointUrl(urlDraft);

  const commitUrl = () => {
    const text = urlDraft.trim();
    if (text === committedUrl) {
      if (text !== urlDraft) setUrlDraft(text);
      return;
    }
    if (text === '' || check.ok) {
      setUrlDraft(text);
      onCommit(text);
    }
  };

  return { urlDraft, setUrlDraft, check, commitUrl };
}
