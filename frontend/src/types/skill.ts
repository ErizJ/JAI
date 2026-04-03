/**
 * Skill 类型定义
 * 技能是可复用的能力模块，类似 MCP 市场的概念
 */

// Skill 状态
export type SkillStatus = 'active' | 'inactive'

// Skill 关联状态
export type AgentSkillStatus = 'active' | 'inactive'

/**
 * Skill 实体
 */
export interface Skill {
  id: string
  name: string
  description?: string
  baseDir: string
  status: SkillStatus
  creatorId: string
  createdAt: number
  updatedAt: number
}

/**
 * Skill 列表查询参数
 */
export interface SkillListParams {
  name?: string
  status?: SkillStatus
  page?: number
  pageSize?: number
}

/**
 * Skill 列表响应
 */
export interface SkillListResponse {
  skills: Skill[]
  total: number
}

/**
 * 创建 Skill 请求
 */
export interface CreateSkillRequest {
  name: string
  description?: string
  baseDir: string
}

/**
 * 更新 Skill 请求
 */
export interface UpdateSkillRequest {
  id: string
  name?: string
  description?: string
  baseDir?: string
  status?: SkillStatus
}

/**
 * Agent-Skill 关联
 */
export interface AgentSkillAssociation {
  agentId: string
  skillId: string
  skillName: string
  status: AgentSkillStatus
  createdAt: number
  skill: Skill
}

/**
 * Agent Skills 列表响应
 */
export interface AgentSkillsResponse {
  skills: AgentSkillAssociation[]
  total: number
}

/**
 * 关联 Agent 与 Skills 请求
 */
export interface AssociateAgentSkillsRequest {
  agentId: string
  skillIds: string[]
}

/**
 * 移除 Agent-Skill 关联请求
 */
export interface RemoveAgentSkillRequest {
  agentId: string
  skillId: string
}

// ==================== 在线市场技能类型 ====================

/**
 * GitHub 技能源配置（匹配后端 API）
 */
export interface GitHubSkillSource {
  id: string
  name: string
  repoUrl: string // 例如: https://github.com/anthropics/skills.git
  description?: string
  creatorId?: string
  createdAt: number
  updatedAt: number
}

/**
 * 创建 GitHub 源请求
 */
export interface CreateGitHubSourceRequest {
  name: string
  repoUrl: string
  description?: string
}

/**
 * 更新 GitHub 源请求
 */
export interface UpdateGitHubSourceRequest {
  id: string
  name?: string
  repoUrl?: string
  description?: string
}

/**
 * GitHub 源列表查询参数
 */
export interface GitHubSourceListParams {
  name?: string
  page?: number
  pageSize?: number
}

/**
 * GitHub 源列表响应
 */
export interface GitHubSourceListResponse {
  sources: GitHubSkillSource[]
  total: number
}

/**
 * 技能市场来源
 */
export type SkillMarketSource = 'github' | 'custom'

/**
 * 在线技能项（来自 GitHub 源）
 */
export interface OnlineSkill {
  id: string
  name: string
  description: string
  icon?: string
  author: string
  authorAvatar?: string
  version: string
  tags: string[]
  source: SkillMarketSource
  sourceId: string // GitHub 源 ID
  repoUrl: string // GitHub 仓库 URL
  repoPath: string // 仓库内的路径
  readmeUrl?: string
  installCommand?: string
  createdAt: number
  updatedAt: number
}

/**
 * 在线技能查询参数
 */
export interface OnlineSkillListParams {
  keyword?: string
  sourceId?: string // 特定 GitHub 源 ID
  tags?: string[]
  page?: number
  pageSize?: number
}

/**
 * 在线技能列表响应
 */
export interface OnlineSkillListResponse {
  skills: OnlineSkill[]
  total: number
}

/**
 * 安装在线技能请求
 */
export interface InstallOnlineSkillRequest {
  skillId: string
  sourceId: string // GitHub 源 ID
  targetDir: string
  repoUrl: string // 技能仓库 URL
  repoPath?: string // 仓库内的子路径
}

/**
 * GitHub 技能源管理请求
 */
export interface AddGitHubSourceRequest {
  name: string
  url: string // 完整的 GitHub URL，如 https://github.com/anthropics/skills
}

export interface RemoveGitHubSourceRequest {
  sourceId: string
}

/**
 * 安装在线技能响应
 * 后端返回的是 Skill 对象，通过 http.ts 拦截器处理后直接返回
 */
export type InstallOnlineSkillResponse = Skill
