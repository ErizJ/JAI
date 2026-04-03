<template>
  <el-dialog
    v-model="dialogVisible"
    title="选择子智能体"
    width="700px"
    :before-close="handleClose"
    class="sub-agent-selection-dialog"
  >
    <div class="dialog-content">
      <!-- 搜索框 -->
      <div class="search-section">
        <el-input
          v-model="searchQuery"
          placeholder="搜索智能体名称或描述"
          clearable
          @keyup.enter="handleSearch"
        >
          <template #prefix>
            <el-icon><Search /></el-icon>
          </template>
        </el-input>
        <el-button type="primary" @click="handleSearch">搜索</el-button>
      </div>

      <!-- 已选择提示 -->
      <div class="selected-info" v-if="selectedIds.length > 0">
        <el-tag type="success" effect="light"> 已选择 {{ selectedIds.length }} 个子智能体 </el-tag>
      </div>

      <!-- 智能体列表 -->
      <div class="agent-list" v-loading="loading">
        <el-table
          :data="agents"
          max-height="400"
          @selection-change="handleSelectionChange"
          ref="tableRef"
          row-key="id"
        >
          <el-table-column type="selection" width="55" :reserve-selection="true" />
          <el-table-column label="智能体名称" min-width="180">
            <template #default="{ row }">
              <div class="agent-info">
                <el-avatar :size="32" :src="row.icon || undefined" class="agent-avatar">
                  <el-icon :size="16"><Avatar /></el-icon>
                </el-avatar>
                <div class="agent-name-section">
                  <span class="agent-name">{{ row.name }}</span>
                  <el-tag v-if="row.id === excludeAgentId" type="info" size="small">当前</el-tag>
                  <el-tag v-else-if="row.status === 'archived'" type="danger" size="small"
                    >已归档</el-tag
                  >
                </div>
              </div>
            </template>
          </el-table-column>
          <el-table-column label="描述" min-width="200">
            <template #default="{ row }">
              <span class="agent-description">
                {{ row.description || '暂无描述' }}
              </span>
            </template>
          </el-table-column>
          <el-table-column label="状态" width="80">
            <template #default="{ row }">
              <el-tag :type="getStatusType(row.status)" size="small">
                {{ getStatusLabel(row.status) }}
              </el-tag>
            </template>
          </el-table-column>
        </el-table>
      </div>

      <!-- 分页 -->
      <div class="pagination-section">
        <el-pagination
          v-model:current-page="pagination.currentPage"
          v-model:page-size="pagination.pageSize"
          :total="total"
          :page-sizes="[10, 20, 50]"
          layout="total, sizes, prev, pager, next"
          @size-change="handleSizeChange"
          @current-change="handleCurrentChange"
          background
        />
      </div>
    </div>

    <template #footer>
      <span class="dialog-footer">
        <el-button @click="handleClose">取消</el-button>
        <el-button type="primary" @click="handleSubmit" :loading="submitting">
          确认选择 ({{ selectedIds.length }})
        </el-button>
      </span>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, nextTick } from 'vue'
import { ElMessage } from 'element-plus'
import { Search, Avatar } from '@element-plus/icons-vue'
import type { Agent } from '@/types/agent'
import { AgentService } from '@/api/agentService'

const props = defineProps<{
  visible: boolean
  excludeAgentId?: string // 需要排除的智能体ID（当前正在编辑的智能体）
  initialSelectedIds?: string[] // 初始已选择的智能体ID列表
}>()

const emit = defineEmits<{
  (e: 'update:visible', visible: boolean): void
  (e: 'confirm', selectedIds: string[]): void
  (e: 'cancel'): void
}>()

// 本地对话框可见性
const dialogVisible = ref(props.visible)

// 监听 prop 变化
watch(
  () => props.visible,
  (newVal) => {
    dialogVisible.value = newVal
    if (newVal) {
      // 打开弹窗时初始化
      initSelection()
      loadAgents()
    }
  },
)

watch(dialogVisible, (newVal) => {
  if (newVal !== props.visible) {
    emit('update:visible', newVal)
  }
})

// 表格引用
const tableRef = ref()

// 状态
const loading = ref(false)
const submitting = ref(false)
const isRestoringSelection = ref(false) // 标志位：是否正在恢复选择状态
const searchQuery = ref('')
const agents = ref<Agent[]>([])
const selectedAgents = ref<Agent[]>([])
const total = ref(0)

// 分页
const pagination = ref({
  currentPage: 1,
  pageSize: 10,
})

// 已选择的ID列表
const selectedIds = computed(() => {
  return selectedAgents.value.map((agent) => agent.id)
})

// 状态选项
const statusOptions = [
  { value: 'draft', label: '草稿', type: 'info' as const },
  { value: 'testing', label: '测试中', type: 'warning' as const },
  { value: 'published', label: '已发布', type: 'success' as const },
  { value: 'archived', label: '已归档', type: 'danger' as const },
]

// 获取状态类型
const getStatusType = (status: string): 'info' | 'warning' | 'success' | 'danger' => {
  const found = statusOptions.find((opt) => opt.value === status)
  return found?.type || 'info'
}

// 获取状态标签
const getStatusLabel = (status: string) => {
  return statusOptions.find((opt) => opt.value === status)?.label || status
}

// 初始化选择状态
const initSelection = async () => {
  // 等待表格渲染完成
  await nextTick()

  // 清除之前的选择（避免残留）
  tableRef.value?.clearSelection()

  // 先根据 initialSelectedIds 初始化 selectedAgents
  if (props.initialSelectedIds && props.initialSelectedIds.length > 0) {
    selectedAgents.value = props.initialSelectedIds.map((id) => ({ id }) as Agent)
  } else {
    selectedAgents.value = []
  }
}

// 加载智能体列表
const loadAgents = async () => {
  try {
    loading.value = true
    const response = await AgentService.getAgents({
      name: searchQuery.value,
      status: '',
      page: pagination.value.currentPage,
      pageSize: pagination.value.pageSize,
    })

    agents.value = response.agents || []
    total.value = response.total || 0

    // 在数据加载后，恢复已选择的状态
    await nextTick()
    restoreSelection()
  } catch (error) {
    console.error('加载智能体列表失败:', error)
    ElMessage.error('加载智能体列表失败')
  } finally {
    loading.value = false
  }
}

// 恢复选择状态
const restoreSelection = () => {
  if (!tableRef.value || !agents.value.length) return

  console.log('[restoreSelection] 开始恢复选择状态')
  console.log(
    '[restoreSelection] 当前页智能体:',
    agents.value.map((a) => a.id),
  )
  console.log(
    '[restoreSelection] 已选择的智能体:',
    selectedAgents.value.map((a) => a.id),
  )

  // 设置标志位，防止 handleSelectionChange 处理
  isRestoringSelection.value = true

  // 先获取当前已勾选的所有行
  const currentSelectedRows = tableRef.value.getSelectionRows() as Agent[]
  console.log(
    '[restoreSelection] 当前表格已勾选:',
    currentSelectedRows.map((a) => a.id),
  )

  // 遍历当前页的所有智能体，根据 selectedAgents 设置勾选状态
  agents.value.forEach((agent) => {
    const shouldBeSelected = selectedAgents.value.some((selected) => selected.id === agent.id)
    const isCurrentlySelected = currentSelectedRows.some((row) => row.id === agent.id)

    if (shouldBeSelected && !isCurrentlySelected) {
      // 需要勾选但当前未勾选
      console.log(`[restoreSelection] 勾选智能体: ${agent.id}`)
      tableRef.value.toggleRowSelection(agent, true)
    } else if (!shouldBeSelected && isCurrentlySelected) {
      // 不需要勾选但当前已勾选（这种情况不应该发生，但以防万一）
      console.log(`[restoreSelection] 取消勾选智能体: ${agent.id}`)
      tableRef.value.toggleRowSelection(agent, false)
    }
  })

  // 将表格中勾选的数据同步到 selectedAgents（用完整对象替换只有id的对象）
  const updatedSelectedRows = tableRef.value.getSelectionRows() as Agent[]
  updatedSelectedRows.forEach((row) => {
    const index = selectedAgents.value.findIndex((s) => s.id === row.id)
    if (index !== -1) {
      // 用完整对象替换只有 id 的对象
      selectedAgents.value[index] = row
    }
  })

  console.log(
    '[restoreSelection] 恢复完成，最终已选择:',
    selectedAgents.value.map((a) => a.id),
  )

  // 重置标志位
  isRestoringSelection.value = false
}

// 搜索
const handleSearch = () => {
  pagination.value.currentPage = 1
  loadAgents()
}

// 分页大小变化
const handleSizeChange = (size: number) => {
  pagination.value.pageSize = size
  loadAgents()
}

// 页码变化
const handleCurrentChange = (page: number) => {
  pagination.value.currentPage = page
  loadAgents()
}

// 选择变化
const handleSelectionChange = (selection: Agent[]) => {
  // 如果正在恢复选择状态，跳过处理
  if (isRestoringSelection.value) {
    console.log('[handleSelectionChange] 正在恢复选择状态，跳过处理')
    return
  }

  console.log(
    '[handleSelectionChange] 选择变化:',
    selection.map((a) => a.id),
  )

  // 更新当前页的选中状态
  const currentPageIds = agents.value.map((a) => a.id)

  // 移除当前页已取消选择的
  selectedAgents.value = selectedAgents.value.filter(
    (agent) => !currentPageIds.includes(agent.id) || selection.some((s) => s.id === agent.id),
  )

  // 添加新选择的（排除当前正在编辑的智能体）
  selection.forEach((agent) => {
    if (agent.id !== props.excludeAgentId && !selectedAgents.value.some((s) => s.id === agent.id)) {
      selectedAgents.value.push(agent)
    }
  })

  console.log(
    '[handleSelectionChange] 更新后已选择:',
    selectedAgents.value.map((a) => a.id),
  )
}

// 关闭对话框
const handleClose = () => {
  dialogVisible.value = false
  emit('cancel')
  resetForm()
}

// 重置表单
const resetForm = () => {
  searchQuery.value = ''
  // 不清除 selectedAgents，因为下次打开时会根据 initialSelectedIds 重新初始化
  // 这样可以避免在关闭对话框时丢失已选择的状态
  pagination.value.currentPage = 1
  pagination.value.pageSize = 10
  total.value = 0
}

// 提交选择
const handleSubmit = async () => {
  try {
    submitting.value = true
    emit('confirm', selectedIds.value)
    handleClose()
  } catch (error) {
    console.error('选择子智能体时出错:', error)
    ElMessage.error('操作失败')
  } finally {
    submitting.value = false
  }
}

// 组件挂载
onMounted(() => {
  if (props.visible) {
    initSelection()
    loadAgents()
  }
})

// 监听初始选择ID变化
watch(
  () => props.initialSelectedIds,
  (newIds) => {
    if (newIds && newIds.length > 0) {
      // 初始ID变化时，需要重新加载这些智能体的信息
      // 这里简化处理，只保留ID，实际显示时再加载详情
      selectedAgents.value = newIds.map((id) => ({ id }) as Agent)
    } else {
      selectedAgents.value = []
    }
  },
  { immediate: true },
)
</script>

<style scoped>
.dialog-content {
  padding: 0;
}

.search-section {
  display: flex;
  gap: 12px;
  margin-bottom: 16px;
}

.search-section .el-input {
  flex: 1;
}

.selected-info {
  margin-bottom: 12px;
}

.agent-list {
  margin-bottom: 16px;
  border: 1px solid var(--el-border-color-light);
  border-radius: 4px;
}

.agent-info {
  display: flex;
  align-items: center;
  gap: 8px;
}

.agent-avatar {
  background-color: var(--el-color-primary-light-9);
  flex-shrink: 0;
}

.agent-name-section {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.agent-name {
  font-weight: 500;
}

.agent-description {
  color: var(--el-text-color-secondary);
  font-size: 12px;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.pagination-section {
  display: flex;
  justify-content: flex-end;
  padding-top: 16px;
  border-top: 1px solid var(--el-border-color-light);
}

.dialog-footer {
  display: flex;
  gap: 12px;
}
</style>
