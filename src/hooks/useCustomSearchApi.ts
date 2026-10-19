import type { CustomSearchApi, SearchApiProtocol } from '@/lib/types';
import { useEndpointUrlDraft, type EndpointUrlDraft } from './useEndpointUrlDraft';

export interface CustomSearchApiForm extends EndpointUrlDraft {
  protocol: SearchApiProtocol;
  setProtocol: (protocol: SearchApiProtocol) => void;
}

/**
 * 「自定义搜索 API」地址 + 协议的表单状态——桌面与移动端设置页共用。
 * 地址按失焦提交（见 {@link useEndpointUrlDraft}），协议是点选，立即提交。
 */
export function useCustomSearchApi(
  committed: CustomSearchApi,
  onChange: (next: CustomSearchApi) => void,
): CustomSearchApiForm {
  const draft = useEndpointUrlDraft(committed.url, (url) => onChange({ ...committed, url }));
  return {
    ...draft,
    protocol: committed.protocol,
    setProtocol: (protocol) => {
      if (protocol !== committed.protocol) onChange({ ...committed, protocol });
    },
  };
}
