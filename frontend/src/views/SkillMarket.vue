<script setup lang="ts">
import { ref, onMounted, computed, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useSkillStore } from '@/stores/skillStore'
import { SkillService } from '@/api/skillService'
import type { Skill, OnlineSkill, GitHubSkillSource } from '@/types/skill'
import { ElMessage, ElMessageBox } from 'element-plus'
import {
  Folder,
  Search,
  Plus,
  Loading,
  Shop,
  Download,
  Delete,
  Edit,
  Link,
  CirclePlus,
  Remove,
} from '@element-plus/icons-vue'

const router = useRouter()
const skillStore = useSkillStore()

// ==================== Tabs ====================
const activeTab = ref<'local' | 'online'>('local')

// ==================== Local Skill State ====================
const showCreateDialog = ref(false)
const showEditDialog = ref(false)
const showDeleteDialog = ref(false)
const selectedSkill = ref<Skill | null>(null)

// 表单数据
const createForm = ref({
  name: '',
  description: '',
  baseDir: '',
})

const editForm = ref({
  id: '',
  name: '',
  description: '',
  baseDir: '',
  status: 'active' as 'active' | 'inactive',
})

// 搜索和过滤
const searchQuery = ref('')
const statusFilter = ref<'all' | 'active' | 'inactive'>('all')

// ==================== Online Market State ====================
const onlineSkills = ref<OnlineSkill[]>([])
const onlineLoading = ref(false)
const onlineSearchQuery = ref('')
const selectedGitHubSource = ref<string>('all') // 'all' 或特定 sourceId
const installingSkillId = ref<string | null>(null)
const showInstallDialog = ref(false)
const selectedOnlineSkill = ref<OnlineSkill | null>(null)
const installTargetDir = ref('')

// 加载进度状态
const loadingProgress = ref({
  current: 0,
  total: 0,
  currentSource: '',
})

// GitHub 源管理
const githubSources = ref<GitHubSkillSource[]>([])
const showAddSourceDialog = ref(false)
const newSourceUrl = ref('')
const newSourceName = ref('')

// ==================== Computed ====================
const filteredSkills = computed(() => {
  let result = skillStore.skills

  // 搜索过滤
  if (searchQuery.value) {
    const query = searchQuery.value.toLowerCase()
    result = result.filter(
      (skill) =>
        skill.name.toLowerCase().includes(query) ||
        skill.description?.toLowerCase().includes(query),
    )
  }

  // 状态过滤
  if (statusFilter.value !== 'all') {
    result = result.filter((skill) => skill.status === statusFilter.value)
  }

  return result
})

const activeCount = computed(
  () => (skillStore.skills || []).filter((s) => s.status === 'active').length,
)
const inactiveCount = computed(
  () => (skillStore.skills || []).filter((s) => s.status === 'inactive').length,
)

// 过滤后的在线技能
const filteredOnlineSkills = computed(() => {
  let result = onlineSkills.value

  if (onlineSearchQuery.value) {
    const query = onlineSearchQuery.value.toLowerCase()
    result = result.filter(
      (skill) =>
        skill.name.toLowerCase().includes(query) ||
        skill.description.toLowerCase().includes(query) ||
        skill.tags.some((tag) => tag.toLowerCase().includes(query)),
    )
  }

  if (selectedGitHubSource.value !== 'all') {
    result = result.filter((skill) => skill.sourceId === selectedGitHubSource.value)
  }

  return result
})

// ==================== Methods ====================
async function loadSkills() {
  await skillStore.fetchSkills()
}

function openCreateDialog() {
  createForm.value = {
    name: '',
    description: '',
    baseDir: '',
  }
  showCreateDialog.value = true
}

function openEditDialog(skill: Skill) {
  selectedSkill.value = skill
  editForm.value = {
    id: skill.id,
    name: skill.name,
    description: skill.description || '',
    baseDir: skill.baseDir,
    status: skill.status,
  }
  showEditDialog.value = true
}

function openDeleteDialog(skill: Skill) {
  selectedSkill.value = skill
  showDeleteDialog.value = true
}

async function handleCreate() {
  if (!createForm.value.name || !createForm.value.baseDir) {
    ElMessage.warning('请填写技能名称和基础目录')
    return
  }

  try {
    await skillStore.createSkill(createForm.value)
    showCreateDialog.value = false
    createForm.value = {
      name: '',
      description: '',
      baseDir: '',
    }
    ElMessage.success('技能创建成功')
  } catch (error) {
    console.error('创建技能失败:', error)
  }
}

async function handleUpdate() {
  if (!editForm.value.name || !editForm.value.baseDir) {
    ElMessage.warning('请填写技能名称和基础目录')
    return
  }

  try {
    await skillStore.updateSkill({
      id: editForm.value.id,
      name: editForm.value.name,
      description: editForm.value.description,
      baseDir: editForm.value.baseDir,
      status: editForm.value.status,
    })
    showEditDialog.value = false
    ElMessage.success('技能更新成功')
  } catch (error) {
    console.error('更新技能失败:', error)
  }
}

async function handleDelete() {
  if (!selectedSkill.value) return

  try {
    await skillStore.deleteSkill(selectedSkill.value.id)
    showDeleteDialog.value = false
    ElMessage.success('技能删除成功')
    selectedSkill.value = null
  } catch (error) {
    console.error('删除技能失败:', error)
  }
}

function formatDate(timestamp: number): string {
  return new Date(timestamp).toLocaleString('zh-CN')
}

// ==================== Online Market Methods ====================

// 从 GitHub API 获取目录内容
async function fetchGitHubRepoContents(
  owner: string,
  repo: string,
  path = '',
  branch = 'main',
): Promise<any[]> {
  const url = `https://api.github.com/repos/${owner}/${repo}/contents/${path}?ref=${branch}`
  const response = await fetch(url, {
    headers: {
      Accept: 'application/vnd.github.v3+json',
    },
  })
  if (!response.ok) {
    throw new Error(`Failed to fetch GitHub contents: ${response.status}`)
  }
  return response.json()
}

// 从 GitHub 获取 skill.md 内容
interface SkillMetadata {
  name: string
  description: string
  version: string
  author?: string
  tags: string[]
}

async function fetchSkillMd(owner: string, repo: string, path = ''): Promise<SkillMetadata | null> {
  try {
    const skillPath = path ? `${path}/SKILL.md` : 'SKILL.md'
    const url = `https://raw.githubusercontent.com/${owner}/${repo}/main/${skillPath}`
    const response = await fetch(url)
    if (response.ok) {
      const text = await response.text()
      return parseSkillMd(text)
    }
  } catch (e) {
    console.log('No skill.md found for', owner, repo, path)
  }
  return null
}

// 解析 skill.md 文件
function parseSkillMd(content: string): SkillMetadata {
  const metadata: SkillMetadata = {
    name: '',
    description: '',
    version: '1.0.0',
    tags: [],
  }

  // 解析 YAML frontmatter (--- ... ---)
  const frontmatterMatch = content.match(/^---\s*\n([\s\S]*?)\n---\s*\n/)
  if (frontmatterMatch) {
    const frontmatter = frontmatterMatch[1]
    const lines = frontmatter.split('\n')
    for (const line of lines) {
      const match = line.match(/^([\w-]+):\s*(.*)$/)
      if (match) {
        const key = match[1].trim()
        const value = match[2].trim().replace(/^["']|["']$/g, '')
        switch (key) {
          case 'name':
            metadata.name = value
            break
          case 'description':
            metadata.description = value
            break
          case 'version':
            metadata.version = value
            break
          case 'author':
            metadata.author = value
            break
          case 'tags':
            metadata.tags = value
              .split(',')
              .map((t) => t.trim())
              .filter(Boolean)
            break
        }
      }
    }
  }

  // 如果没有 frontmatter，尝试从 Markdown 标题提取
  if (!metadata.name) {
    const titleMatch = content.match(/^#\s+(.+)$/m)
    if (titleMatch) {
      metadata.name = titleMatch[1].trim()
    }
  }

  // 如果没有描述，尝试从第一段提取
  if (!metadata.description) {
    const descMatch = content.match(/\n\n([^#\n].*?)\n\n/)
    if (descMatch) {
      metadata.description = descMatch[1].trim().slice(0, 200)
    }
  }

  return metadata
}

// 解析 GitHub URL
function parseGitHubUrl(url: string): { owner: string; repo: string } | null {
  const match = url.match(/github\.com\/([^/]+)\/([^/]+)/)
  if (match) {
    return { owner: match[1], repo: match[2].replace(/\.git$/, '') }
  }
  return null
}

// 从单个 GitHub 源加载技能
// 支持两种结构：
// 1. 标准结构：skills/skill1/, skills/skill2/（直接在第一级）
// 2. 分类结构：skills/categoryA/skill1/, skills/categoryB/skill2/（在第二级）
async function loadSkillsFromGitHubSource(
  source: GitHubSkillSource,
  onProgress?: (current: number, total: number, skillName: string) => void,
): Promise<OnlineSkill[]> {
  const parsed = parseGitHubUrl(source.repoUrl)
  if (!parsed) {
    console.error('Invalid GitHub URL:', source.repoUrl)
    return []
  }

  const { owner, repo } = parsed
  const branch = 'main' // 默认使用 main 分支
  const skillsPath = 'skills' // 统一从 skills 子目录读取

  try {
    // 获取 skills 目录的内容
    const contents = await fetchGitHubRepoContents(owner, repo, skillsPath, branch)
    const skills: OnlineSkill[] = []
    const potentialCategories: string[] = []

    // 统计所有可能的项目（第一级目录 + 第二级目录）
    let totalItems = contents.filter((item) => item.type === 'dir').length
    let processedItems = 0

    // 更新进度 - 开始扫描
    if (onProgress) {
      onProgress(0, totalItems, `正在扫描 ${source.name}...`)
    }

    // 第一遍遍历：收集直接技能目录和可能的分类目录
    for (const item of contents) {
      if (item.type === 'dir') {
        processedItems++
        // 尝试在第一级目录查找 SKILL.md
        const skillDirPath = `skills/${item.name}`
        const skillMd = await fetchSkillMd(owner, repo, skillDirPath)
        if (skillMd) {
          console.log(skillMd)
          // 找到 SKILL.md，说明是第一级技能目录
          skills.push({
            id: skillMd.name,
            name: skillMd.name || item.name,
            description: skillMd.description,
            author: skillMd.author || owner,
            authorAvatar: `https://github.com/${skillMd.author || owner}.png`,
            version: skillMd.version || '1.0.0',
            tags: [...skillMd.tags, source.name, 'github'],
            source: 'github',
            sourceId: source.id,
            repoUrl: source.repoUrl,
            repoPath: skillDirPath,
            readmeUrl: `https://raw.githubusercontent.com/${owner}/${repo}/main/${skillDirPath}/SKILL.md`,
            createdAt: Date.now(),
            updatedAt: Date.now(),
          })
          if (onProgress) {
            onProgress(processedItems, totalItems, `已加载技能: ${skillMd.name || item.name}`)
          }
        } else {
          // 没有找到 SKILL.md，可能是分类目录，记录下来稍后处理
          potentialCategories.push(item.name)
        }
      }
    }

    // 第二遍遍历：检查分类目录下的技能
    for (const category of potentialCategories) {
      try {
        const categoryPath = `skills/${category}`
        const categoryContents = await fetchGitHubRepoContents(owner, repo, categoryPath, branch)

        // 更新总数（包含分类下的目录）
        totalItems += categoryContents.filter((item) => item.type === 'dir').length

        for (const item of categoryContents) {
          if (item.type === 'dir') {
            processedItems++
            const skillDirPath = `skills/${category}/${item.name}`
            const skillMd = await fetchSkillMd(owner, repo, skillDirPath)

            if (skillMd) {
              skills.push({
                id: skillMd.name,
                name: skillMd.name || item.name,
                description: skillMd.description,
                author: skillMd.author || owner,
                authorAvatar: `https://github.com/${skillMd.author || owner}.png`,
                version: skillMd.version || '1.0.0',
                tags: [...skillMd.tags, category, source.name, 'github'],
                source: 'github',
                sourceId: source.id,
                repoUrl: source.repoUrl,
                repoPath: skillDirPath,
                readmeUrl: `https://raw.githubusercontent.com/${owner}/${repo}/main/${skillDirPath}/SKILL.md`,
                createdAt: Date.now(),
                updatedAt: Date.now(),
              })
              if (onProgress) {
                onProgress(processedItems, totalItems, `已加载技能: ${skillMd.name || item.name}`)
              }
            }
          }
        }
      } catch (error) {
        // 分类目录读取失败，继续下一个
        console.warn(`Failed to read category ${category}:`, error)
      }
    }

    return skills
  } catch (error) {
    // 如果 skills 目录不存在，返回空数组（该源没有技能）
    if (error instanceof Error && error.message.includes('404')) {
      console.log(`No skills directory found in ${source.name}`)
      return []
    }
    console.error(`Failed to load skills from ${source.name}:`, error)
    ElMessage.error(
      `加载 ${source.name} 失败: ${error instanceof Error ? error.message : '未知错误'}`,
    )
    return []
  }
}

// 加载所有在线技能
async function loadOnlineSkills() {
  onlineLoading.value = true
  onlineSkills.value = []
  loadingProgress.value = { current: 0, total: 0, currentSource: '' }

  try {
    // 如果没有配置源，从后端加载
    if (githubSources.value.length === 0) {
      ElMessage.error('还没有配置github源')
      return
    }

    // 如果选中了特定源，只加载该源的技能
    if (selectedGitHubSource.value !== 'all') {
      const source = githubSources.value.find((s) => s.id === selectedGitHubSource.value)
      if (!source) {
        ElMessage.error('选中的源不存在')
        return
      }
      loadingProgress.value.currentSource = source.name
      const skills = await loadSkillsFromGitHubSource(source, (current, total, skillName) => {
        loadingProgress.value.current = current
        loadingProgress.value.total = total
      })
      onlineSkills.value = skills
      console.log(`[SkillMarket] Loaded ${skills.length} skills from source: ${source.name}`)
    } else {
      // 从所有 GitHub 源加载技能
      const allSkills: OnlineSkill[] = []
      for (const source of githubSources.value) {
        loadingProgress.value.currentSource = source.name
        const skills = await loadSkillsFromGitHubSource(source, (current, total, skillName) => {
          loadingProgress.value.current = current
          loadingProgress.value.total = total
        })
        allSkills.push(...skills)
      }
      onlineSkills.value = allSkills
      console.log(
        `[SkillMarket] Loaded ${allSkills.length} skills from ${githubSources.value.length} sources`,
      )
    }
  } catch (error) {
    console.error('加载在线技能失败:', error)
    ElMessage.error('加载在线技能失败')
  } finally {
    onlineLoading.value = false
    loadingProgress.value = { current: 0, total: 0, currentSource: '' }
  }
}

// 从后端 API 加载 GitHub 源
async function loadGitHubSources() {
  try {
    const response = await SkillService.getGitHubSources()
    githubSources.value = response.sources
  } catch (error) {
    console.error('加载 GitHub 源失败:', error)
    ElMessage.error('加载 GitHub 源失败')
    githubSources.value = []
  }
}

// 添加新的 GitHub 源
function openAddSourceDialog() {
  newSourceUrl.value = ''
  newSourceName.value = ''
  showAddSourceDialog.value = true
}

async function addGitHubSource() {
  if (!newSourceUrl.value.trim()) {
    ElMessage.warning('请输入 GitHub 仓库地址')
    return
  }

  const url = newSourceUrl.value.trim()
  const parsed = parseGitHubUrl(url)

  if (!parsed) {
    ElMessage.error('无效的 GitHub 地址，请使用格式: https://github.com/owner/repo')
    return
  }

  // 检查是否已存在
  if (
    githubSources.value.some(
      (s) => s.name === (newSourceName.value.trim() || `${parsed.owner}/${parsed.repo}`),
    )
  ) {
    ElMessage.warning('该源名称已存在')
    return
  }

  try {
    // 调用后端 API 添加 GitHub 源
    const newSource = await SkillService.addGitHubSource({
      name: newSourceName.value.trim() || `${parsed.owner}/${parsed.repo}`,
      repoUrl: url,
    })

    // 添加到本地列表
    githubSources.value.push(newSource)
    showAddSourceDialog.value = false
    ElMessage.success('GitHub 源添加成功')

    // 重新加载技能列表
    await loadOnlineSkills()
  } catch (error) {
    ElMessage.error('添加 GitHub 源失败')
  }
}

// 删除 GitHub 源
async function removeGitHubSource(source: GitHubSkillSource) {
  try {
    await ElMessageBox.confirm(`确定要删除源 "${source.name}" 吗？`, '确认删除', {
      confirmButtonText: '删除',
      cancelButtonText: '取消',
      type: 'warning',
    })

    // 调用后端 API 删除
    await SkillService.deleteGitHubSource(source.id)

    // 从本地列表移除
    githubSources.value = githubSources.value.filter((s) => s.id !== source.id)
    ElMessage.success('源已删除')

    // 如果当前筛选的是被删除的源，重置为 all
    if (selectedGitHubSource.value === source.id) {
      selectedGitHubSource.value = 'all'
    }

    // 重新加载技能列表
    await loadOnlineSkills()
  } catch (error) {
    if (error !== 'cancel') {
      ElMessage.error('删除失败')
    }
  }
}

function handleOnlineSearch() {
  // 搜索是实时的，通过 computed 属性处理
}

// 从 localStorage 获取默认技能基础目录
function getDefaultSkillsBaseDir(): string | null {
  return localStorage.getItem('default_skills_base_dir')
}

// 保存默认技能基础目录到 localStorage
function saveDefaultSkillsBaseDir(dir: string) {
  localStorage.setItem('default_skills_base_dir', dir)
}

// 获取默认技能安装目录
function getDefaultSkillInstallDir(skillName: string): string {
  const baseDir = getDefaultSkillsBaseDir()
  if (baseDir) {
    const separator = baseDir.includes('\\') ? '\\' : '/'
    return `${baseDir}${separator}${skillName}`
  }
  // 如果没有设置过，返回一个示例路径供用户参考
  return ''
}

function openInstallDialog(skill: OnlineSkill) {
  selectedOnlineSkill.value = skill
  // 设置默认安装目录
  const defaultDir = getDefaultSkillInstallDir(skill.name)
  installTargetDir.value = defaultDir
  showInstallDialog.value = true
}

async function handleInstallSkill() {
  if (!selectedOnlineSkill.value || !installTargetDir.value) {
    ElMessage.warning('请填写安装目录')
    return
  }

  // 保存基础目录作为默认（提取父目录）
  const separator = installTargetDir.value.includes('\\') ? '\\' : '/'
  const parts = installTargetDir.value.split(separator)
  if (parts.length > 1) {
    const baseDir = parts.slice(0, -1).join(separator)
    saveDefaultSkillsBaseDir(baseDir)
  }

  installingSkillId.value = selectedOnlineSkill.value.id
  try {
    // http.ts 拦截器已经处理了 code 和 msg，这里直接返回 data 中的 Skill 对象
    const installedSkill = await SkillService.installOnlineSkill({
      skillId: selectedOnlineSkill.value.id,
      sourceId: selectedOnlineSkill.value.sourceId,
      targetDir: installTargetDir.value,
      repoUrl: selectedOnlineSkill.value.repoUrl,
      repoPath: selectedOnlineSkill.value.repoPath,
    })

    // 如果返回了 skill 对象（有 id），说明安装成功
    if (installedSkill && installedSkill.id) {
      ElMessage.success(`技能 "${installedSkill.name || selectedOnlineSkill.value.name}" 安装成功`)
      showInstallDialog.value = false
      // 刷新本地技能列表
      await loadSkills()
      // 切换到本地标签
      activeTab.value = 'local'
    } else {
      ElMessage.error('安装失败')
    }
  } catch (error) {
    console.error('安装技能失败:', error)
    ElMessage.error('安装技能失败')
  } finally {
    installingSkillId.value = null
  }
}

function formatNumber(num: number): string {
  if (num >= 1000) {
    return (num / 1000).toFixed(1) + 'k'
  }
  return num.toString()
}

// ==================== Lifecycle ====================
onMounted(async () => {
  await loadSkills()
})

// 监听标签页变化，切换到在线市场时加载 GitHub 源
watch(activeTab, async (newTab) => {
  if (newTab === 'online') {
    // 加载 GitHub 源列表
    await loadGitHubSources()
  }
})
</script>

<template>
  <div class="skill-market">
    <!-- 页面头部 -->
    <div class="page-header">
      <div class="header-left">
        <h1>技能市场</h1>
        <p class="subtitle">管理和复用技能模块，从本地或 GitHub 源安装技能</p>
      </div>
    </div>

    <!-- 标签页 -->
    <el-tabs v-model="activeTab" class="skill-tabs" type="border-card">
      <!-- 本地技能标签 -->
      <el-tab-pane name="local">
        <template #label>
          <span class="tab-label">
            <el-icon><Folder /></el-icon>
            本地技能
          </span>
        </template>

        <!-- 本地技能内容 -->
        <div class="tab-content">
          <!-- 操作栏 -->
          <div class="action-bar">
            <div class="search-filter">
              <el-input
                v-model="searchQuery"
                placeholder="搜索技能名称或描述..."
                clearable
                class="search-input"
              >
                <template #prefix>
                  <el-icon><Search /></el-icon>
                </template>
              </el-input>
              <el-select
                v-model="statusFilter"
                placeholder="状态筛选"
                clearable
                class="filter-select"
              >
                <el-option label="全部状态" value="all" />
                <el-option label="已启用" value="active" />
                <el-option label="已禁用" value="inactive" />
              </el-select>
            </div>
            <el-button type="primary" @click="openCreateDialog">
              <el-icon><Plus /></el-icon>
              创建技能
            </el-button>
          </div>

          <!-- 统计卡片 -->
          <div class="stats-cards">
            <div class="stat-card">
              <div class="stat-value">{{ skillStore.skills.length }}</div>
              <div class="stat-label">总技能数</div>
            </div>
            <div class="stat-card active">
              <div class="stat-value">{{ activeCount }}</div>
              <div class="stat-label">已启用</div>
            </div>
            <div class="stat-card inactive">
              <div class="stat-value">{{ inactiveCount }}</div>
              <div class="stat-label">已禁用</div>
            </div>
          </div>

          <!-- 技能列表 -->
          <div class="skill-list">
            <el-empty v-if="skillStore.loading" description="加载中...">
              <el-icon class="is-loading" :size="40"><Loading /></el-icon>
            </el-empty>

            <el-empty v-else-if="filteredSkills.length === 0" description="暂无技能">
              <template #image>
                <div class="empty-icon">📦</div>
              </template>
              <template #description>
                <p>点击"创建技能"按钮添加第一个技能</p>
              </template>
            </el-empty>

            <div v-else class="skill-grid">
              <el-card
                v-for="skill in filteredSkills"
                :key="skill.id"
                class="skill-card"
                :class="{ inactive: skill.status === 'inactive' }"
                shadow="hover"
              >
                <div class="skill-header">
                  <div class="skill-icon">🛠️</div>
                  <el-tag :type="skill.status === 'active' ? 'success' : 'danger'" size="small">
                    {{ skill.status === 'active' ? '已启用' : '已禁用' }}
                  </el-tag>
                </div>

                <div class="skill-body">
                  <h3 class="skill-name">{{ skill.name }}</h3>
                  <p class="skill-description">{{ skill.description || '暂无描述' }}</p>
                  <div class="skill-path">
                    <span class="path-label">路径:</span>
                    <code class="path-value">{{ skill.baseDir }}</code>
                  </div>
                </div>

                <div class="skill-footer">
                  <div class="skill-meta">
                    <span class="meta-item">创建于 {{ formatDate(skill.createdAt) }}</span>
                  </div>
                  <div class="skill-actions">
                    <el-button size="small" @click="openEditDialog(skill)">编辑</el-button>
                    <el-button size="small" type="danger" @click="openDeleteDialog(skill)"
                      >删除</el-button
                    >
                  </div>
                </div>
              </el-card>
            </div>
          </div>
        </div>
      </el-tab-pane>

      <!-- 在线市场标签 -->
      <el-tab-pane name="online">
        <template #label>
          <span class="tab-label">
            <el-icon><Shop /></el-icon>
            GitHub 技能库
          </span>
        </template>

        <!-- 在线市场内容 -->
        <div class="tab-content">
          <!-- 搜索栏 -->
          <div class="action-bar">
            <div class="search-filter">
              <el-input
                v-model="onlineSearchQuery"
                placeholder="搜索技能名称、描述或标签..."
                clearable
                class="search-input"
                @keyup.enter="handleOnlineSearch"
              >
                <template #prefix>
                  <el-icon><Search /></el-icon>
                </template>
              </el-input>
              <el-select
                v-model="selectedGitHubSource"
                placeholder="选择来源"
                clearable
                class="filter-select"
              >
                <el-option label="全部来源" value="all" />
                <el-option
                  v-for="source in githubSources"
                  :key="source.id"
                  :label="source.name"
                  :value="source.id"
                />
              </el-select>
              <el-button type="primary" @click="loadOnlineSkills" :loading="onlineLoading">
                <el-icon><Loading /></el-icon>
                刷新
              </el-button>
            </div>
            <el-button type="success" @click="openAddSourceDialog">
              <el-icon><CirclePlus /></el-icon>
              添加 GitHub 源
            </el-button>
          </div>

          <!-- GitHub 源列表 -->
          <div class="sources-section">
            <h4 class="section-title">GitHub 技能源</h4>
            <div class="sources-list">
              <el-empty v-if="githubSources.length === 0" description="暂无 GitHub 源">
                <template #description> 点击"添加 GitHub 源"按钮添加第一个源 </template>
              </el-empty>
              <el-tag
                v-for="source in githubSources"
                :key="source.id"
                class="source-tag"
                :type="selectedGitHubSource === source.id ? 'primary' : 'info'"
                closable
                @click="selectedGitHubSource = source.id"
                @close="removeGitHubSource(source)"
              >
                <el-icon><Link /></el-icon>
                {{ source.name }}
              </el-tag>
            </div>
          </div>

          <!-- 加载进度条 -->
          <div v-if="onlineLoading && loadingProgress.total > 0" class="loading-progress">
            <div class="progress-header">
              <span class="progress-source">正在加载: {{ loadingProgress.currentSource }}</span>
              <span class="progress-count">
                {{ loadingProgress.current }} / {{ loadingProgress.total }}
              </span>
            </div>
            <el-progress
              :percentage="Math.round((loadingProgress.current / loadingProgress.total) * 100)"
              :stroke-width="8"
              :show-text="false"
              status="success"
            />
            <div class="progress-detail">
              已加载 {{ loadingProgress.current }} 个技能，共 {{ loadingProgress.total }} 个
            </div>
          </div>

          <!-- 在线技能列表 -->
          <div class="online-skill-list">
            <el-empty v-if="onlineLoading && loadingProgress.total === 0" description="加载中...">
              <el-icon class="is-loading" :size="40"><Loading /></el-icon>
            </el-empty>

            <el-empty v-else-if="filteredOnlineSkills.length === 0" description="未找到匹配的技能">
              <template #image>
                <div class="empty-icon">🔍</div>
              </template>
            </el-empty>

            <div v-else class="online-skill-grid">
              <el-card
                v-for="skill in filteredOnlineSkills"
                :key="skill.id"
                class="online-skill-card"
                shadow="hover"
              >
                <!-- 技能头部 -->
                <div class="online-skill-header">
                  <div class="online-skill-icon">{{ skill.icon || '📦' }}</div>
                  <div class="online-skill-info">
                    <h3 class="online-skill-name">{{ skill.name }}</h3>
                    <div class="online-skill-meta">
                      <span class="author">
                        <el-avatar :size="16" :src="skill.authorAvatar" />
                        {{ skill.author }}
                      </span>
                      <el-tag size="small" type="info">v{{ skill.version }}</el-tag>
                    </div>
                  </div>
                </div>

                <!-- 技能描述 -->
                <div class="online-skill-body">
                  <p class="online-skill-description">{{ skill.description }}</p>
                  <div class="skill-tags">
                    <el-tag
                      v-for="tag in skill.tags"
                      :key="tag"
                      size="small"
                      effect="plain"
                      class="skill-tag"
                    >
                      {{ tag }}
                    </el-tag>
                  </div>
                </div>

                <!-- 来源信息 -->
                <div class="online-skill-source">
                  <el-text type="info" size="small">
                    来源:
                    {{ githubSources.find((s) => s.id === skill.sourceId)?.name || skill.sourceId }}
                  </el-text>
                </div>

                <!-- 技能操作 -->
                <div class="online-skill-footer">
                  <el-button
                    type="primary"
                    class="install-btn"
                    :loading="installingSkillId === skill.id"
                    @click="openInstallDialog(skill)"
                  >
                    <el-icon><Download /></el-icon>
                    安装
                  </el-button>
                </div>
              </el-card>
            </div>
          </div>
        </div>
      </el-tab-pane>
    </el-tabs>

    <!-- 创建技能对话框 -->
    <el-dialog v-model="showCreateDialog" title="创建技能" width="500px" destroy-on-close>
      <el-form :model="createForm" label-width="100px">
        <el-form-item label="技能名称" required>
          <el-input v-model="createForm.name" placeholder="例如: git-commit" />
        </el-form-item>
        <el-form-item label="描述">
          <el-input
            v-model="createForm.description"
            type="textarea"
            :rows="3"
            placeholder="技能功能描述..."
          />
        </el-form-item>
        <el-form-item label="基础目录" required>
          <el-input
            v-model="createForm.baseDir"
            placeholder="例如: D:\go\course\msai\MSZLU-AI\skills\my-skill"
            clearable
          />
          <div class="path-hint">
            <el-text type="info" size="small">
              输入电脑上的实际目录路径（注意是技能的上一层目录），如 Windows: D:\path\to\skills 或
              Linux: /home/user/skills
            </el-text>
          </div>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="showCreateDialog = false">取消</el-button>
        <el-button type="primary" :loading="skillStore.loading" @click="handleCreate">
          创建
        </el-button>
      </template>
    </el-dialog>

    <!-- 编辑技能对话框 -->
    <el-dialog v-model="showEditDialog" title="编辑技能" width="500px" destroy-on-close>
      <el-form :model="editForm" label-width="100px">
        <el-form-item label="技能名称" required>
          <el-input v-model="editForm.name" />
        </el-form-item>
        <el-form-item label="描述">
          <el-input v-model="editForm.description" type="textarea" :rows="3" />
        </el-form-item>
        <el-form-item label="基础目录" required>
          <el-input
            v-model="editForm.baseDir"
            placeholder="例如: D:\go\course\msai\MSZLU-AI\skills\my-skill"
            clearable
          />
          <div class="path-hint">
            <el-text type="info" size="small">
              输入电脑上的实际目录路径（注意是技能的上一层目录），如 Windows: D:\path\to\skills 或
              Linux: /home/user/skills
            </el-text>
          </div>
        </el-form-item>
        <el-form-item label="状态">
          <el-select v-model="editForm.status">
            <el-option label="启用" value="active" />
            <el-option label="禁用" value="inactive" />
          </el-select>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="showEditDialog = false">取消</el-button>
        <el-button type="primary" :loading="skillStore.loading" @click="handleUpdate">
          保存
        </el-button>
      </template>
    </el-dialog>

    <!-- 删除确认对话框 -->
    <el-dialog v-model="showDeleteDialog" title="确认删除" width="400px">
      <p>
        确定要删除技能 <strong>{{ selectedSkill?.name }}</strong> 吗？
      </p>
      <p class="text-danger">此操作不可恢复，同时会移除所有 Agent 与该技能的关联。</p>
      <template #footer>
        <el-button @click="showDeleteDialog = false">取消</el-button>
        <el-button type="danger" :loading="skillStore.loading" @click="handleDelete">
          删除
        </el-button>
      </template>
    </el-dialog>

    <!-- 安装技能对话框 -->
    <el-dialog v-model="showInstallDialog" title="安装技能" width="500px" destroy-on-close>
      <div v-if="selectedOnlineSkill" class="install-preview">
        <div class="install-skill-info">
          <div class="install-skill-icon">{{ selectedOnlineSkill.icon || '📦' }}</div>
          <div class="install-skill-details">
            <h3>{{ selectedOnlineSkill.name }}</h3>
            <p>{{ selectedOnlineSkill.description }}</p>
            <div class="install-skill-meta">
              <span>作者: {{ selectedOnlineSkill.author }}</span>
              <span>版本: {{ selectedOnlineSkill.version }}</span>
            </div>
          </div>
        </div>
      </div>
      <el-form label-width="100px">
        <el-form-item label="安装目录" required>
          <el-input
            v-model="installTargetDir"
            placeholder="例如: C:\\Users\\username\\.faber-ai\\skills\\my-skill 或 /home/user/.faber-ai/skills/my-skill"
            clearable
          />
          <div class="path-hint">
            <el-text type="info" size="small">
              输入电脑上的实际目录路径（注意是技能的上一层目录），技能将被下载到该目录。首次安装后，该目录会自动保存为默认路径。
            </el-text>
          </div>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="showInstallDialog = false">取消</el-button>
        <el-button
          type="primary"
          :loading="!!installingSkillId"
          :disabled="!installTargetDir"
          @click="handleInstallSkill"
        >
          安装
        </el-button>
      </template>
    </el-dialog>

    <!-- 添加 GitHub 源对话框 -->
    <el-dialog
      v-model="showAddSourceDialog"
      title="添加 GitHub 技能源"
      width="500px"
      destroy-on-close
    >
      <el-form label-width="120px">
        <el-form-item label="源名称" required>
          <el-input v-model="newSourceName" placeholder="例如: Anthropic Skills" />
        </el-form-item>
        <el-form-item label="GitHub 地址" required>
          <el-input v-model="newSourceUrl" placeholder="https://github.com/owner/repo" />
          <div class="path-hint">
            <el-text type="info" size="small">
              输入 GitHub 仓库地址，例如: https://github.com/anthropics/skills
            </el-text>
          </div>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="showAddSourceDialog = false">取消</el-button>
        <el-button type="primary" @click="addGitHubSource"> 添加 </el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped lang="scss">
.skill-market {
  padding: 24px;
  max-width: 1400px;
  margin: 0 auto;
}

// 页面头部
.page-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  margin-bottom: 24px;

  h1 {
    margin: 0 0 8px 0;
    font-size: 28px;
    font-weight: 600;
  }

  .subtitle {
    margin: 0;
    color: var(--el-text-color-secondary);
    font-size: 14px;
  }
}

// 标签页
.skill-tabs {
  :deep(.el-tabs__header) {
    margin-bottom: 0;
  }
}

.tab-label {
  display: flex;
  align-items: center;
  gap: 6px;
}

.tab-content {
  padding: 24px;
}

// 操作栏
.action-bar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 24px;
  flex-wrap: wrap;
  gap: 16px;
}

.search-filter {
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
}

.search-input {
  width: 300px;
}

.filter-select {
  width: 150px;
}

// 统计卡片
.stats-cards {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
  gap: 16px;
  margin-bottom: 24px;
}

.stat-card {
  padding: 20px;
  background: var(--el-bg-color);
  border-radius: 8px;
  text-align: center;
  border: 1px solid var(--el-border-color-light);

  .stat-value {
    font-size: 32px;
    font-weight: 600;
    color: var(--el-text-color-primary);
    margin-bottom: 4px;
  }

  .stat-label {
    font-size: 14px;
    color: var(--el-text-color-secondary);
  }

  &.active .stat-value {
    color: var(--el-color-success);
  }

  &.inactive .stat-value {
    color: var(--el-color-danger);
  }
}

// 技能列表
.skill-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
  gap: 16px;
}

.skill-card {
  transition: all 0.3s;

  &.inactive {
    opacity: 0.7;
  }
}

.skill-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 16px;
}

.skill-icon {
  font-size: 32px;
}

.skill-body {
  margin-bottom: 16px;
}

.skill-name {
  margin: 0 0 8px 0;
  font-size: 18px;
  font-weight: 600;
}

.skill-description {
  margin: 0 0 12px 0;
  color: var(--el-text-color-secondary);
  font-size: 14px;
  line-height: 1.5;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.skill-path {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;

  .path-label {
    color: var(--el-text-color-secondary);
  }

  .path-value {
    font-family: monospace;
    background: var(--el-fill-color-light);
    padding: 2px 6px;
    border-radius: 4px;
    color: var(--el-text-color-primary);
    word-break: break-all;
  }
}

.skill-footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding-top: 16px;
  border-top: 1px solid var(--el-border-color-light);
}

.skill-meta {
  font-size: 13px;
  color: var(--el-text-color-secondary);
}

.skill-actions {
  display: flex;
  gap: 8px;
}

// 空状态
.empty-icon {
  font-size: 48px;
}

// 在线市场
.sources-section {
  margin-bottom: 24px;
  padding: 16px;
  background: var(--el-fill-color-light);
  border-radius: 8px;
}

.section-title {
  margin: 0 0 12px 0;
  font-size: 16px;
  font-weight: 600;
}

.sources-list {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.source-tag {
  cursor: pointer;
  transition: all 0.2s;

  &:hover {
    transform: translateY(-1px);
  }
}

.online-skill-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(360px, 1fr));
  gap: 16px;
}

.online-skill-card {
  display: flex;
  flex-direction: column;
  height: 100%;
}

.online-skill-header {
  display: flex;
  gap: 12px;
  margin-bottom: 16px;
}

.online-skill-icon {
  font-size: 40px;
  flex-shrink: 0;
}

.online-skill-info {
  flex: 1;
  min-width: 0;
}

.online-skill-name {
  margin: 0 0 8px 0;
  font-size: 18px;
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.online-skill-meta {
  display: flex;
  align-items: center;
  gap: 12px;
  font-size: 13px;

  .author {
    display: flex;
    align-items: center;
    gap: 6px;
    color: var(--el-text-color-secondary);
  }
}

.online-skill-body {
  flex: 1;
  margin-bottom: 16px;
}

.online-skill-description {
  margin: 0 0 12px 0;
  color: var(--el-text-color-secondary);
  font-size: 14px;
  line-height: 1.5;
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.skill-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.skill-tag {
  font-size: 12px;
}

.online-skill-source {
  margin-bottom: 12px;
}

.online-skill-footer {
  display: flex;
  justify-content: flex-end;
  padding-top: 16px;
  border-top: 1px solid var(--el-border-color-light);
}

.install-btn {
  width: 100%;
}

// 安装预览
.install-preview {
  margin-bottom: 24px;
  padding: 16px;
  background: var(--el-fill-color-light);
  border-radius: 8px;
}

.install-skill-info {
  display: flex;
  gap: 16px;
}

.install-skill-icon {
  font-size: 48px;
  line-height: 1;
}

.install-skill-details {
  flex: 1;

  h3 {
    font-size: 18px;
    font-weight: 600;
    margin: 0 0 8px 0;
    color: var(--el-text-color-primary);
  }

  p {
    font-size: 14px;
    color: var(--el-text-color-secondary);
    margin: 0 0 8px 0;
    line-height: 1.5;
  }

  .install-skill-meta {
    display: flex;
    gap: 16px;
    font-size: 13px;
    color: var(--el-text-color-placeholder);
  }
}

.text-danger {
  color: var(--el-color-danger);
  margin-top: 8px;
}

.path-hint {
  margin-top: 8px;
  padding: 6px 12px;
  background-color: var(--el-color-info-light-9);
  border-radius: 4px;
}

// 加载进度条
.loading-progress {
  margin-bottom: 24px;
  padding: 16px;
  background: var(--el-fill-color-light);
  border-radius: 8px;

  .progress-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 12px;

    .progress-source {
      font-size: 14px;
      font-weight: 500;
      color: var(--el-text-color-primary);
    }

    .progress-count {
      font-size: 14px;
      color: var(--el-text-color-secondary);
    }
  }

  .progress-detail {
    margin-top: 8px;
    font-size: 13px;
    color: var(--el-text-color-secondary);
    text-align: center;
  }
}

// 响应式
@media (max-width: 768px) {
  .skill-market {
    padding: 16px;
  }

  .page-header {
    flex-direction: column;
    gap: 16px;
  }

  .action-bar {
    flex-direction: column;
    align-items: stretch;
  }

  .search-filter {
    flex-direction: column;
    width: 100%;
  }

  .search-input,
  .filter-select {
    max-width: none;
    width: 100%;
  }

  .skill-grid,
  .online-skill-grid {
    grid-template-columns: 1fr;
  }
}
</style>
