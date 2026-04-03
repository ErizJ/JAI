<template>
  <div class="chat-section">
    <!-- 消息列表 -->
    <div class="messages" ref="messagesContainer">
      <div v-for="message in messages" :key="message.id" :class="['message', message.role]">
        <div class="avatar">
          <el-avatar
            :icon="message.role === 'user' ? UserFilled : Service"
            :size="36"
            :src="message.role === 'assistant' && agent?.icon ? agent.icon : undefined"
          />
        </div>
        <div class="content">
          <!-- 思考内容显示区域 -->
          <div v-if="message.thinkingContent" class="thinking-content">
            <div class="thinking-header">
              <el-icon><Cpu /></el-icon>
              <span>思考过程</span>
            </div>
            <div class="thinking-body">
              <TypewriterText
                :text="message.thinkingContent"
                :speed="10"
                :is-streaming="false"
                :render-html="true"
                :is-thinking="true"
                @typing-complete="onThinkingComplete(message)"
              />
            </div>
          </div>

          <!-- 思考中指示器 -->
          <div v-show="message.thinking" class="thinking-indicator">
            <el-icon class="is-loading"><Loading /></el-icon>
            <span>思考中...</span>
          </div>

          <!-- 消息内容 -->
          <div v-for="(content, idx) in message.contents" :key="idx" class="message-content">
            <!-- 复制按钮 -->
            <el-button
              v-if="content.type !== 'image'"
              type="primary"
              text
              size="small"
              :icon="CopyDocument"
              class="copy-content-btn"
              @click="copyMessageContent(content, message)"
            >
              复制
            </el-button>
            <div
              v-if="content.type === 'text' && content.content && content.content.trim().length > 0"
              class="text-content"
            >
              <div v-html="renderMarkdown(content.content)"></div>
            </div>
            <!-- HTML内容 -->
            <div v-else-if="content.type === 'htmlDisplay'" class="html-content">
              <div class="html-header">
                <span>HTML内容</span>
                <el-button
                  type="primary"
                  text
                  :icon="CopyDocument"
                  @click="copyHtml(content.content)"
                >
                  复制HTML
                </el-button>
              </div>
              <div class="html-body" v-html="content.content"></div>
            </div>

            <!-- Agent调用内容 -->
            <div v-else-if="content.type === 'agent_call'" class="agent-call-content">
              <div class="agent-call-header">
                <el-tag type="success" size="small">调用智能体: {{ content.agentName }}</el-tag>
                <el-tag v-if="content.toolName" type="warning" size="small" class="tool-call-tag"
                  >工具调用: {{ content.toolName }}</el-tag
                >
                <el-tag v-if="content.isThinking" type="warning" size="small" class="tool-call-tag"
                  >思考内容</el-tag
                >
                <el-tag v-if="content.isErr" type="warning" size="small" class="tool-call-tag"
                  >错误信息</el-tag
                >
              </div>
              <div class="agent-call-body">
                <div
                  v-if="
                    content.content &&
                    content.content.type &&
                    content.content.type === 'htmlDisplay'
                  "
                  class="html-content"
                >
                  <div class="html-header">
                    <span>HTML内容</span>
                    <el-button
                      type="primary"
                      text
                      :icon="CopyDocument"
                      @click="copyHtml(extractHtmlFromMarkdown(content.content.content))"
                    >
                      复制HTML
                    </el-button>
                  </div>
                  <div
                    class="html-body"
                    v-html="DOMPurify.sanitize(extractHtmlFromMarkdown(content.content.content))"
                  ></div>
                </div>
                <div v-else v-html="renderMarkdown(content.content)" class="agent-content"></div>
              </div>
            </div>

            <!-- 代码块 -->
            <div v-else-if="content.type === 'code'" class="code-block">
              <div class="code-header">
                <span class="language-tag">{{ content.language }}</span>
                <el-button
                  type="primary"
                  text
                  :icon="CopyDocument"
                  @click="copyCode(content.content)"
                >
                  复制
                </el-button>
              </div>
              <pre><code class="code-content" :class="`language-${content.language}`">{{ content.content }}</code></pre>
            </div>

            <!-- 图片 -->
            <div v-else-if="content.type === 'image'" class="image-content">
              <el-image
                :src="content.content"
                :alt="content.alt"
                :preview-src-list="[content.content]"
                fit="cover"
                class="message-image"
              />
            </div>
            <!-- 链接 -->
            <div v-else-if="content.type === 'link'" class="link-content">
              <el-link :href="content.content" target="_blank" :underline="false">
                <el-icon><Link /></el-icon>
                {{ content.alt || content.content }}
              </el-link>
            </div>
          </div>

          <!-- 消息状态 -->
          <div class="message-status">
            <el-tag size="small" :type="getStatusType(message.status)">
              {{ getStatusText(message.status) }}
            </el-tag>
            <span class="timestamp">{{ formatTime(message.timestamp) }}</span>
          </div>

          <!-- 工作流信息 -->
          <div v-if="message.workflowInfo" class="workflow-info">
            <el-collapse>
              <el-collapse-item>
                <template #title>
                  <div class="workflow-title">
                    <el-tag :type="getWorkflowStatusType(message.workflowInfo.status)" size="small">
                      工作流: {{ message.workflowInfo.name }}
                    </el-tag>
                  </div>
                </template>
                <div class="workflow-logs">
                  <pre><code>{{ message.workflowInfo.logs?.join('\n') || '暂无日志' }}</code></pre>
                </div>
              </el-collapse-item>
            </el-collapse>
          </div>
        </div>
      </div>
    </div>

    <!-- 输入区域 -->
    <div class="input-area">
      <div class="toolbar">
        <el-button-group>
          <el-tooltip content="上传图片" placement="top">
            <el-button :icon="Picture" @click="triggerImageUpload" />
          </el-tooltip>
          <el-tooltip content="插入代码块" placement="top">
            <el-button :icon="Document" @click="insertCodeBlock" />
          </el-tooltip>
          <el-tooltip content="插入链接" placement="top">
            <el-button :icon="Link" @click="insertLink" />
          </el-tooltip>
        </el-button-group>
        <!-- 隐藏的文件输入框 -->
        <input
          ref="fileInput"
          type="file"
          accept="image/*"
          @change="handleFileSelect"
          style="display: none"
        />
      </div>

      <el-input
        v-model="localUserInput"
        type="textarea"
        :rows="3"
        placeholder="输入您的问题或指令... (Ctrl+Enter发送)"
        :disabled="loading"
        @keydown.enter.ctrl="sendMessage"
        class="message-input"
      />

      <div class="send-area">
        <div class="hint">Ctrl+Enter 发送</div>
        <el-button
          type="primary"
          :icon="Promotion"
          :loading="loading"
          :disabled="!localUserInput.trim() || loading"
          @click="sendMessage"
          class="send-button"
        >
          {{ loading ? '发送中...' : '发送' }}
        </el-button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, watch, nextTick } from 'vue'
import {
  UserFilled,
  Service,
  Document,
  Picture,
  Link,
  Promotion,
  CopyDocument,
  Loading,
  Cpu,
  Tools,
  RefreshRight,
  Check,
  Warning,
  ArrowRight,
  CircleCheck,
  View,
  ArrowDown,
} from '@element-plus/icons-vue'
import { ElMessage } from 'element-plus'
import TypewriterText from '@/components/common/TypewriterText.vue'
import { marked } from 'marked'
import DOMPurify from 'dompurify'
import dayjs from 'dayjs'
import { extractHtmlFromMarkdown } from '@/utils/htmlUtils'
import { FileStorageService } from '@/api/cloudStorageService'

const props = defineProps({
  messages: Array,
  userInput: String,
  loading: Boolean,
  agent: Object,
})

const emit = defineEmits([
  'sendMessage',
  'insertCodeBlock',
  'insertLink',
  'handleImageUpload',
  'update:userInput',
])

// 本地输入状态，用于v-model绑定
const localUserInput = ref('')
const messagesContainer = ref(null)
const fileInput = ref(null)

// 思考完成处理函数
const onThinkingComplete = (message) => {
  // 标记思考内容已完成
  message.thinkingCompleted = true
}

// 监听props中的userInput变化，同步到本地状态
watch(
  () => props.userInput,
  (newVal) => {
    localUserInput.value = newVal || ''
  },
  { immediate: true },
)

// 监听本地输入状态变化，通过事件同步到父组件
watch(localUserInput, (newVal) => {
  emit('update:userInput', newVal)
})

// 监听消息变化，自动滚动到底部
watch(
  () => props.messages,
  () => {
    nextTick(() => {
      scrollToBottom()
    })
  },
  { deep: true },
)

const scrollToBottom = () => {
  if (messagesContainer.value) {
    messagesContainer.value.scrollTop = messagesContainer.value.scrollHeight
  }
}

const sendMessage = () => {
  if (!localUserInput.value.trim() || props.loading) return
  emit('sendMessage')
}

const insertCodeBlock = () => {
  emit('insertCodeBlock')
}

const insertLink = () => {
  emit('insertLink')
}

// 触发图片上传
const triggerImageUpload = () => {
  fileInput.value.click()
}

// 处理文件选择
const handleFileSelect = async (event) => {
  const file = event.target.files[0]
  if (!file) return

  // 检查文件类型
  if (!file.type.startsWith('image/')) {
    ElMessage.error('请选择图片文件')
    return
  }

  // 检查文件大小 (限制为5MB)
  if (file.size > 5 * 1024 * 1024) {
    ElMessage.error('图片大小不能超过5MB')
    return
  }

  try {
    // 上传文件
    const uploadData = {
      file: file,
      metadata: {
        type: 'chat_image',
        timestamp: new Date().toISOString(),
      },
    }

    const response = await FileStorageService.uploadFile(uploadData)

    // 生成图片消息内容
    const imageContent = `![image](${response.url})`

    // 将图片链接插入到输入框中
    localUserInput.value += imageContent + '\n'

    ElMessage.success('图片上传成功')
  } catch (error) {
    console.error('图片上传失败:', error)
    ElMessage.error(`图片上传失败: ${error.message || '未知错误'}`)
  } finally {
    // 清空文件输入框
    event.target.value = ''
  }
}

// 处理图片上传事件
const handleImageUpload = () => {
  triggerImageUpload()
}

const copyCode = (content) => {
  navigator.clipboard
    .writeText(content)
    .then(() => {
      ElMessage.success('代码已复制到剪贴板')
    })
    .catch(() => {
      ElMessage.error('复制失败')
    })
}

// 复制消息内容
const copyMessageContent = (content, message) => {
  let textToCopy = ''

  if (content.type === 'text' || content.type === 'agent_call') {
    textToCopy = content.content || ''
  } else if (content.type === 'htmlDisplay') {
    textToCopy = content.content || ''
  } else if (content.type === 'code') {
    textToCopy = content.content || ''
  } else if (content.type === 'link') {
    textToCopy = content.content || ''
  }

  if (!textToCopy) {
    ElMessage.warning('没有可复制的内容')
    return
  }

  navigator.clipboard
    .writeText(textToCopy)
    .then(() => {
      ElMessage.success('内容已复制到剪贴板')
    })
    .catch(() => {
      ElMessage.error('复制失败')
    })
}

// 复制HTML内容
const copyHtml = (content) => {
  navigator.clipboard
    .writeText(content)
    .then(() => {
      ElMessage.success('HTML已复制到剪贴板')
    })
    .catch(() => {
      ElMessage.error('复制失败')
    })
}

// 处理工作流执行结果内容
const processWorkflowContent = (content, toolName) => {
  // 检查是否是工作流执行工具调用
  if (toolName && toolName.startsWith('execute_workflow_')) {
    try {
      // 尝试解析JSON内容
      const jsonData = JSON.parse(content)

      // 检查是否符合指定的格式
      if (
        jsonData.result &&
        jsonData.result.input &&
        jsonData.result.input.type === 'htmlDisplay' &&
        jsonData.result.input.htmlContent
      ) {
        // 返回处理后的HTML显示内容
        return {
          type: 'htmlDisplay',
          content: jsonData.result.input.htmlContent,
        }
      }
    } catch (e) {
      // JSON解析失败，按普通文本处理
      console.warn('Failed to parse workflow content as JSON:', e)
    }
  }

  // 不符合特殊处理条件，按原样返回
  return null
}

const renderMarkdown = (content) => {
  // 使用 DOMPurify 和 marked 库渲染 Markdown
  try {
    // 确保已导入 DOMPurify 和 marked
    if (typeof marked !== 'undefined' && typeof DOMPurify !== 'undefined') {
      // 如果看起来像 Markdown，就进行解析
      const html = marked.parse(content)
      return DOMPurify.sanitize(html)
    }
    return content
  } catch (error) {
    console.error('Markdown 渲染错误:', error)
    // 出错时返回原始内容，确保内容始终显示
    return content
  }
}

const formatTime = (timestamp) => {
  if (!timestamp) return ''

  // 使用 dayjs 格式化时间
  try {
    return dayjs(timestamp).format('HH:mm:ss')
  } catch (error) {
    console.error('时间格式化错误:', error)
    return timestamp.toString()
  }
}

const getStatusType = (status) => {
  // 根据状态返回对应的类型
  switch (status) {
    case 'sending':
      return 'info'
    case 'sent':
      return 'success'
    case 'received':
      return 'success'
    case 'error':
      return 'danger'
    case 'pending':
      return 'warning'
    default:
      return 'info'
  }
}

const getStatusText = (status) => {
  // 根据状态返回对应的文本
  switch (status) {
    case 'sending':
      return '发送中'
    case 'sent':
      return '已发送'
    case 'received':
      return '已接收'
    case 'error':
      return '发送失败'
    case 'pending':
      return '等待中'
    default:
      return status
  }
}

const getWorkflowStatusType = (status) => {
  // 根据工作流状态返回对应的类型
  switch (status) {
    case 'running':
      return 'info'
    case 'completed':
      return 'success'
    case 'failed':
      return 'danger'
    case 'pending':
      return 'warning'
    default:
      return 'info'
  }
}
</script>

<style scoped>
.chat-section {
  display: flex;
  overflow-y: auto;
  flex-direction: column;
  height: 100%;
  background-color: #f5f5f5;
}

.messages {
  flex: 1;
  overflow-y: auto;
  min-height: 0;
  padding: 16px;
  background-color: white;
}

.message {
  display: flex;
  margin-bottom: 16px;
  animation: fadeIn 0.3s ease-in;
}

.message.user {
  flex-direction: row-reverse;
}

.message.user .avatar {
  margin-right: 0;
  margin-left: 12px;
}

.avatar {
  margin-right: 12px;
  flex-shrink: 0;
}

.content {
  flex: 1;
  max-width: calc(100% - 48px);
}

.message-content {
  margin-bottom: 8px;
  position: relative;
  padding-bottom: 28px;
}

.copy-content-btn {
  position: absolute;
  bottom: 0;
  right: 0;
  opacity: 0;
  transition: opacity 0.2s ease;
}

.message-content:hover .copy-content-btn {
  opacity: 1;
}

.thinking-indicator {
  display: flex;
  align-items: center;
  gap: 8px;
  color: #909399;
  font-size: 14px;
  margin-bottom: 8px;
}

.thinking-content {
  margin: 8px 0 16px;
  border-radius: 8px;
  border: 1px dashed #c0c4cc;
  background-color: #f8f9fa;
  overflow: hidden;
}

.thinking-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  background-color: #ebeef5;
  color: #606266;
  font-size: 14px;
  font-weight: 500;
  border-bottom: 1px dashed #c0c4cc;
}

.thinking-body {
  padding: 12px;
  color: #606266;
  font-size: 14px;
  line-height: 1.5;
  white-space: pre-wrap;
  word-break: break-word;
  max-height: 300px;
  overflow-y: auto;
}

.thinking-body :deep(pre) {
  background-color: #f0f0f0;
  padding: 8px;
  border-radius: 4px;
  margin: 8px 0;
}

.thinking-body :deep(code) {
  font-family: 'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, Courier, monospace;
  font-size: 13px;
  color: #476582;
  background-color: rgba(27, 31, 35, 0.05);
  padding: 0.2em 0.4em;
  border-radius: 3px;
}

/* 交互状态样式 */
.interaction-status-container {
  margin: 8px 0;
  padding: 10px;
  border-radius: 8px;
  background-color: #f5f7fa;
  border: 1px solid #ebeef5;
}

.interaction-item {
  display: flex;
  align-items: center;
  padding: 6px 10px;
  margin-bottom: 6px;
  border-radius: 4px;
  font-size: 13px;
  color: #606266;
  transition: all 0.3s;
}

.interaction-item:last-child {
  margin-bottom: 0;
}

.interaction-item.running {
  background-color: #ecf5ff;
  border-left: 3px solid #409eff;
}

.interaction-item.completed {
  background-color: #f0f9eb;
  border-left: 3px solid #67c23a;
}

.interaction-item.error {
  background-color: #fef0f0;
  border-left: 3px solid #f56c6c;
}

.status-icon {
  margin-right: 8px;
  font-size: 14px;
}

.status-icon.RefreshRight {
  animation: rotating 2s linear infinite;
}

.completed-icon {
  margin-left: auto;
  color: #67c23a;
}

@keyframes rotating {
  from {
    transform: rotate(0deg);
  }
  to {
    transform: rotate(360deg);
  }
}

@keyframes pulse {
  0% {
    transform: scale(1);
    box-shadow: 0 0 0 0 rgba(255, 120, 0, 0.7);
  }
  70% {
    transform: scale(1);
    box-shadow: 0 0 0 10px rgba(255, 120, 0, 0);
  }
  100% {
    transform: scale(1);
    box-shadow: 0 0 0 0 rgba(255, 120, 0, 0);
  }
}

.text-content {
  padding: 12px 16px;
  border-radius: 8px;
  line-height: 1.5;
  white-space: normal;
  word-break: break-word;
}

.message.assistant .text-content {
  background-color: #f0f8ff;
  border: 1px solid #e1f0fa;
}

.message.user .text-content {
  background-color: #e8f4ff;
  border: 1px solid #d1e8ff;
}

/* HTML内容样式 */
.html-content {
  border: 1px solid #e1e4e8;
  border-radius: 8px;
  overflow: hidden;
  margin: 8px 0;
  background: white;
}

.html-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px 12px;
  background-color: #f0f0f0;
  border-bottom: 1px solid #e1e4e8;
}

.html-body {
  padding: 12px;
  max-height: 500px;
  overflow: auto;
}

.html-body :deep(*) {
  max-width: 100%;
}

.html-body :deep(img) {
  max-width: 100%;
  height: auto;
}

/* 交互状态样式 */
.interaction-status-container {
  margin: 8px 0;
  padding: 8px 12px;
  background-color: #f8f9fa;
  border-radius: 6px;
  border: 1px solid #e9ecef;
}

.interaction-item {
  display: flex;
  align-items: center;
  padding: 6px 8px;
  margin-bottom: 4px;
  border-radius: 4px;
}

.interaction-item.pending {
  background-color: #fffbea;
  border: 1px solid #ffe58f;
  color: #faad14;
}

.interaction-item.processing {
  background-color: #e6f7ff;
  border: 1px solid #91d5ff;
  color: #1890ff;
}

.interaction-item.completed {
  background-color: #f6ffed;
  border: 1px solid #b7eb8f;
  color: #52c41a;
}

.interaction-item.error {
  background-color: #fff1f0;
  border: 1px solid #ffa39e;
  color: #ff4d4f;
}

.status-icon {
  margin-right: 8px;
  font-size: 16px;
}

.status-text {
  flex: 1;
  font-size: 14px;
}

.completed-icon {
  font-size: 14px;
  margin-left: 8px;
}

.code-block {
  background: #f6f8fa;
  border-radius: 8px;
  overflow: hidden;
  margin: 8px 0;
  border: 1px solid #e1e4e8;
}

.code-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px 12px;
  background-color: #f0f0f0;
  border-bottom: 1px solid #e1e4e8;
}

.language-tag {
  font-size: 12px;
  font-weight: 500;
  color: #555;
}

.code-content {
  padding: 12px;
  overflow: auto;
  max-height: 300px;
  font-family: 'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, Courier, monospace;
  font-size: 14px;
  line-height: 1.4;
}

.image-content {
  margin: 8px 0;
  border-radius: 8px;
  overflow: hidden;
  max-width: 300px;
}

.message-image {
  max-width: 100%;
  border-radius: 8px;
}

.markdown-content {
  line-height: 1.6;
  word-break: break-word;
}
.markdown-content :deep(p) {
  margin-bottom: 1em;
}
.markdown-content :deep(pre) {
  /* 你的代码块样式 */
  background-color: #f6f8fa;
  padding: 16px;
  border-radius: 6px;
  overflow-x: auto;
}
.markdown-content :deep(code) {
  font-family: 'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, Courier, monospace;
}

.link-content {
  margin: 8px 0;
  padding: 8px 12px;
  border-radius: 8px;
  background-color: #f0f8ff;
  border: 1px solid #d0e4f4;
}

.message-status {
  display: flex;
  align-items: center;
  margin-top: 4px;
  font-size: 12px;
  color: #999;
}

.timestamp {
  margin-left: 8px;
}

.workflow-info {
  margin-top: 8px;
}

.workflow-title {
  display: flex;
  align-items: center;
}

.workflow-logs {
  padding: 8px 12px;
  background-color: #f8f9fa;
  border-radius: 4px;
}

.workflow-logs pre {
  margin: 0;
  white-space: pre-wrap;
  word-break: break-word;
  font-size: 12px;
  line-height: 1.4;
}

.workflow-logs code {
  font-family: monospace;
}

.input-area {
  padding: 16px;
  background-color: white;
  border-top: 1px solid #eee;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
}

.toolbar {
  margin-bottom: 12px;
}

.message-input {
  margin-bottom: 12px;
  max-height: 200px;
}

.message-input :deep(.el-textarea__inner) {
  resize: none;
  max-height: 200px;
}

.send-area {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.hint {
  font-size: 12px;
  color: #999;
}

.send-button {
  min-width: 80px;
}

@keyframes fadeIn {
  from {
    opacity: 0;
    transform: translateY(10px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

/* 响应式设计 */
@media (max-width: 768px) {
  .messages {
    padding: 12px;
  }

  .message {
    margin-bottom: 12px;
  }

  .input-area {
    padding: 12px;
  }

  .send-area {
    flex-direction: column;
    gap: 8px;
    align-items: flex-end;
  }

  .hint {
    align-self: flex-start;
  }
}

.agent-content {
  line-height: 1.6;
}

.agent-content :deep(p) {
  margin-bottom: 1em;
}

.agent-call-content {
  margin: 12px 0;
  border-radius: 8px;
  overflow: hidden;
  border: 1px solid #d1e8ff;
  background-color: #f0f8ff;
}

.agent-call-header {
  padding: 8px 12px;
  background-color: #e1f0fa;
  border-bottom: 1px solid #d1e8ff;
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
}

.tool-call-tag {
  font-weight: bold;
  animation: pulse 2s infinite;
}

.agent-call-body {
  padding: 12px 20px;
  background-color: white;
}

.agent-call-body :deep(*) {
  max-width: 100%;
}

.agent-call-body :deep(img) {
  max-width: 100%;
  height: auto;
}

.agent-call-body :deep(hr) {
  margin: 1em 0;
  border: none;
  border-top: 1px dashed #ccc;
}

/* 交互状态样式 */
.interaction-status-container {
  margin: 8px 0;
  padding: 8px 12px;
  background-color: #f8f9fa;
  border-radius: 6px;
  border: 1px solid #e9ecef;
}

.interaction-item {
  display: flex;
  align-items: center;
  padding: 6px 8px;
  margin-bottom: 4px;
  border-radius: 4px;
}

.interaction-item.pending {
  background-color: #fffbea;
  border: 1px solid #ffe58f;
  color: #faad14;
}

.interaction-item.processing {
  background-color: #e6f7ff;
  border: 1px solid #91d5ff;
  color: #1890ff;
}

.interaction-item.completed {
  background-color: #f6ffed;
  border: 1px solid #b7eb8f;
  color: #52c41a;
}

.interaction-item.error {
  background-color: #fff1f0;
  border: 1px solid #ffa39e;
  color: #ff4d4f;
}

.status-icon {
  margin-right: 8px;
  font-size: 16px;
}

.status-text {
  flex: 1;
  font-size: 14px;
}

.completed-icon {
  font-size: 14px;
  margin-left: 8px;
}

.iteration-tag {
  background-color: rgba(255, 255, 255, 0.2) !important;
  color: white !important;
  border-color: rgba(255, 255, 255, 0.3) !important;
}

@keyframes pulse-border {
  0%,
  100% {
    border-color: #91d5ff;
    box-shadow: 0 0 0 0 rgba(145, 213, 255, 0.4);
  }
  50% {
    border-color: #409eff;
    box-shadow: 0 0 0 4px rgba(145, 213, 255, 0.2);
  }
}

.task-name {
  flex: 1;
  font-size: 13px;
}

/* 思考过程样式 */
.thinking-process {
  border-bottom: 1px solid #e0d5f9;
}

.thinking-process-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 16px;
  background-color: rgba(118, 75, 162, 0.1);
  cursor: pointer;
  font-size: 13px;
  font-weight: 500;
  color: #764ba2;
  transition: background-color 0.3s;
}

.thinking-process-header:hover {
  background-color: rgba(118, 75, 162, 0.15);
}

.toggle-icon {
  margin-left: auto;
  transition: transform 0.3s;
}

.toggle-icon.is-reverse {
  transform: rotate(180deg);
}

.thinking-process-body {
  padding: 12px 16px;
  background-color: rgba(255, 255, 255, 0.7);
  font-size: 13px;
  color: #666;
  line-height: 1.6;
  max-height: 300px;
  overflow-y: auto;
}

/* Worker 结果样式 */
.worker-results {
  padding: 12px 16px;
  border-bottom: 1px solid #e0d5f9;
}

.worker-results-header {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  font-weight: 500;
  color: #764ba2;
  margin-bottom: 10px;
}

.worker-results-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.worker-result-item {
  background-color: white;
  border-radius: 8px;
  border: 1px solid #e0d5f9;
  overflow: hidden;
}

.worker-result-item.running {
  border-color: #91d5ff;
}

.worker-result-item.completed {
  border-color: #b7eb8f;
}

.worker-result-item.error {
  border-color: #ffa39e;
}

.worker-result-header {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  background-color: rgba(248, 245, 255, 0.8);
  border-bottom: 1px solid #e0d5f9;
}

.worker-avatar-sm {
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  color: white;
  font-weight: 600;
  font-size: 11px;
}

.worker-result-name {
  flex: 1;
  font-size: 13px;
  font-weight: 500;
}

.worker-result-content {
  padding: 12px;
  font-size: 13px;
  line-height: 1.6;
}

.worker-result-content :deep(p) {
  margin-bottom: 0.5em;
}

.worker-result-content :deep(pre) {
  background-color: #f6f8fa;
  padding: 12px;
  border-radius: 6px;
  overflow-x: auto;
}

.worker-result-content :deep(code) {
  font-family: 'SFMono-Regular', Consolas, monospace;
  font-size: 12px;
}

/* DeepAgent 主体内容 */
.deep-agent-body {
  padding: 16px;
  background-color: white;
}

.deep-agent-content {
  line-height: 1.7;
}

.deep-agent-content :deep(p) {
  margin-bottom: 1em;
}

.deep-agent-content :deep(pre) {
  background-color: #f6f8fa;
  padding: 16px;
  border-radius: 8px;
  overflow-x: auto;
  margin: 1em 0;
}

.deep-agent-content :deep(code) {
  font-family: 'SFMono-Regular', Consolas, monospace;
  font-size: 13px;
}

.deep-agent-content :deep(ul),
.deep-agent-content :deep(ol) {
  margin-left: 1.5em;
  margin-bottom: 1em;
}

.deep-agent-content :deep(li) {
  margin-bottom: 0.3em;
}
</style>
