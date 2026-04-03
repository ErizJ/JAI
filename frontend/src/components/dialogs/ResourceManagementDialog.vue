<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import {
  Plus,
  Delete,
  Tools,
  Collection,
  UserFilled,
  MagicStick,
  Search,
  CircleCheckFilled,
} from '@element-plus/icons-vue'
import { AgentService } from '@/api/agentService'
import { ToolService } from '@/api/toolService'
import { SkillService } from '@/api/skillService'
import { listAgentMarkets } from '@/api/a2aService'
import type { Tool } from '@/types/tool'
import type { Skill, AgentSkillAssociation } from '@/types/skill'

const props = defineProps<{
  visible: boolean
  agentId: string
}>()

const emit = defineEmits<{
  'update:visible': [value: boolean]
  refresh: []
}>()

// ==================== State ====================
const activeTab = ref('tools')
const loading = ref(false)

// 资源数据
const tools = ref<any[]>([])
const knowledgeBases = ref<any[]>([])
const agentMarkets = ref<any[]>([])
const skills = ref<Skill[]>([])

// 可用资源（用于添加）
const availableTools = ref<Tool[]>([])
const availableKnowledgeBases = ref<any[]>([])
const availableAgents = ref<any[]>([])
const availableSkills = ref<Skill[]>([])

// 添加对话框
const showAddToolDialog = ref(false)
const showAddKnowledgeDialog = ref(false)
const showAddAgentDialog = ref(false)
const showAddSkillDialog = ref(false)

// 选中的资源
const selectedTools = ref<string[]>([])
const selectedKnowledgeBases = ref<string[]>([])
const selectedAgents = ref<string[]>([])
const selectedSkills = ref<string[]>([])

// 搜索查询
const searchToolQuery = ref('')
const searchKbQuery = ref('')
const searchAgentQuery = ref('')
const searchSkillQuery = ref('')

// ==================== Computed ====================
const dialogVisible = computed({
  get: () => props.visible,
  set: (val) => emit('update:visible', val),
})

const tabs = computed(() => [
  { key: 'tools', label: '工具', icon: Tools, count: tools.value.length },
  { key: 'knowledge', label: '知识库', icon: Collection, count: knowledgeBases.value.length },
  { key: 'agents', label: '智能体', icon: UserFilled, count: agentMarkets.value.length },
  { key: 'skills', label: '技能', icon: MagicStick, count: skills.value.length },
])

// 过滤后的资源列表
const filteredTools = computed(() => {
  if (!searchToolQuery.value) return availableTools.value
  const query = searchToolQuery.value.toLowerCase()
  return availableTools.value.filter(
    (t) =>
      t.name?.toLowerCase().includes(query) || (t.description || '').toLowerCase().includes(query),
  )
})

const filteredKnowledgeBases = computed(() => {
  if (!searchKbQuery.value) return availableKnowledgeBases.value
  const query = searchKbQuery.value.toLowerCase()
  return availableKnowledgeBases.value.filter(
    (kb) =>
      kb.name?.toLowerCase().includes(query) ||
      (kb.description || '').toLowerCase().includes(query),
  )
})

const filteredAgents = computed(() => {
  if (!searchAgentQuery.value) return availableAgents.value
  const query = searchAgentQuery.value.toLowerCase()
  return availableAgents.value.filter(
    (a) =>
      a.name?.toLowerCase().includes(query) || (a.description || '').toLowerCase().includes(query),
  )
})

const filteredSkills = computed(() => {
  if (!searchSkillQuery.value) return availableSkills.value
  const query = searchSkillQuery.value.toLowerCase()
  return availableSkills.value.filter(
    (s) =>
      s.name?.toLowerCase().includes(query) || (s.description || '').toLowerCase().includes(query),
  )
})

// 切换选择
function toggleSelection(selectedList: string[], id: string | undefined) {
  if (!id) return
  const index = selectedList.indexOf(id)
  if (index > -1) {
    selectedList.splice(index, 1)
  } else {
    selectedList.push(id)
  }
}

// ==================== Methods ====================
async function loadResources() {
  if (!props.agentId) return
  loading.value = true
  try {
    // 通过 getAgent 接口获取 Agent 详情，包含所有关联资源
    const agent = await AgentService.getAgent(props.agentId)

    // 从 Agent 数据中提取关联资源
    tools.value = agent.tools || []
    knowledgeBases.value = (agent.knowledge_bases || []).map((kb: any) => ({
      ...kb,
      status: kb.status || 'enabled',
    }))
    agentMarkets.value = agent.agentMarkets || []
    skills.value = agent.skills || []
  } catch (error) {
    console.error('加载资源失败:', error)
    ElMessage.error('加载资源失败')
  } finally {
    loading.value = false
  }
}

async function loadAvailableResources() {
  try {
    const [toolsRes, agentsRes, skillsRes] = await Promise.all([
      ToolService.getTools({ page: 1, pageSize: 100 }),
      listAgentMarkets().catch(() => []),
      SkillService.getAllSkills().catch(() => []),
    ])
    // 过滤掉已关联的
    const toolIds = tools.value.map((t) => t.id)
    const agentIds = agentMarkets.value.map((a) => a.id)
    const skillIds = skills.value.map((s) => s.id)

    availableTools.value = (toolsRes.list || []).filter((t: Tool) => !toolIds.includes(t.id))
    availableAgents.value = (agentsRes || []).filter((a: any) => !agentIds.includes(a.id))
    availableSkills.value = (skillsRes || []).filter((s: Skill) => !skillIds.includes(s.id))
    // 知识库从已加载的获取
    availableKnowledgeBases.value = []
  } catch (error) {
    console.error('加载可用资源失败:', error)
  }
}

// 打开添加对话框
async function openAddDialog(type: string) {
  await loadAvailableResources()
  switch (type) {
    case 'tools':
      selectedTools.value = []
      showAddToolDialog.value = true
      break
    case 'knowledge':
      selectedKnowledgeBases.value = []
      showAddKnowledgeDialog.value = true
      break
    case 'agents':
      selectedAgents.value = []
      showAddAgentDialog.value = true
      break
    case 'skills':
      selectedSkills.value = []
      showAddSkillDialog.value = true
      break
  }
}

// 添加工具
async function handleAddTools() {
  if (selectedTools.value.length === 0) {
    ElMessage.warning('请至少选择一个工具')
    return
  }
  try {
    const toolParams = selectedTools.value.map((id) => ({ id, type: 'system' }))
    await AgentService.addToolsToAgent(props.agentId, toolParams)
    ElMessage.success('工具添加成功')
    showAddToolDialog.value = false
    await loadResources()
    emit('refresh')
  } catch (error) {
    console.error('添加工具失败:', error)
    ElMessage.error('添加工具失败')
  }
}

// 添加知识库
async function handleAddKnowledgeBases() {
  if (selectedKnowledgeBases.value.length === 0) {
    ElMessage.warning('请至少选择一个知识库')
    return
  }
  try {
    for (const kbId of selectedKnowledgeBases.value) {
      await AgentService.addKnowledgeBaseToAgent(props.agentId, kbId)
    }
    ElMessage.success('知识库添加成功')
    showAddKnowledgeDialog.value = false
    await loadResources()
    emit('refresh')
  } catch (error) {
    console.error('添加知识库失败:', error)
    ElMessage.error('添加知识库失败')
  }
}

// 添加智能体
async function handleAddAgents() {
  if (selectedAgents.value.length === 0) {
    ElMessage.warning('请至少选择一个智能体')
    return
  }
  try {
    await AgentService.addAgentToAgent(props.agentId, selectedAgents.value)
    ElMessage.success('智能体添加成功')
    showAddAgentDialog.value = false
    await loadResources()
    emit('refresh')
  } catch (error) {
    console.error('添加智能体失败:', error)
    ElMessage.error('添加智能体失败')
  }
}

// 添加技能
async function handleAddSkills() {
  if (selectedSkills.value.length === 0) {
    ElMessage.warning('请至少选择一个技能')
    return
  }
  try {
    await AgentService.addAgentSkills({
      agentId: props.agentId,
      skillIds: selectedSkills.value,
    })
    ElMessage.success('技能添加成功')
    showAddSkillDialog.value = false
    await loadResources()
    emit('refresh')
  } catch (error) {
    console.error('添加技能失败:', error)
    ElMessage.error('添加技能失败')
  }
}

// 移除工具
async function removeTool(tool: any) {
  try {
    await ElMessageBox.confirm(`确定要移除工具 "${tool.name}" 吗？`, '确认移除', {
      type: 'warning',
    })
    await AgentService.removeToolFromAgent(props.agentId, tool.id)
    ElMessage.success('移除成功')
    await loadResources()
    emit('refresh')
  } catch (error) {
    if (error !== 'cancel') {
      console.error('移除工具失败:', error)
      ElMessage.error('移除失败')
    }
  }
}

// 移除知识库
async function removeKnowledgeBase(kb: any) {
  try {
    await ElMessageBox.confirm(`确定要移除知识库 "${kb.name}" 吗？`, '确认移除', {
      type: 'warning',
    })
    await AgentService.removeKnowledgeBaseFromAgent(props.agentId, kb.id)
    ElMessage.success('移除成功')
    await loadResources()
    emit('refresh')
  } catch (error) {
    if (error !== 'cancel') {
      console.error('移除知识库失败:', error)
      ElMessage.error('移除失败')
    }
  }
}

// 移除智能体
async function removeAgent(agent: any) {
  try {
    await ElMessageBox.confirm(`确定要移除智能体 "${agent.name}" 吗？`, '确认移除', {
      type: 'warning',
    })
    await AgentService.removeAgentFromAgent(props.agentId, agent.id)
    ElMessage.success('移除成功')
    await loadResources()
    emit('refresh')
  } catch (error) {
    if (error !== 'cancel') {
      console.error('移除智能体失败:', error)
      ElMessage.error('移除失败')
    }
  }
}

// 移除技能
async function removeSkill(skill: Skill) {
  try {
    await ElMessageBox.confirm(`确定要移除技能 "${skill.name}" 吗？`, '确认移除', {
      type: 'warning',
    })
    await AgentService.removeAgentSkill({
      agentId: props.agentId,
      skillId: skill.id,
    })
    ElMessage.success('移除成功')
    await loadResources()
    emit('refresh')
  } catch (error) {
    if (error !== 'cancel') {
      console.error('移除技能失败:', error)
      ElMessage.error('移除失败')
    }
  }
}

// 切换知识库状态
async function toggleKnowledgeBaseStatus(kb: any) {
  try {
    const newStatus = kb.status === 'enabled' ? 'disabled' : 'enabled'
    await AgentService.updateAgentKnowledgeBase(props.agentId, kb.id, newStatus)
    kb.status = newStatus
    ElMessage.success('状态更新成功')
    emit('refresh')
  } catch (error) {
    console.error('更新状态失败:', error)
    ElMessage.error('更新状态失败')
  }
}

function handleClose() {
  emit('update:visible', false)
}

// ==================== Lifecycle ====================
watch(
  () => props.visible,
  (newVal) => {
    if (newVal && props.agentId) {
      loadResources()
    }
  },
)
</script>

<template>
  <el-dialog
    v-model="dialogVisible"
    title="资源关联管理"
    width="700px"
    :before-close="handleClose"
    destroy-on-close
  >
    <div v-loading="loading" class="resource-management">
      <!-- 左侧标签导航 -->
      <div class="resource-tabs">
        <div
          v-for="tab in tabs"
          :key="tab.key"
          class="tab-item"
          :class="{ active: activeTab === tab.key }"
          @click="activeTab = tab.key"
        >
          <el-icon><component :is="tab.icon" /></el-icon>
          <span class="tab-label">{{ tab.label }}</span>
          <el-tag size="small" type="info" class="tab-count">{{ tab.count }}</el-tag>
        </div>
      </div>

      <!-- 右侧内容区 -->
      <div class="resource-content">
        <!-- 工具列表 -->
        <div v-show="activeTab === 'tools'" class="resource-panel">
          <div class="panel-header">
            <span class="panel-title">已关联工具</span>
            <el-button type="primary" size="small" @click="openAddDialog('tools')">
              <el-icon><Plus /></el-icon>添加工具
            </el-button>
          </div>
          <div v-if="tools.length > 0" class="resource-list">
            <div v-for="tool in tools" :key="tool.id" class="resource-item">
              <div class="resource-info">
                <span class="resource-name">{{ tool.name }}</span>
                <span class="resource-desc">{{ tool.description || '暂无描述' }}</span>
              </div>
              <el-button type="danger" size="small" text @click="removeTool(tool)">
                <el-icon><Delete /></el-icon>
              </el-button>
            </div>
          </div>
          <el-empty v-else description="暂无关联工具" />
        </div>

        <!-- 知识库列表 -->
        <div v-show="activeTab === 'knowledge'" class="resource-panel">
          <div class="panel-header">
            <span class="panel-title">已关联知识库</span>
            <el-button type="primary" size="small" @click="openAddDialog('knowledge')">
              <el-icon><Plus /></el-icon>添加知识库
            </el-button>
          </div>
          <div v-if="knowledgeBases.length > 0" class="resource-list">
            <div v-for="kb in knowledgeBases" :key="kb.id" class="resource-item">
              <div class="resource-info">
                <span class="resource-name">{{ kb.name }}</span>
                <span class="resource-desc">{{ kb.description || '暂无描述' }}</span>
              </div>
              <div class="resource-actions">
                <el-tag :type="kb.status === 'enabled' ? 'success' : 'info'" size="small">
                  {{ kb.status === 'enabled' ? '启用' : '禁用' }}
                </el-tag>
                <el-button
                  size="small"
                  :type="kb.status === 'enabled' ? 'info' : 'success'"
                  @click="toggleKnowledgeBaseStatus(kb)"
                >
                  {{ kb.status === 'enabled' ? '禁用' : '启用' }}
                </el-button>
                <el-button type="danger" size="small" text @click="removeKnowledgeBase(kb)">
                  <el-icon><Delete /></el-icon>
                </el-button>
              </div>
            </div>
          </div>
          <el-empty v-else description="暂无关联知识库" />
        </div>

        <!-- 智能体列表 -->
        <div v-show="activeTab === 'agents'" class="resource-panel">
          <div class="panel-header">
            <span class="panel-title">已关联智能体</span>
            <el-button type="primary" size="small" @click="openAddDialog('agents')">
              <el-icon><Plus /></el-icon>添加智能体
            </el-button>
          </div>
          <div v-if="agentMarkets.length > 0" class="resource-list">
            <div v-for="agent in agentMarkets" :key="agent.id" class="resource-item">
              <div class="resource-info">
                <span class="resource-name">{{ agent.name }}</span>
                <span class="resource-desc">{{ agent.description || '暂无描述' }}</span>
              </div>
              <el-button type="danger" size="small" text @click="removeAgent(agent)">
                <el-icon><Delete /></el-icon>
              </el-button>
            </div>
          </div>
          <el-empty v-else description="暂无关联智能体" />
        </div>

        <!-- 技能列表 -->
        <div v-show="activeTab === 'skills'" class="resource-panel">
          <div class="panel-header">
            <span class="panel-title">已关联技能</span>
            <el-button type="primary" size="small" @click="openAddDialog('skills')">
              <el-icon><Plus /></el-icon>添加技能
            </el-button>
          </div>
          <div v-if="skills.length > 0" class="resource-list">
            <div v-for="skill in skills" :key="skill.id" class="resource-item">
              <div class="resource-info">
                <span class="resource-name">{{ skill.name }}</span>
                <span class="resource-desc">{{ skill.description || '暂无描述' }}</span>
              </div>
              <el-button type="danger" size="small" text @click="removeSkill(skill)">
                <el-icon><Delete /></el-icon>
              </el-button>
            </div>
          </div>
          <el-empty v-else description="暂无关联技能" />
        </div>
      </div>
    </div>

    <template #footer>
      <el-button @click="handleClose">关闭</el-button>
    </template>
  </el-dialog>

  <!-- 添加工具对话框 -->
  <el-dialog v-model="showAddToolDialog" title="添加工具" width="600px" destroy-on-close>
    <div class="add-dialog-content">
      <div class="search-bar">
        <el-input
          v-model="searchToolQuery"
          placeholder="搜索工具..."
          prefix-icon="Search"
          clearable
          size="large"
        />
      </div>
      <div class="resource-cards">
        <div
          v-for="tool in filteredTools"
          :key="tool.id"
          class="resource-card"
          :class="{ selected: tool.id && selectedTools.includes(tool.id) }"
          @click="tool.id && toggleSelection(selectedTools, tool.id)"
        >
          <div class="card-icon">
            <el-icon size="24"><Tools /></el-icon>
          </div>
          <div class="card-info">
            <div class="card-title">{{ tool.name }}</div>
            <div class="card-desc">{{ tool.description || '暂无描述' }}</div>
          </div>
          <div class="card-check">
            <el-icon v-if="tool.id && selectedTools.includes(tool.id)" class="check-icon" size="20"
              ><CircleCheckFilled
            /></el-icon>
            <div v-else class="check-placeholder"></div>
          </div>
        </div>
        <el-empty v-if="filteredTools.length === 0" description="未找到匹配的工具" />
      </div>
    </div>
    <template #footer>
      <div class="dialog-footer">
        <span class="selected-count">已选择 {{ selectedTools.length }} 项</span>
        <div class="footer-actions">
          <el-button @click="showAddToolDialog = false">取消</el-button>
          <el-button type="primary" @click="handleAddTools" :disabled="selectedTools.length === 0">
            添加
          </el-button>
        </div>
      </div>
    </template>
  </el-dialog>

  <!-- 添加知识库对话框 -->
  <el-dialog v-model="showAddKnowledgeDialog" title="添加知识库" width="600px" destroy-on-close>
    <div class="add-dialog-content">
      <div class="search-bar">
        <el-input
          v-model="searchKbQuery"
          placeholder="搜索知识库..."
          prefix-icon="Search"
          clearable
          size="large"
        />
      </div>
      <div class="resource-cards">
        <div
          v-for="kb in filteredKnowledgeBases"
          :key="kb.id"
          class="resource-card"
          :class="{ selected: kb.id && selectedKnowledgeBases.includes(kb.id) }"
          @click="kb.id && toggleSelection(selectedKnowledgeBases, kb.id)"
        >
          <div class="card-icon kb-icon">
            <el-icon size="24"><Collection /></el-icon>
          </div>
          <div class="card-info">
            <div class="card-title">{{ kb.name }}</div>
            <div class="card-desc">{{ kb.description || '暂无描述' }}</div>
          </div>
          <div class="card-check">
            <el-icon
              v-if="kb.id && selectedKnowledgeBases.includes(kb.id)"
              class="check-icon"
              size="20"
              ><CircleCheckFilled
            /></el-icon>
            <div v-else class="check-placeholder"></div>
          </div>
        </div>
        <el-empty v-if="filteredKnowledgeBases.length === 0" description="未找到匹配的知识库" />
      </div>
    </div>
    <template #footer>
      <div class="dialog-footer">
        <span class="selected-count">已选择 {{ selectedKnowledgeBases.length }} 项</span>
        <div class="footer-actions">
          <el-button @click="showAddKnowledgeDialog = false">取消</el-button>
          <el-button
            type="primary"
            @click="handleAddKnowledgeBases"
            :disabled="selectedKnowledgeBases.length === 0"
          >
            添加
          </el-button>
        </div>
      </div>
    </template>
  </el-dialog>

  <!-- 添加智能体对话框 -->
  <el-dialog v-model="showAddAgentDialog" title="添加智能体" width="600px" destroy-on-close>
    <div class="add-dialog-content">
      <div class="search-bar">
        <el-input
          v-model="searchAgentQuery"
          placeholder="搜索智能体..."
          prefix-icon="Search"
          clearable
          size="large"
        />
      </div>
      <div class="resource-cards">
        <div
          v-for="agent in filteredAgents"
          :key="agent.id"
          class="resource-card"
          :class="{ selected: agent.id && selectedAgents.includes(agent.id) }"
          @click="agent.id && toggleSelection(selectedAgents, agent.id)"
        >
          <div class="card-icon agent-icon">
            <el-icon size="24"><UserFilled /></el-icon>
          </div>
          <div class="card-info">
            <div class="card-title">{{ agent.name }}</div>
            <div class="card-desc">{{ agent.description || '暂无描述' }}</div>
          </div>
          <div class="card-check">
            <el-icon
              v-if="agent.id && selectedAgents.includes(agent.id)"
              class="check-icon"
              size="20"
              ><CircleCheckFilled
            /></el-icon>
            <div v-else class="check-placeholder"></div>
          </div>
        </div>
        <el-empty v-if="filteredAgents.length === 0" description="未找到匹配的智能体" />
      </div>
    </div>
    <template #footer>
      <div class="dialog-footer">
        <span class="selected-count">已选择 {{ selectedAgents.length }} 项</span>
        <div class="footer-actions">
          <el-button @click="showAddAgentDialog = false">取消</el-button>
          <el-button
            type="primary"
            @click="handleAddAgents"
            :disabled="selectedAgents.length === 0"
          >
            添加
          </el-button>
        </div>
      </div>
    </template>
  </el-dialog>

  <!-- 添加技能对话框 -->
  <el-dialog v-model="showAddSkillDialog" title="添加技能" width="600px" destroy-on-close>
    <div class="add-dialog-content">
      <div class="search-bar">
        <el-input
          v-model="searchSkillQuery"
          placeholder="搜索技能..."
          prefix-icon="Search"
          clearable
          size="large"
        />
      </div>
      <div class="resource-cards">
        <div
          v-for="skill in filteredSkills"
          :key="skill.id"
          class="resource-card"
          :class="{ selected: skill.id && selectedSkills.includes(skill.id) }"
          @click="skill.id && toggleSelection(selectedSkills, skill.id)"
        >
          <div class="card-icon skill-icon">
            <el-icon size="24"><MagicStick /></el-icon>
          </div>
          <div class="card-info">
            <div class="card-title">{{ skill.name }}</div>
            <div class="card-desc">{{ skill.description || '暂无描述' }}</div>
          </div>
          <div class="card-check">
            <el-icon
              v-if="skill.id && selectedSkills.includes(skill.id)"
              class="check-icon"
              size="20"
              ><CircleCheckFilled
            /></el-icon>
            <div v-else class="check-placeholder"></div>
          </div>
        </div>
        <el-empty v-if="filteredSkills.length === 0" description="未找到匹配的技能" />
      </div>
    </div>
    <template #footer>
      <div class="dialog-footer">
        <span class="selected-count">已选择 {{ selectedSkills.length }} 项</span>
        <div class="footer-actions">
          <el-button @click="showAddSkillDialog = false">取消</el-button>
          <el-button
            type="primary"
            @click="handleAddSkills"
            :disabled="selectedSkills.length === 0"
          >
            添加
          </el-button>
        </div>
      </div>
    </template>
  </el-dialog>
</template>

<style scoped lang="scss">
.resource-management {
  display: flex;
  height: 450px;
  border: 1px solid var(--el-border-color);
  border-radius: var(--el-border-radius-base);
  overflow: hidden;
}

.resource-tabs {
  width: 160px;
  background: var(--el-fill-color-light);
  border-right: 1px solid var(--el-border-color);
  padding: 8px;
}

.tab-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px;
  border-radius: var(--el-border-radius-base);
  cursor: pointer;
  transition: all 0.3s;
  margin-bottom: 4px;

  &:hover {
    background: var(--el-fill-color);
  }

  &.active {
    background: var(--primary-color, #cc1616);
    color: white;

    .tab-count {
      background: rgba(255, 255, 255, 0.3);
      color: white;
    }
  }
}

.tab-label {
  flex: 1;
  font-size: 14px;
}

.tab-count {
  min-width: 24px;
  text-align: center;
}

.resource-content {
  flex: 1;
  overflow: hidden;
}

.resource-panel {
  height: 100%;
  display: flex;
  flex-direction: column;
  padding: 16px;
}

.panel-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 16px;
}

.panel-title {
  font-size: 16px;
  font-weight: 500;
  color: var(--el-text-color-primary);
}

.resource-list {
  flex: 1;
  overflow-y: auto;
}

.resource-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px;
  border: 1px solid var(--el-border-color);
  border-radius: var(--el-border-radius-base);
  margin-bottom: 8px;

  &:hover {
    background: var(--el-fill-color-light);
  }
}

.resource-info {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.resource-name {
  font-weight: 500;
  color: var(--el-text-color-primary);
}

.resource-desc {
  font-size: 12px;
  color: var(--el-text-color-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.resource-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

// 添加对话框样式
.add-dialog-content {
  max-height: 450px;
  overflow-y: auto;
}

.search-bar {
  margin-bottom: 16px;

  :deep(.el-input__wrapper) {
    border-radius: 20px;
    padding-left: 12px;
  }
}

.resource-cards {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.resource-card {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 16px;
  border: 2px solid var(--el-border-color);
  border-radius: 12px;
  cursor: pointer;
  transition: all 0.3s ease;
  background: white;

  &:hover {
    border-color: var(--el-color-primary-light-5);
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.08);
    transform: translateY(-2px);
  }

  &.selected {
    border-color: var(--el-color-primary);
    background: var(--el-color-primary-light-9);
    box-shadow: 0 4px 12px rgba(204, 22, 22, 0.15);

    .card-icon {
      background: var(--el-color-primary);
      color: white;
    }
  }
}

.card-icon {
  width: 48px;
  height: 48px;
  border-radius: 12px;
  background: var(--el-fill-color-light);
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--el-color-primary);
  transition: all 0.3s ease;
  flex-shrink: 0;

  &.kb-icon {
    color: var(--el-color-success);
  }

  &.agent-icon {
    color: var(--el-color-warning);
  }

  &.skill-icon {
    color: var(--el-color-danger);
  }
}

.card-info {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.card-title {
  font-weight: 600;
  font-size: 15px;
  color: var(--el-text-color-primary);
}

.card-desc {
  font-size: 13px;
  color: var(--el-text-color-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.card-check {
  width: 28px;
  height: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.check-icon {
  color: var(--el-color-primary);
}

.check-placeholder {
  width: 20px;
  height: 20px;
  border: 2px solid var(--el-border-color);
  border-radius: 50%;
  transition: all 0.3s ease;
}

.resource-card:hover .check-placeholder {
  border-color: var(--el-color-primary-light-5);
}

.dialog-footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
  width: 100%;
}

.selected-count {
  font-size: 14px;
  color: var(--el-text-color-secondary);
}

.footer-actions {
  display: flex;
  gap: 12px;
}

// Checkbox styles (legacy)
.resource-checkbox-group {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.resource-checkbox {
  margin-right: 0;
  padding: 8px;
  border: 1px solid var(--el-border-color);
  border-radius: var(--el-border-radius-base);

  &:hover {
    background: var(--el-fill-color-light);
  }

  :deep(.el-checkbox__label) {
    flex: 1;
  }
}

.checkbox-content {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.checkbox-title {
  font-weight: 500;
  color: #303133;
}

.checkbox-desc {
  font-size: 12px;
  color: #909399;
}
</style>
