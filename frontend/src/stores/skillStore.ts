import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { SkillService } from '@/api/skillService'
import type { Skill, SkillListParams, AgentSkillAssociation } from '@/types/skill'

/**
 * Skill Store
 * 管理技能状态和操作，类似 MCP 市场的概念
 */
export const useSkillStore = defineStore('skill', () => {
  // ==================== State ====================
  const skills = ref<Skill[]>([])
  const currentSkill = ref<Skill | null>(null)
  const agentSkills = ref<AgentSkillAssociation[]>([])
  const loading = ref(false)
  const error = ref<string | null>(null)
  const total = ref(0)

  // 分页和过滤
  const filters = ref<SkillListParams>({
    page: 1,
    pageSize: 20,
    name: '',
    status: undefined,
  })

  // ==================== Getters ====================
  const activeSkills = computed(() => skills.value.filter((s) => s.status === 'active'))

  const getSkillById = computed(() => (id: string) => skills.value.find((s) => s.id === id))

  const getAgentSkillIds = computed(() => agentSkills.value.map((as) => as.skillId))

  // ==================== Actions ====================

  /**
   * 获取技能列表
   */
  async function fetchSkills(params?: SkillListParams) {
    loading.value = true
    error.value = null

    try {
      const queryParams = { ...filters.value, ...params }
      const response = await SkillService.getSkills(queryParams)

      // 健壮性处理：确保 response 和 response.data 存在
      if (!response) {
        console.warn('[skillStore] fetchSkills: response is undefined')
        skills.value = []
        total.value = 0
        return { skills: [], total: 0 }
      }

      skills.value = response.skills || []
      total.value = response.total || 0

      // 更新过滤条件
      if (params) {
        filters.value = { ...filters.value, ...params }
      }

      return response
    } catch (err) {
      error.value = err instanceof Error ? err.message : '获取技能列表失败'
      console.error('获取技能列表失败:', err)
      // 出错时重置数据
      skills.value = []
      total.value = 0
      throw err
    } finally {
      loading.value = false
    }
  }

  /**
   * 获取所有技能（不分页）
   */
  async function fetchAllSkills() {
    loading.value = true
    error.value = null

    try {
      const response = await SkillService.getAllSkills()
      skills.value = response
      return response
    } catch (err) {
      error.value = err instanceof Error ? err.message : '获取技能列表失败'
      console.error('获取技能列表失败:', err)
      throw err
    } finally {
      loading.value = false
    }
  }

  /**
   * 获取单个技能详情
   */
  async function fetchSkill(id: string) {
    loading.value = true
    error.value = null

    try {
      const skill = await SkillService.getSkill(id)
      currentSkill.value = skill
      return skill
    } catch (err) {
      error.value = err instanceof Error ? err.message : '获取技能详情失败'
      console.error('获取技能详情失败:', err)
      throw err
    } finally {
      loading.value = false
    }
  }

  /**
   * 创建技能
   */
  async function createSkill(data: { name: string; description?: string; baseDir: string }) {
    loading.value = true
    error.value = null

    try {
      const skill = await SkillService.createSkill(data)
      skills.value.unshift(skill)
      total.value++
      return skill
    } catch (err) {
      error.value = err instanceof Error ? err.message : '创建技能失败'
      console.error('创建技能失败:', err)
      throw err
    } finally {
      loading.value = false
    }
  }

  /**
   * 更新技能
   */
  async function updateSkill(data: {
    id: string
    name?: string
    description?: string
    baseDir?: string
    status?: 'active' | 'inactive'
  }) {
    loading.value = true
    error.value = null

    try {
      const updatedSkill = await SkillService.updateSkill(data)

      // 更新本地列表
      const index = skills.value.findIndex((s) => s.id === data.id)
      if (index !== -1) {
        skills.value[index] = updatedSkill
      }

      // 更新当前选中
      if (currentSkill.value?.id === data.id) {
        currentSkill.value = updatedSkill
      }

      return updatedSkill
    } catch (err) {
      error.value = err instanceof Error ? err.message : '更新技能失败'
      console.error('更新技能失败:', err)
      throw err
    } finally {
      loading.value = false
    }
  }

  /**
   * 删除技能
   */
  async function deleteSkill(id: string) {
    loading.value = true
    error.value = null

    try {
      await SkillService.deleteSkill(id)

      // 从本地列表移除
      skills.value = skills.value.filter((s) => s.id !== id)
      total.value--

      // 清除当前选中
      if (currentSkill.value?.id === id) {
        currentSkill.value = null
      }
    } catch (err) {
      error.value = err instanceof Error ? err.message : '删除技能失败'
      console.error('删除技能失败:', err)
      throw err
    } finally {
      loading.value = false
    }
  }

  /**
   * 获取 Agent 关联的 Skills
   */
  async function fetchAgentSkills(agentId: string) {
    loading.value = true
    error.value = null

    try {
      const response = await SkillService.getAgentSkills(agentId)
      agentSkills.value = response.skills
      return response
    } catch (err) {
      error.value = err instanceof Error ? err.message : '获取 Agent Skills 失败'
      console.error('获取 Agent Skills 失败:', err)
      throw err
    } finally {
      loading.value = false
    }
  }

  /**
   * 关联 Skills 到 Agent
   */
  async function associateSkillsToAgent(agentId: string, skillIds: string[]) {
    loading.value = true
    error.value = null

    try {
      await SkillService.associateAgentSkills({ agentId, skillIds })
      // 刷新 Agent Skills
      await fetchAgentSkills(agentId)
    } catch (err) {
      error.value = err instanceof Error ? err.message : '关联 Skills 失败'
      console.error('关联 Skills 失败:', err)
      throw err
    } finally {
      loading.value = false
    }
  }

  /**
   * 从 Agent 移除 Skill 关联
   */
  async function removeSkillFromAgent(agentId: string, skillId: string) {
    loading.value = true
    error.value = null

    try {
      await SkillService.removeAgentSkill({ agentId, skillId })
      // 从本地列表移除
      agentSkills.value = agentSkills.value.filter(
        (as) => !(as.agentId === agentId && as.skillId === skillId),
      )
    } catch (err) {
      error.value = err instanceof Error ? err.message : '移除 Skill 关联失败'
      console.error('移除 Skill 关联失败:', err)
      throw err
    } finally {
      loading.value = false
    }
  }

  /**
   * 设置当前选中 Skill
   */
  function setCurrentSkill(skill: Skill | null) {
    currentSkill.value = skill
  }

  /**
   * 更新过滤条件
   */
  function setFilters(newFilters: Partial<SkillListParams>) {
    filters.value = { ...filters.value, ...newFilters }
  }

  /**
   * 清除错误
   */
  function clearError() {
    error.value = null
  }

  return {
    // State
    skills,
    currentSkill,
    agentSkills,
    loading,
    error,
    total,
    filters,

    // Getters
    activeSkills,
    getSkillById,
    getAgentSkillIds,

    // Actions
    fetchSkills,
    fetchAllSkills,
    fetchSkill,
    createSkill,
    updateSkill,
    deleteSkill,
    fetchAgentSkills,
    associateSkillsToAgent,
    removeSkillFromAgent,
    setCurrentSkill,
    setFilters,
    clearError,
  }
})
