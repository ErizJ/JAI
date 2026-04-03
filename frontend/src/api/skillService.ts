import { api } from './http'
import type {
  Skill,
  SkillListParams,
  SkillListResponse,
  CreateSkillRequest,
  UpdateSkillRequest,
  AgentSkillsResponse,
  AssociateAgentSkillsRequest,
  RemoveAgentSkillRequest,
  OnlineSkill,
  OnlineSkillListParams,
  OnlineSkillListResponse,
  InstallOnlineSkillRequest,
  InstallOnlineSkillResponse,
  GitHubSkillSource,
  CreateGitHubSourceRequest,
  UpdateGitHubSourceRequest,
  GitHubSourceListParams,
  GitHubSourceListResponse,
} from '@/types/skill'

const API_BASE_URL = '/v1/skills'

/**
 * Skill 服务
 * 提供技能的 CRUD 操作和 Agent 关联管理
 */
export const SkillService = {
  /**
   * 创建新技能
   */
  async createSkill(data: CreateSkillRequest): Promise<Skill> {
    return (await api.post(API_BASE_URL, data)) as unknown as Skill
  },

  /**
   * 更新技能信息
   */
  async updateSkill(data: UpdateSkillRequest): Promise<Skill> {
    return (await api.put(API_BASE_URL, data)) as unknown as Skill
  },

  /**
   * 删除技能
   */
  async deleteSkill(id: string): Promise<void> {
    await api.delete(`${API_BASE_URL}/${id}`)
  },

  /**
   * 获取技能详情
   */
  async getSkill(id: string): Promise<Skill> {
    return (await api.get(`${API_BASE_URL}/${id}`)) as unknown as Skill
  },

  /**
   * 获取技能列表（分页）
   */
  async getSkills(params: SkillListParams): Promise<SkillListResponse> {
    // http.ts 拦截器已经提取了 response.data，所以直接返回
    return (await api.post(`${API_BASE_URL}/list`, params)) as unknown as SkillListResponse
  },

  /**
   * 获取所有技能（不分页）
   */
  async getAllSkills(): Promise<Skill[]> {
    return (await api.get(`${API_BASE_URL}/all`)) as unknown as Skill[]
  },

  // ==================== Agent-Skill 关联 ====================

  /**
   * 获取 Agent 关联的 Skills
   */
  async getAgentSkills(agentId: string): Promise<AgentSkillsResponse> {
    return (await api.get(`${API_BASE_URL}/agent/${agentId}`)) as unknown as AgentSkillsResponse
  },

  // ==================== GitHub 技能源 ====================

  /**
   * 获取在线技能列表（从后端获取已缓存的技能列表，或触发后端刷新）
   * 注意：前端现在直接从 GitHub API 获取技能列表，此方法供后端缓存使用
   */
  async getOnlineSkills(params: OnlineSkillListParams): Promise<OnlineSkillListResponse> {
    return (await api.get(`${API_BASE_URL}/online`, {
      params,
    })) as unknown as OnlineSkillListResponse
  },

  /**
   * 安装在线技能
   * 后端会从 GitHub 仓库下载技能到指定目录
   */
  async installOnlineSkill(data: InstallOnlineSkillRequest): Promise<InstallOnlineSkillResponse> {
    return (await api.post(
      `${API_BASE_URL}/install`,
      data,
    )) as unknown as InstallOnlineSkillResponse
  },

  /**
   * 获取技能市场来源列表（用于后端配置的 GitHub 源）
   */
  async getSkillMarketSources(): Promise<{ id: string; name: string; url: string }[]> {
    return (await api.get(`${API_BASE_URL}/sources`)) as unknown as {
      id: string
      name: string
      url: string
    }[]
  },

  // ==================== GitHub 源管理 API ====================
  // 对应后端接口文档 1.8 - 1.12

  /**
   * 查询 GitHub 源列表
   * POST /api/v1/skills/sources/list
   */
  async getGitHubSources(params?: GitHubSourceListParams): Promise<GitHubSourceListResponse> {
    return (await api.post(`${API_BASE_URL}/sources/list`, {
      params,
    })) as unknown as GitHubSourceListResponse
  },

  /**
   * 创建 GitHub 源
   * POST /api/v1/skills/sources
   */
  async addGitHubSource(data: CreateGitHubSourceRequest): Promise<GitHubSkillSource> {
    return (await api.post(`${API_BASE_URL}/sources`, data)) as unknown as GitHubSkillSource
  },

  /**
   * 更新 GitHub 源
   * PUT /api/v1/skills/sources
   */
  async updateGitHubSource(data: UpdateGitHubSourceRequest): Promise<GitHubSkillSource> {
    return (await api.put(`${API_BASE_URL}/sources`, data)) as unknown as GitHubSkillSource
  },

  /**
   * 删除 GitHub 源
   * DELETE /api/v1/skills/sources/{id}
   */
  async deleteGitHubSource(sourceId: string): Promise<void> {
    await api.delete(`${API_BASE_URL}/sources/${sourceId}`)
  },

  /**
   * 获取 GitHub 源详情
   * GET /api/v1/skills/sources/{id}
   */
  async getGitHubSource(sourceId: string): Promise<GitHubSkillSource> {
    return (await api.get(`${API_BASE_URL}/sources/${sourceId}`)) as unknown as GitHubSkillSource
  },
}
