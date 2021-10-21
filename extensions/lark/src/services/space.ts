import { showToast, ToastStyle } from '@raycast/api';
import axios, { AxiosResponse } from 'axios';
import { getPreference } from '../utils/raycast';
import { trimTagsAndDecodeEntities } from '../utils/string';

interface LarkSpaceResponse<D = unknown> {
  code: number;
  msg: string;
  data: D;
}

export type UserID = string;
export type NodeID = string;

export const enum NodeType {
  /**
   * Wiki
   */
  Wik = 16,
  /**
   * Docs
   */
  Doc = 2,
  /**
   * Docx
   */
  Dox = 22,
  /**
   * Sheet
   */
  Sht = 3,
  /**
   * Bitable
   */
  Bas = 8,
  /**
   * Slides
   */
  Sld = 15,
  /**
   * MindNotes
   */
  Bmn = 11,
  /**
   * Local files
   */
  Box = 12,
}

export interface UserEntity {
  id: UserID;
  suid: string;
  name: string;
  cn_name: string;
  en_name: string;
  email: string;
  mobile: string;
  avatar_url: string;
  tenant_id: string;
  tenant_name: string;
  user_type: string;
}

export interface NodeEntity {
  edit_uid: UserID;
  owner_id: UserID;
  obj_token: NodeID;
  name: string;
  type: NodeType;
  create_time: number;
  edit_time: number;
  is_pined: boolean;
  is_stared: boolean;
  url: string;
  thumbnail: string;
  extra: {
    is_external: boolean;
    copiable?: boolean;
    data_version?: string;
    size?: string;
    subtype?: 'pptx' | 'json' | 'zip' | 'mov' | 'pdf' | 'xlsx' | 'key';
    version?: string;
  };
  thumbnail_extra: {
    url: string;
    type: number;
    nonce: string;
    secret: string;
  };
  open_time: number;
  owner_type: number;
  my_edit_time: number;
  activity_time: number;
  path_count: number;
}

export interface ObjEntity {
  token: string;
  type: NodeType;
  title: string;
  preview: string;
  owner_id: string;
  open_time: number;
  edit_uid: string;
  edit_time: number;
  edit_name: string;
  comment: string;
  author: string;
  create_uid: string;
  is_external: false;
  url: string;
  subtype: string;
  user_edit_time: number;
  share_version: number;
  wiki_infos: null;
  owner_type: number;
  container_type: number;
}

export interface RecentListResponse {
  node_list: NodeID[];
  has_more: boolean;
  total: number;
  entities: {
    nodes: Record<NodeID, NodeEntity>;
    users: Record<UserID, UserEntity>;
  };
}

export interface SearchDocsResponse {
  tokens: NodeID[];
  has_more: boolean;
  total: number;
  entities: {
    objs: Record<NodeID, ObjEntity>;
    users: Record<UserID, UserEntity>;
  };
}

const preference = getPreference();

const instance = axios.create({
  baseURL: `https://${preference.subdomain}.${preference.type === 'feishu' ? 'feishu.cn' : 'larksuite.com'}/space/api/`,
  headers: {
    Cookie: `session=${preference.spaceSession}`,
  },
  validateStatus: () => true,
});

instance.interceptors.response.use((response) => {
  const { data } = response as AxiosResponse<LarkSpaceResponse<unknown>>;

  if (data?.code !== 0) {
    throw Error(data?.msg || 'Unknown error');
  }
  response.data = data.data;

  return response;
});

export function isNodeEntity(entity: NodeEntity | ObjEntity): entity is NodeEntity {
  return 'obj_token' in entity;
}

export async function fetchRecentList(length = preference.recentListCount): Promise<RecentListResponse> {
  try {
    const { data } = await instance.get<RecentListResponse>('explorer/recent/list', {
      params: { length },
    });
    return data;
  } catch (error) {
    console.error(error);

    let errorMessage = 'Could not load recent list';
    if (error instanceof Error) {
      errorMessage = `${errorMessage} (${error.message})`;
    }

    showToast(ToastStyle.Failure, errorMessage);
    return Promise.resolve({
      has_more: false,
      total: 0,
      node_list: [],
      entities: {
        nodes: {},
        users: {},
      },
    });
  }
}

export interface SearchDocsParams {
  query: string;
  offset?: number;
  count?: number;
}

export async function searchDocs(params: SearchDocsParams): Promise<SearchDocsResponse> {
  try {
    const { data } = await instance.get<SearchDocsResponse>('search/refine_search', {
      params: { offset: 0, count: 15, ...params },
    });
    Object.keys(data.entities.objs).forEach((key) => {
      const objEntity = data.entities.objs[key];
      data.entities.objs[key] = {
        ...objEntity,
        title: trimTagsAndDecodeEntities(objEntity.title),
        preview: trimTagsAndDecodeEntities(objEntity.preview),
      };
    });
    return data;
  } catch (error) {
    console.error(error);

    let errorMessage = 'Could not search docs';
    if (error instanceof Error) {
      errorMessage = `${errorMessage} (${error.message})`;
    }

    showToast(ToastStyle.Failure, errorMessage);
    return Promise.resolve({
      has_more: false,
      total: 0,
      tokens: [],
      entities: {
        objs: {},
        users: {},
      },
    });
  }
}
