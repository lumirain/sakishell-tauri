import type { CustomFetchApi, FetchApiProtocol } from '@/lib/types';
import { useEndpointUrlDraft, type EndpointUrlDraft } from './useEndpointUrlDraft';

export interface CustomFetchApiForm extends EndpointUrlDraft {
  protocol: FetchApiProtocol;
  setProtocol: (protocol: FetchApiProtocol) => void;
  sendPrivate: boolean;
  setSendPrivate: (value: boolean) => void;
}

/**
 * 「自定义网页获取」地址 + 协议 + 内网策略的表单状态——桌面与移动端设置页共用。
 * 地址按失焦提交（见 {@link useEndpointUrlDraft}），协议与开关是点选，立即提交。
 */
export function useCustomFetchApi(
  committed: CustomFetchApi,
  onChange: (next: CustomFetchApi) => void,
): CustomFetchApiForm {
  const draft = useEndpointUrlDraft(committed.url, (url) => onChange({ ...committed, url }));
  return {
    ...draft,
    protocol: committed.protocol,
    setProtocol: (protocol) => {
      if (protocol !== committed.protocol) onChange({ ...committed, protocol });
    },
    sendPrivate: committed.sendPrivate,
    setSendPrivate: (sendPrivate) => {
      if (sendPrivate !== committed.sendPrivate) onChange({ ...committed, sendPrivate });
    },
  };
}
