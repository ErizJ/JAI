<script setup lang="ts">
import { ref, onMounted, computed } from 'vue'
import { useSkillStore } from '@/stores/skillStore'
import type { Skill } from '@/types/skill'

const props = defineProps<{
  visible: boolean
  agentId: string
}>()

const emit = defineEmits<{
  'update:visible': [value: boolean]
  confirm: [skillIds: string[]]
}>()

const skillStore = useSkillStore()

// ==================== State ====================
const selectedSkillIds = ref<string[]>([])

// ==================== Computed ====================
const availableSkills = computed(() => {
  // 只显示 active 状态的技能
  return skillStore.activeSkills
})

const isSelected = computed(() => (skillId: string) => {
  return selectedSkillIds.value.includes(skillId)
})

// ==================== Methods ====================
async function loadSkills() {
  await skillStore.fetchAllSkills()
  // 如果有 agentId，加载已关联的技能
  if (props.agentId) {
    await skillStore.fetchAgentSkills(props.agentId)
    selectedSkillIds.value = [...skillStore.getAgentSkillIds]
  }
}

function toggleSkill(skillId: string) {
  const index = selectedSkillIds.value.indexOf(skillId)
  if (index > -1) {
    selectedSkillIds.value.splice(index, 1)
  } else {
    selectedSkillIds.value.push(skillId)
  }
}

function selectAll() {
  selectedSkillIds.value = availableSkills.value.map((s) => s.id)
}

function deselectAll() {
  selectedSkillIds.value = []
}

function handleConfirm() {
  emit('confirm', selectedSkillIds.value)
  emit('update:visible', false)
}

function handleCancel() {
  emit('update:visible', false)
}

function formatDate(timestamp: number): string {
  return new Date(timestamp).toLocaleDateString('zh-CN')
}

// ==================== Lifecycle ====================
onMounted(() => {
  if (props.visible) {
    loadSkills()
  }
})
</script>

<template>
  <div v-if="visible" class="dialog-overlay" @click.self="handleCancel">
    <div class="dialog dialog-lg">
      <div class="dialog-header">
        <div class="header-left">
          <h3>选择技能</h3>
          <span class="subtitle">已选择 {{ selectedSkillIds.length }} 个技能</span>
        </div>
        <button class="btn-close" @click="handleCancel">×</button>
      </div>

      <div class="dialog-body">
        <!-- 工具栏 -->
        <div class="toolbar">
          <div class="toolbar-left">
            <button class="btn btn-sm btn-secondary" @click="selectAll">全选</button>
            <button class="btn btn-sm btn-secondary" @click="deselectAll">取消全选</button>
          </div>
          <div class="toolbar-right">
            <span class="text-muted">{{ availableSkills.length }} 个可用技能</span>
          </div>
        </div>

        <!-- 技能列表 -->
        <div v-if="skillStore.loading" class="loading-state">
          <div class="spinner"></div>
          <p>加载中...</p>
        </div>

        <div v-else-if="availableSkills.length === 0" class="empty-state">
          <div class="empty-icon">📦</div>
          <h4>暂无可用技能</h4>
          <p>请先前往技能市场创建技能</p>
        </div>

        <div v-else class="skill-list">
          <div
            v-for="skill in availableSkills"
            :key="skill.id"
            class="skill-item"
            :class="{ selected: isSelected(skill.id) }"
            @click="toggleSkill(skill.id)"
          >
            <div class="checkbox">
              <input type="checkbox" :checked="isSelected(skill.id)" @click.stop />
              <span class="checkmark"></span>
            </div>

            <div class="skill-info">
              <div class="skill-header">
                <span class="skill-icon">🛠️</span>
                <span class="skill-name">{{ skill.name }}</span>
              </div>
              <p class="skill-description">{{ skill.description || '暂无描述' }}</p>
              <div class="skill-meta">
                <code class="skill-path">{{ skill.baseDir }}</code>
                <span class="skill-date">创建于 {{ formatDate(skill.createdAt) }}</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div class="dialog-footer">
        <button class="btn btn-secondary" @click="handleCancel">取消</button>
        <button class="btn btn-primary" @click="handleConfirm">
          确认选择 ({{ selectedSkillIds.length }})
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped lang="scss">
.dialog-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
  padding: 20px;
}

.dialog {
  background: white;
  border-radius: 12px;
  width: 100%;
  max-width: 600px;
  max-height: 80vh;
  overflow: hidden;
  box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.1);
  display: flex;
  flex-direction: column;

  &.dialog-lg {
    max-width: 700px;
  }
}

.dialog-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 20px;
  border-bottom: 1px solid #e5e7eb;

  .header-left {
    display: flex;
    align-items: baseline;
    gap: 12px;

    h3 {
      font-size: 18px;
      font-weight: 600;
      margin: 0;
      color: #1a1a2e;
    }

    .subtitle {
      font-size: 14px;
      color: #6b7280;
    }
  }

  .btn-close {
    background: none;
    border: none;
    font-size: 24px;
    color: #9ca3af;
    cursor: pointer;
    line-height: 1;

    &:hover {
      color: #374151;
    }
  }
}

.dialog-body {
  flex: 1;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  padding: 16px;
}

.dialog-footer {
  display: flex;
  justify-content: flex-end;
  gap: 12px;
  padding: 16px 20px;
  border-top: 1px solid #e5e7eb;
  background: #f9fafb;
}

// 工具栏
.toolbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 16px;
  padding-bottom: 16px;
  border-bottom: 1px solid #e5e7eb;

  .toolbar-left {
    display: flex;
    gap: 8px;
  }

  .text-muted {
    font-size: 14px;
    color: #6b7280;
  }
}

// 技能列表
.skill-list {
  flex: 1;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.skill-item {
  display: flex;
  gap: 12px;
  padding: 16px;
  border: 2px solid #e5e7eb;
  border-radius: 10px;
  cursor: pointer;
  transition: all 0.2s;

  &:hover {
    border-color: #3b82f6;
    background: #f8fafc;
  }

  &.selected {
    border-color: #3b82f6;
    background: #eff6ff;
  }
}

.checkbox {
  position: relative;
  flex-shrink: 0;
  width: 20px;
  height: 20px;

  input {
    position: absolute;
    opacity: 0;
    cursor: pointer;
  }

  .checkmark {
    position: absolute;
    top: 0;
    left: 0;
    width: 20px;
    height: 20px;
    border: 2px solid #d1d5db;
    border-radius: 4px;
    transition: all 0.2s;

    &:after {
      content: '';
      position: absolute;
      display: none;
      left: 6px;
      top: 2px;
      width: 4px;
      height: 9px;
      border: solid white;
      border-width: 0 2px 2px 0;
      transform: rotate(45deg);
    }
  }

  input:checked ~ .checkmark {
    background: #3b82f6;
    border-color: #3b82f6;

    &:after {
      display: block;
    }
  }
}

.skill-info {
  flex: 1;
  min-width: 0;
}

.skill-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 6px;

  .skill-icon {
    font-size: 18px;
  }

  .skill-name {
    font-weight: 600;
    color: #1a1a2e;
    font-size: 15px;
  }
}

.skill-description {
  font-size: 13px;
  color: #6b7280;
  margin: 0 0 8px 0;
  line-height: 1.4;
}

.skill-meta {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;

  .skill-path {
    font-size: 11px;
    color: #4b5563;
    background: #f3f4f6;
    padding: 2px 8px;
    border-radius: 4px;
    font-family: monospace;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    flex: 1;
  }

  .skill-date {
    font-size: 11px;
    color: #9ca3af;
    flex-shrink: 0;
  }
}

// 按钮
.btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 10px 20px;
  border-radius: 8px;
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s;
  border: none;

  &.btn-primary {
    background: #3b82f6;
    color: white;

    &:hover {
      background: #2563eb;
    }
  }

  &.btn-secondary {
    background: #f3f4f6;
    color: #374151;

    &:hover {
      background: #e5e7eb;
    }
  }

  &.btn-sm {
    padding: 6px 12px;
    font-size: 13px;
  }
}

// 加载状态
.loading-state {
  text-align: center;
  padding: 60px 20px;

  .spinner {
    width: 40px;
    height: 40px;
    border: 3px solid #e5e7eb;
    border-top-color: #3b82f6;
    border-radius: 50%;
    animation: spin 1s linear infinite;
    margin: 0 auto 16px;
  }

  p {
    color: #6b7280;
  }
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

// 空状态
.empty-state {
  text-align: center;
  padding: 60px 20px;

  .empty-icon {
    font-size: 48px;
    margin-bottom: 12px;
  }

  h4 {
    font-size: 16px;
    color: #374151;
    margin: 0 0 4px 0;
  }

  p {
    color: #6b7280;
    margin: 0;
    font-size: 14px;
  }
}
</style>
