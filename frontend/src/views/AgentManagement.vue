<template>
  <div class="agent-management">
    <el-card class="main-card">
      <template #header>
        <div class="header">
          <div class="header-content">
            <h2 class="page-title">智能体管理</h2>
            <div class="header-actions">
              <el-button type="primary" @click="handleCreate" class="create-button">
                <el-icon><Plus /></el-icon>
                新建智能体
              </el-button>
            </div>
          </div>
        </div>
      </template>

      <!-- 搜索和筛选 -->
      <div class="filters">
        <el-input
          v-model="searchQuery"
          placeholder="搜索智能体名称或描述"
          clearable
          class="search-input"
          @clear="handleSearch"
          @keyup.enter="handleSearch"
        >
          <template #prefix>
            <el-icon><Search /></el-icon>
          </template>
        </el-input>

        <el-select
          v-model="statusFilter"
          placeholder="状态筛选"
          clearable
          class="status-filter"
          @change="handleSearch"
        >
          <el-option
            v-for="status in statusOptions"
            :key="status.value"
            :label="status.label"
            :value="status.value"
          />
        </el-select>

        <el-button type="primary" class="search-button" @click="handleSearch">
          <el-icon><Search /></el-icon>
          搜索
        </el-button>

        <el-button class="reset-button" @click="resetFilters"> 重置 </el-button>
      </div>

      <!-- 智能体列表 - 网格卡片布局 -->
      <div v-loading="agentStore.isLoading" class="agent-grid">
        <el-card
          v-for="agent in filteredAgents"
          :key="agent.id"
          class="agent-card"
          :class="{ 'is-draft': agent.status === 'draft' }"
          shadow="hover"
        >
          <div class="agent-card-header">
            <div class="agent-icon">
              <el-avatar :size="48" :src="agent.icon || undefined" class="agent-avatar">
                <el-icon :size="24"><Avatar /></el-icon>
              </el-avatar>
            </div>
            <div class="agent-info">
              <h3 class="agent-name">{{ agent.name }}</h3>
              <div class="agent-meta">
                <el-tag :type="getStatusType(agent.status)" size="small" class="status-tag">
                  {{ getStatusLabel(agent.status) }}
                </el-tag>
                <el-tag v-if="agent.a2aEndpoint" type="success" size="small" class="a2a-tag">
                  A2A
                </el-tag>
                <span class="agent-date">{{ formatDate(agent.updatedAt) }}</span>
              </div>
            </div>
          </div>

          <div class="agent-description">
            {{ agent.description || '暂无描述' }}
          </div>

          <div class="agent-actions">
            <el-button size="small" @click="handleExecute(agent)" class="execute-button">
              <el-icon><VideoPlay /></el-icon>
              执行
            </el-button>
            <el-dropdown @command="handleCommand" class="more-dropdown">
              <el-button size="small" class="more-button">
                更多<el-icon class="el-icon--right"><arrow-down /></el-icon>
              </el-button>
              <template #dropdown>
                <el-dropdown-menu>
                  <el-dropdown-item :command="{ action: 'edit', agent }" class="dropdown-item">
                    <el-icon><Edit /></el-icon>
                    编辑
                  </el-dropdown-item>
                  <el-dropdown-item :command="{ action: 'copy', agent }" class="dropdown-item">
                    <el-icon><CopyDocument /></el-icon>
                    复制
                  </el-dropdown-item>
                  <el-dropdown-item
                    :command="{ action: 'delete', agent }"
                    class="dropdown-item delete-item"
                    divided
                  >
                    <el-icon><Delete /></el-icon>
                    删除
                  </el-dropdown-item>
                </el-dropdown-menu>
              </template>
            </el-dropdown>
          </div>
        </el-card>

        <div v-if="filteredAgents.length === 0 && !agentStore.isLoading" class="no-agents">
          <el-empty description="暂无智能体">
            <el-button type="primary" @click="handleCreate" class="create-empty-button"
              >创建第一个智能体</el-button
            >
          </el-empty>
        </div>
      </div>

      <!-- 分页 -->
      <div class="pagination-container">
        <el-pagination
          v-model:current-page="pagination.currentPage"
          v-model:page-size="pagination.pageSize"
          :total="agentStore.totalAgents"
          :page-sizes="[8, 16, 32, 64]"
          layout="total, sizes, prev, pager, next, jumper"
          @size-change="handleSizeChange"
          @current-change="handleCurrentChange"
          background
        />
      </div>
    </el-card>

    <!-- 新建智能体弹窗 -->
    <el-dialog
      v-model="createDialogVisible"
      title="新建智能体"
      width="600px"
      :before-close="handleCreateDialogClose"
    >
      <el-form ref="createFormRef" :model="createForm" :rules="createRules" label-width="100px">
        <el-form-item label="名称" prop="name">
          <el-input v-model="createForm.name" placeholder="请输入智能体名称" clearable />
        </el-form-item>
        <el-form-item label="描述" prop="description">
          <el-input
            v-model="createForm.description"
            type="textarea"
            :rows="3"
            placeholder="请输入智能体描述"
            show-word-limit
            maxlength="200"
          />
        </el-form-item>
        <el-form-item label="状态" prop="status">
          <el-select v-model="createForm.status" placeholder="请选择状态" style="width: 100%">
            <el-option
              v-for="status in statusOptions"
              :key="status.value"
              :label="status.label"
              :value="status.value"
            />
          </el-select>
        </el-form-item>
        <el-form-item label="模式" prop="mode">
          <el-radio-group v-model="createForm.mode">
            <el-radio label="general">普通模式</el-radio>
            <el-radio label="deep">DeepAgent（深度编排）</el-radio>
          </el-radio-group>
        </el-form-item>

        <!-- DeepAgent 配置 -->
        <template v-if="createForm.mode === 'deep'">
          <el-divider>DeepAgent 配置</el-divider>
          <el-form-item label="最大迭代" prop="deepConfig.max_iterations">
            <el-input-number v-model="createForm.deepConfig.max_iterations" :min="1" :max="200" />
          </el-form-item>
          <el-form-item label="待办管理" prop="deepConfig.enable_todos">
            <el-switch v-model="createForm.deepConfig.enable_todos" />
          </el-form-item>
          <el-form-item label="子 Agent" prop="deepConfig.sub_agent_ids">
            <div class="sub-agents-display">
              <!-- 已选择的子智能体标签 -->
              <div v-if="selectedSubAgents.length > 0" class="selected-sub-agents">
                <el-tag
                  v-for="subAgent in selectedSubAgents"
                  :key="subAgent.id"
                  closable
                  type="success"
                  effect="light"
                  class="sub-agent-tag"
                  @close="removeSubAgent(subAgent.id)"
                >
                  {{ subAgent.name }}
                </el-tag>
              </div>
              <div v-else class="no-sub-agents">
                <el-text type="info">暂未选择子 Agent</el-text>
              </div>
              <el-button
                type="primary"
                size="small"
                @click="openSubAgentSelectionDialog"
                class="select-sub-agent-btn"
              >
                <el-icon><Plus /></el-icon>
                选择子 Agent
              </el-button>
            </div>
          </el-form-item>
          <el-form-item label="任务描述" prop="deepConfig.task_description">
            <el-input
              v-model="createForm.deepConfig.task_description"
              type="textarea"
              :rows="2"
              placeholder="任务描述模板（可选）"
              show-word-limit
              maxlength="500"
            />
          </el-form-item>
        </template>
      </el-form>
      <template #footer>
        <span class="dialog-footer">
          <el-button @click="handleCreateDialogClose">取消</el-button>
          <el-button type="primary" @click="handleCreateConfirm" :loading="isCreating">
            确认创建
          </el-button>
        </span>
      </template>
    </el-dialog>

    <!-- 子智能体选择弹框 -->
    <SubAgentSelectionDialog
      v-model:visible="subAgentSelectionVisible"
      :initial-selected-ids="createForm.deepConfig.sub_agent_ids"
      @confirm="handleSubAgentSelectionConfirm"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import type { FormInstance, FormRules } from 'element-plus'
import {
  Search,
  Plus,
  Avatar,
  ArrowDown,
  VideoPlay,
  Edit,
  CopyDocument,
  Delete,
  Connection,
  InfoFilled,
} from '@element-plus/icons-vue'
import { useAgentStore } from '@/stores/agentStore'
import type { Agent } from '@/types/agent'
import { AgentService } from '@/api/agentService'
import { v4 as uuidv4 } from 'uuid'
import SubAgentSelectionDialog from '@/components/dialogs/SubAgentSelectionDialog.vue'

const router = useRouter()
const agentStore = useAgentStore()

// 搜索和筛选
const searchQuery = ref('')
const statusFilter = ref('')
const statusOptions = [
  { label: '草稿', value: 'draft' },
  { label: '测试中', value: 'testing' },
  { label: '已发布', value: 'published' },
  { label: '已归档', value: 'archived' },
]

// 分页
const pagination = ref({
  currentPage: 1,
  pageSize: 8,
})

// 新建智能体弹窗相关
const createDialogVisible = ref(false)
const createFormRef = ref<FormInstance>()
const isCreating = ref(false)

// 新建智能体表单数据
const createForm = ref({
  name: '',
  description: '',
  status: 'draft',
  mode: 'general' as 'general' | 'deep',
  deepConfig: {
    max_iterations: 10,
    enable_todos: true,
    sub_agent_ids: [] as string[], // 子 Agent ID 列表
    task_description: '', // 任务描述模板
  },
})

// 新建智能体表单验证规则
const createRules = ref<FormRules>({
  name: [
    { required: true, message: '请输入智能体名称', trigger: 'blur' },
    { min: 1, max: 50, message: '长度应在1到50个字符之间', trigger: 'blur' },
  ],
  description: [{ max: 200, message: '长度不能超过200个字符', trigger: 'blur' }],
  status: [{ required: true, message: '请选择状态', trigger: 'change' }],
  mode: [{ required: true, message: '请选择模式', trigger: 'change' }],
})

// 子智能体选择弹框相关
const subAgentSelectionVisible = ref(false)
const selectedSubAgents = ref<Agent[]>([])

// 打开子智能体选择弹框
const openSubAgentSelectionDialog = () => {
  subAgentSelectionVisible.value = true
}

// 处理子智能体选择确认
const handleSubAgentSelectionConfirm = (selectedIds: string[]) => {
  createForm.value.deepConfig.sub_agent_ids = selectedIds
  // 加载选中的子智能体信息用于显示
  loadSelectedSubAgentsInfo(selectedIds)
}

// 加载已选子智能体的信息
const loadSelectedSubAgentsInfo = async (ids: string[]) => {
  if (!ids || ids.length === 0) {
    selectedSubAgents.value = []
    return
  }
  try {
    const agents: Agent[] = []
    for (const id of ids) {
      try {
        const agent = await AgentService.getAgent(id)
        agents.push(agent)
      } catch (e) {
        console.error(`加载智能体 ${id} 失败:`, e)
      }
    }
    selectedSubAgents.value = agents
  } catch (error) {
    console.error('加载子智能体信息失败:', error)
  }
}

// 移除子智能体
const removeSubAgent = (id: string) => {
  createForm.value.deepConfig.sub_agent_ids = createForm.value.deepConfig.sub_agent_ids.filter(
    (subId) => subId !== id,
  )
  selectedSubAgents.value = selectedSubAgents.value.filter((agent) => agent.id !== id)
}

// 计算属性：可用于选择的子 Agent 列表（排除当前正在创建的）
const availableSubAgents = computed(() => {
  return agentStore.agents.filter((agent) => agent.status !== 'archived')
})

// 计算属性
const filteredAgents = computed(() => agentStore.agents)

// 方法
const loadAgents = async () => {
  await agentStore.loadAgents({
    name: searchQuery.value,
    status: statusFilter.value,
    page: pagination.value.currentPage,
    pageSize: pagination.value.pageSize,
  })
}

const handleSearch = () => {
  pagination.value.currentPage = 1
  loadAgents()
}

const resetFilters = () => {
  searchQuery.value = ''
  statusFilter.value = ''
  pagination.value.currentPage = 1
  loadAgents()
}

const handleSizeChange = (size: number) => {
  pagination.value.pageSize = size
  loadAgents()
}

const handleCurrentChange = (page: number) => {
  pagination.value.currentPage = page
  loadAgents()
}

// 新建智能体
const handleCreate = () => {
  // 重置表单
  createForm.value = {
    name: '',
    description: '',
    status: 'draft',
    mode: 'general',
    deepConfig: {
      max_iterations: 10,
      enable_todos: true,
      sub_agent_ids: [],
      task_description: '',
    },
  }
  // 显示弹窗
  createDialogVisible.value = true
}

// 关闭新建弹窗
const handleCreateDialogClose = () => {
  createDialogVisible.value = false
  // 重置表单验证
  if (createFormRef.value) {
    createFormRef.value.resetFields()
  }
}

// 确认创建智能体
const handleCreateConfirm = async () => {
  if (!createFormRef.value) return

  await createFormRef.value.validate(async (valid) => {
    if (valid) {
      isCreating.value = true
      try {
        // 统一使用 /v1/agents/create 接口创建 Agent
        const agentData: any = {
          name: createForm.value.name,
          description: createForm.value.description,
          status: createForm.value.status as 'draft' | 'published' | 'archived',
          mode: createForm.value.mode,
        }

        // DeepAgent 模式添加 deepConfig
        if (createForm.value.mode === 'deep') {
          agentData.deepConfig = {
            max_iterations: createForm.value.deepConfig.max_iterations,
            enable_todos: createForm.value.deepConfig.enable_todos,
            sub_agent_ids:
              createForm.value.deepConfig.sub_agent_ids.length > 0
                ? createForm.value.deepConfig.sub_agent_ids
                : undefined,
            task_description: createForm.value.deepConfig.task_description || undefined,
          }
        }

        await AgentService.createAgent(agentData)

        // 关闭弹窗
        handleCreateDialogClose()

        // 显示成功消息
        ElMessage.success('智能体创建成功')

        // 重新加载智能体列表
        await loadAgents()
      } catch (error) {
        console.error('创建智能体失败:', error)
        ElMessage.error('创建智能体失败: ' + (error instanceof Error ? error.message : '未知错误'))
      } finally {
        isCreating.value = false
      }
    }
  })
}

const handleEdit = (agent: Agent) => {
  router.push(`/agents/${agent.id}/edit`)
}

const handleExecute = (agent: Agent) => {
  // 统一跳转到 Agent 执行页面（DeepAgent 和普通 Agent 共用）
  router.push(`/agents/${agent.id}/execute`)
}

const handleCommand = async (command: { action: string; agent: Agent }) => {
  const { action, agent } = command

  switch (action) {
    case 'edit':
      handleEdit(agent)
      break
    case 'copy':
      // 复制智能体逻辑
      ElMessage.info('复制功能待实现')
      break
    case 'delete':
      try {
        await ElMessageBox.confirm(
          `确定要删除智能体 "${agent.name}" 吗？此操作不可撤销。`,
          '确认删除',
          {
            type: 'warning',
          },
        )
        await agentStore.deleteAgent(agent.id.toString())
        ElMessage.success('删除成功')
        loadAgents()
      } catch (error) {
        if (error !== 'cancel') {
          ElMessage.error('删除失败')
        }
      }
      break
  }
}

const getStatusType = (status: string) => {
  switch (status) {
    case 'draft':
      return 'info'
    case 'testing':
      return 'warning'
    case 'published':
      return 'success'
    case 'archived':
      return 'danger'
    default:
      return 'info'
  }
}

const getStatusLabel = (status: string) => {
  return statusOptions.find((opt) => opt.value === status)?.label || status
}

const formatDate = (dateString: string) => {
  const date = new Date(dateString)
  return date.toLocaleDateString('zh-CN')
}

// 生命周期
onMounted(() => {
  loadAgents()
})

// 监听路由变化，重新加载数据
watch(
  () => router.currentRoute.value,
  () => {
    loadAgents()
  },
)
</script>

<style scoped>
.agent-management {
  padding: var(--spacing-base);
  background-color: var(--background-color);
  min-height: calc(100vh - var(--header-height) - var(--footer-height));
}

.main-card {
  border-radius: var(--border-radius-medium);
  box-shadow: var(--box-shadow-card);
  border: 1px solid var(--border-color-light);
  overflow: hidden;
}

.main-card :deep(.el-card__header) {
  padding: 0;
  border-bottom: 1px solid var(--border-color-light);
}

.header {
  padding: var(--spacing-base) var(--spacing-large);
}

.header-content {
  display: flex;
  justify-content: space-between;
  align-items: center;
  flex-wrap: wrap;
  gap: var(--spacing-base);
}

.page-title {
  margin: 0;
  font-size: var(--font-size-h2);
  color: var(--text-primary);
  font-weight: 600;
}

.filters {
  display: flex;
  align-items: center;
  padding: var(--spacing-base) var(--spacing-large);
  flex-wrap: wrap;
  gap: var(--spacing-small);
  background-color: var(--background-color-light);
  border-bottom: 1px solid var(--border-color-light);
}

.search-input {
  width: 300px;
}

.status-filter {
  width: 120px;
}

.search-button,
.reset-button {
  border-radius: var(--border-radius-base);
}

.agent-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
  gap: var(--spacing-base);
  padding: var(--spacing-base);
}

.agent-card {
  transition: var(--transition-all);
  border: 1px solid var(--border-color-light);
  border-radius: var(--border-radius-medium);
  overflow: hidden;
  background: var(--background-color-white);
}

.agent-card:hover {
  transform: translateY(-5px);
  box-shadow: var(--box-shadow-hover);
  border-color: var(--primary-color-light);
}

.agent-card.is-draft {
  opacity: 0.8;
}

.agent-card-header {
  display: flex;
  padding: var(--spacing-base);
  border-bottom: 1px solid var(--border-color-light);
}

.agent-icon {
  margin-right: var(--spacing-small);
}

.agent-avatar {
  background-color: var(--background-color);
}

.agent-info {
  flex: 1;
  min-width: 0;
}

.agent-name {
  margin: 0 0 8px 0;
  font-size: var(--font-size-medium);
  font-weight: 600;
  color: var(--text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.agent-meta {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 5px;
  flex-wrap: wrap;
}

.status-tag,
.a2a-tag {
  border-radius: var(--border-radius-small);
}

.agent-date {
  font-size: var(--font-size-small);
  color: var(--text-secondary);
}

.agent-description {
  padding: var(--spacing-base);
  color: var(--text-regular);
  font-size: var(--font-size-base);
  line-height: 1.6;
  min-height: 80px;
}

.agent-actions {
  display: flex;
  gap: var(--spacing-small);
  padding: var(--spacing-base);
  border-top: 1px solid var(--border-color-light);
  justify-content: flex-end;
}

.execute-button,
.more-button {
  border-radius: var(--border-radius-base);
}

.more-dropdown {
  display: flex;
}

.dropdown-item {
  display: flex;
  align-items: center;
  gap: var(--spacing-mini);
}

.delete-item {
  color: var(--danger-color);
}

.delete-item :deep(.el-dropdown-menu__item:hover) {
  background-color: var(--el-color-danger-light-9);
}

.create-empty-button {
  border-radius: var(--border-radius-base);
}

.pagination-container {
  display: flex;
  justify-content: flex-end;
  padding: var(--spacing-base);
  border-top: 1px solid var(--border-color-light);
}

:deep(.el-pagination) {
  padding: 0;
}

/* 响应式设计 */
@media (max-width: 992px) {
  .agent-grid {
    grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  }

  .search-input {
    width: 240px;
  }
}

@media (max-width: 768px) {
  .header-content {
    flex-direction: column;
    align-items: stretch;
  }

  .filters {
    flex-direction: column;
    align-items: stretch;
  }

  .search-input,
  .status-filter {
    width: 100%;
  }

  .agent-grid {
    grid-template-columns: 1fr;
  }

  .agent-card {
    max-width: 100%;
  }
}

/* DeepAgent 配置样式 */
.sub-agents-section {
  width: 100%;
}

.sub-agent-item {
  background: var(--background-color-light);
  border: 1px solid var(--border-color-light);
  border-radius: var(--border-radius-base);
  padding: var(--spacing-base);
  margin-bottom: var(--spacing-small);
}

.sub-agent-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: var(--spacing-small);
}

.sub-agent-title {
  font-weight: 600;
  color: var(--text-primary);
}

.mb-2 {
  margin-bottom: 8px;
}

.add-sub-agent-btn {
  width: 100%;
  margin-top: var(--spacing-small);
}

/* 子 Agent 选择器样式 */
.sub-agent-option {
  display: flex;
  flex-direction: column;
  padding: 4px 0;
}

.sub-agent-name {
  font-weight: 500;
  color: var(--text-primary);
}

.sub-agent-desc {
  font-size: 12px;
  color: var(--text-secondary);
  margin-top: 2px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.sub-agent-hint {
  display: flex;
  align-items: center;
  gap: 4px;
  margin-top: 8px;
  font-size: 12px;
  color: var(--text-secondary);
}

.sub-agent-hint .el-icon {
  font-size: 14px;
}

/* 子智能体显示区域样式 */
.sub-agents-display {
  width: 100%;
}

.selected-sub-agents {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 12px;
  min-height: 32px;
  padding: 8px;
  background-color: var(--el-fill-color-light);
  border-radius: 4px;
  border: 1px solid var(--el-border-color-light);
}

.sub-agent-tag {
  margin: 0;
}

.no-sub-agents {
  padding: 12px 8px;
  margin-bottom: 12px;
  background-color: var(--el-fill-color-light);
  border-radius: 4px;
  border: 1px dashed var(--el-border-color);
  text-align: center;
}

.select-sub-agent-btn {
  width: 100%;
}
</style>
