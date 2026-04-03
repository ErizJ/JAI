<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import { ElMessage } from 'element-plus'
import {
  Folder,
  FolderOpened,
  ArrowUp,
  RefreshRight,
  Document,
  ArrowRight,
} from '@element-plus/icons-vue'

const props = defineProps<{
  visible: boolean
  title?: string
}>()

const emit = defineEmits<{
  'update:visible': [value: boolean]
  select: [path: string]
}>()

// ==================== State ====================
const currentPath = ref('/')
const entries = ref<Array<{ name: string; path: string; isDirectory: boolean; size?: number }>>([])
const loading = ref(false)
const selectedPath = ref('')
const expandedKeys = ref<string[]>(['/'])
const manualPath = ref('') // 手动输入的路径
const useManualInput = ref(false) // 是否使用手动输入模式

// ==================== Computed ====================
const dialogVisible = computed({
  get: () => props.visible,
  set: (val) => emit('update:visible', val),
})

const breadcrumb = computed(() => {
  const parts = currentPath.value.split('/').filter(Boolean)
  const result = [{ name: '根目录', path: '/' }]
  let path = ''
  for (const part of parts) {
    path += '/' + part
    result.push({ name: part, path })
  }
  return result
})

// ==================== Methods ====================
async function loadDirectory(path: string) {
  loading.value = true
  try {
    // 这里使用浏览器 File System Access API 或模拟数据
    // 由于浏览器安全限制，实际项目中可能需要后端支持
    // 这里提供一个简单的模拟实现
    if ('showDirectoryPicker' in window) {
      // 使用 File System Access API
      await loadWithFileSystemAPI(path)
    } else {
      // 模拟目录结构
      await loadMockDirectories(path)
    }
  } catch (error) {
    console.error('加载目录失败:', error)
    ElMessage.error('加载目录失败，使用模拟数据')
    await loadMockDirectories(path)
  } finally {
    loading.value = false
  }
}

async function loadWithFileSystemAPI(path: string) {
  try {
    const dirHandle = await (window as any).showDirectoryPicker()
    const items: typeof entries.value = []

    for await (const [name, handle] of dirHandle.entries()) {
      const isDirectory = handle.kind === 'directory'
      items.push({
        name,
        path: `${path}/${name}`,
        isDirectory,
        size: isDirectory ? undefined : 0,
      })
    }

    entries.value = items.sort((a, b) => {
      // 目录排在前面
      if (a.isDirectory !== b.isDirectory) {
        return a.isDirectory ? -1 : 1
      }
      return a.name.localeCompare(b.name)
    })
  } catch (error) {
    throw error
  }
}

async function loadMockDirectories(path: string) {
  console.log('[DirectorySelect] loadMockDirectories called with path:', path)
  // 模拟目录结构数据
  const mockData: Record<string, typeof entries.value> = {
    '/': [
      { name: 'home', path: '/home', isDirectory: true },
      { name: 'opt', path: '/opt', isDirectory: true },
      { name: 'var', path: '/var', isDirectory: true },
      { name: 'usr', path: '/usr', isDirectory: true },
      { name: 'tmp', path: '/tmp', isDirectory: true },
    ],
    '/home': [
      { name: 'user', path: '/home/user', isDirectory: true },
      { name: 'admin', path: '/home/admin', isDirectory: true },
    ],
    '/home/user': [
      { name: 'documents', path: '/home/user/documents', isDirectory: true },
      { name: 'downloads', path: '/home/user/downloads', isDirectory: true },
      { name: 'projects', path: '/home/user/projects', isDirectory: true },
    ],
    '/home/user/projects': [
      { name: 'web-app', path: '/home/user/projects/web-app', isDirectory: true },
      { name: 'api-server', path: '/home/user/projects/api-server', isDirectory: true },
      { name: 'mobile-app', path: '/home/user/projects/mobile-app', isDirectory: true },
    ],
    '/opt': [
      { name: 'nodejs', path: '/opt/nodejs', isDirectory: true },
      { name: 'python', path: '/opt/python', isDirectory: true },
    ],
    '/var': [
      { name: 'log', path: '/var/log', isDirectory: true },
      { name: 'www', path: '/var/www', isDirectory: true },
    ],
  }

  // 模拟延迟
  await new Promise((resolve) => setTimeout(resolve, 200))

  entries.value = mockData[path] || []
}

function navigateTo(path: string, keepSelection: boolean = false) {
  currentPath.value = path
  if (!keepSelection) {
    selectedPath.value = ''
  }
  loadDirectory(path)
}

function navigateUp() {
  const parts = currentPath.value.split('/').filter(Boolean)
  if (parts.length > 0) {
    parts.pop()
    const parentPath = parts.length === 0 ? '/' : '/' + parts.join('/')
    navigateTo(parentPath)
  }
}

function selectEntry(entry: { name: string; path: string; isDirectory: boolean }) {
  console.log('[DirectorySelect] ========== selectEntry called ==========')
  console.log('[DirectorySelect] entry:', JSON.stringify(entry))
  console.log('[DirectorySelect] current selectedPath before:', selectedPath.value)
  if (entry.isDirectory) {
    selectedPath.value = entry.path
    console.log('[DirectorySelect] >>> selectedPath SET TO:', selectedPath.value)
  } else {
    console.log('[DirectorySelect] Entry is not a directory')
  }
}

function openEntry(entry: { name: string; path: string; isDirectory: boolean }) {
  console.log('[DirectorySelect] openEntry:', entry)
  if (entry.isDirectory) {
    // 进入目录时保留选择，因为用户可能想选择当前正要进入的这个目录
    navigateTo(entry.path, true)
  }
}

function confirmSelection() {
  // 优先使用手动输入的路径
  const pathToUse = useManualInput.value ? manualPath.value.trim() : selectedPath.value
  console.log('[DirectorySelect] confirmSelection called, useManualInput:', useManualInput.value)
  console.log('[DirectorySelect] selectedPath:', selectedPath.value)
  console.log('[DirectorySelect] manualPath:', manualPath.value)
  console.log('[DirectorySelect] pathToUse:', pathToUse)

  if (pathToUse) {
    console.log('[DirectorySelect] Emitting select event with path:', pathToUse)
    emit('select', pathToUse)
    dialogVisible.value = false
    // 重置状态
    manualPath.value = ''
    useManualInput.value = false
    console.log('[DirectorySelect] Dialog closed')
  } else {
    console.log('[DirectorySelect] No path selected, showing warning')
    ElMessage.warning('请选择一个目录或手动输入路径')
  }
}

function handleManualPathInput(path: string) {
  manualPath.value = path
  if (path.trim()) {
    useManualInput.value = true
    selectedPath.value = '' // 清空选择的路径
  } else {
    useManualInput.value = false
  }
}

function handleSelectCurrent() {
  console.log('[DirectorySelect] handleSelectCurrent called, currentPath:', currentPath.value)
  emit('select', currentPath.value)
  dialogVisible.value = false
  console.log('[DirectorySelect] handleSelectCurrent completed')
}

// ==================== Lifecycle ====================
onMounted(() => {
  if (props.visible) {
    loadDirectory('/')
  }
})

watch(
  () => props.visible,
  (visible) => {
    if (visible) {
      // 重置所有状态
      currentPath.value = '/'
      selectedPath.value = ''
      manualPath.value = ''
      useManualInput.value = false
      loadDirectory('/')
    }
  },
)
</script>

<template>
  <el-dialog
    v-model="dialogVisible"
    :title="title || '选择目录'"
    width="700px"
    :close-on-click-modal="false"
  >
    <div class="directory-selector">
      <!-- 工具栏 -->
      <div class="toolbar">
        <el-button :icon="ArrowUp" size="small" @click="navigateUp" :disabled="currentPath === '/'">
          上级目录
        </el-button>
        <el-button :icon="RefreshRight" size="small" @click="loadDirectory(currentPath)">
          刷新
        </el-button>
        <el-button type="primary" size="small" @click="handleSelectCurrent">
          选择当前目录
        </el-button>
      </div>

      <!-- 面包屑导航 -->
      <div class="breadcrumb">
        <el-breadcrumb separator="/">
          <el-breadcrumb-item
            v-for="(item, index) in breadcrumb"
            :key="item.path"
            :class="{ clickable: index < breadcrumb.length - 1 }"
            @click="index < breadcrumb.length - 1 && navigateTo(item.path)"
          >
            {{ item.name }}
          </el-breadcrumb-item>
        </el-breadcrumb>
      </div>

      <!-- 目录列表 -->
      <div v-loading="loading" class="directory-list">
        <div v-if="entries.length === 0" class="empty-state">
          <el-empty description="空目录" />
        </div>
        <div
          v-for="entry in entries"
          :key="entry.path"
          class="directory-item"
          :class="{ selected: selectedPath === entry.path, directory: entry.isDirectory }"
          @click.stop="selectEntry(entry)"
          @dblclick.stop="openEntry(entry)"
        >
          <el-icon class="entry-icon">
            <Folder v-if="entry.isDirectory" />
            <Document v-else />
          </el-icon>
          <span class="entry-name">{{ entry.name }}</span>
          <el-icon v-if="entry.isDirectory" class="enter-icon" @click.stop="openEntry(entry)">
            <ArrowRight />
          </el-icon>
        </div>
      </div>

      <!-- 手动输入路径 -->
      <div class="manual-input-section">
        <el-divider>或直接输入路径</el-divider>
        <el-input
          v-model="manualPath"
          placeholder="例如: D:\\go\\course\\msai\\MSZLU-AI\\skills\\my-skill 或 /home/user/skills/my-skill"
          clearable
          @input="handleManualPathInput"
        >
          <template #prepend>路径</template>
        </el-input>
        <div class="path-hint">
          <el-text type="info" size="small">
            提示: 由于浏览器安全限制，浏览功能只能返回虚拟路径。建议直接输入服务器上的实际路径。
          </el-text>
        </div>
      </div>

      <!-- 选中路径显示 -->
      <div v-if="selectedPath && !useManualInput" class="selected-path">
        <el-tag type="success" size="large"> 已选择: {{ selectedPath }} </el-tag>
      </div>
      <div v-if="useManualInput && manualPath" class="selected-path">
        <el-tag type="warning" size="large"> 手动输入: {{ manualPath }} </el-tag>
      </div>
    </div>

    <template #footer>
      <el-button @click="dialogVisible = false">取消</el-button>
      <el-button type="primary" @click="confirmSelection"> 确认选择 </el-button>
    </template>
  </el-dialog>
</template>

<style scoped lang="scss">
.directory-selector {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.toolbar {
  display: flex;
  gap: 8px;
  align-items: center;
}

.breadcrumb {
  padding: 8px 12px;
  background-color: var(--el-fill-color-light);
  border-radius: var(--el-border-radius-base);

  :deep(.el-breadcrumb__item) {
    &.clickable {
      cursor: pointer;
      color: var(--el-color-primary);

      &:hover {
        text-decoration: underline;
      }
    }
  }
}

.directory-list {
  min-height: 300px;
  max-height: 400px;
  overflow-y: auto;
  border: 1px solid var(--el-border-color);
  border-radius: var(--el-border-radius-base);
}

.empty-state {
  padding: 40px 0;
}

.directory-item {
  display: flex;
  align-items: center;
  padding: 12px 16px;
  cursor: pointer;
  border-bottom: 1px solid var(--el-border-color-lighter);
  transition: all 0.2s;

  &:hover {
    background-color: var(--el-fill-color-light);
  }

  &.selected {
    background-color: var(--el-color-primary-light-9);
    border-left: 3px solid var(--el-color-primary);
  }

  &.directory {
    font-weight: 500;
  }
}

.entry-icon {
  font-size: 20px;
  margin-right: 12px;
  color: var(--el-color-primary);
}

.entry-name {
  flex: 1;
  font-size: 14px;
}

.enter-icon {
  font-size: 16px;
  color: var(--el-text-color-secondary);
  cursor: pointer;
  padding: 4px;
  border-radius: 4px;

  &:hover {
    background-color: var(--el-fill-color);
    color: var(--el-color-primary);
  }
}

.selected-path {
  padding: 12px;
  background-color: var(--el-fill-color-light);
  border-radius: var(--el-border-radius-base);
}

.manual-input-section {
  margin-top: 8px;
}

.path-hint {
  margin-top: 8px;
  padding: 8px 12px;
  background-color: var(--el-color-info-light-9);
  border-radius: var(--el-border-radius-base);
}
</style>
