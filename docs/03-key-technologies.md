# JAI 关键技术点面试话术

---

## 1. Redis 的使用

### 项目中怎么用的

| 用途 | Key 格式 | TTL | 说明 |
|------|----------|-----|------|
| 邮箱激活 token | `verify_token:{token}` | 24小时 | 注册时生成，点击邮件链接消费 |
| 忘记密码验证码 | `forget_password_code:{email}` | 5分钟 | 发邮件时生成 |
| 重置密码 token | `reset_password_token:{token}` | 15分钟 | 验证码通过后生成 |

Redis 客户端封装：`github.com/mszlu521/thunder/cache.RedisCache`，开启了 AOF 持久化（`--appendonly yes`）

### 面试标准话术

> "项目中 Redis 主要用于认证流程的临时状态存储。以邮箱激活为例：用户注册时，我们生成一个 16 字节的密码学安全随机 token，以 `verify_token:{token}` 为 key 存入 Redis，TTL 设为 24 小时；用户点击激活链接后，我们从 Redis 取出对应的 userId，验证通过后将该 key 设置为 1 秒过期（用超时代替直接 Del，更安全），再更新数据库用户状态。整个流程无需额外的数据库表，状态自动过期，非常轻量。"
>
> "Redis 使用 AOF 持久化，保证重启后验证码数据不丢失。如果规模扩大需要多实例，可以使用 Redis Cluster，但要注意 key 的哈希槽分布，避免集群模式下 key 路由到不同节点导致问题。"

---

## 2. PostgreSQL 设计

### 核心表结构

```
users             ← 用户基础信息（uuid主键、bcrypt密码、邮箱状态、计划类型）
agents            ← Agent 配置（model_provider、model_name、system_prompt、model_parameters jsonb）
agent_tools       ← Agent-Tool 多对多关联
agent_knowledge_bases ← Agent-KnowledgeBase 多对多
agent_workflows   ← Agent-Workflow 多对多（含 is_default/priority/trigger_condition）
workflows         ← 工作流定义（data jsonb 存 Graph 结构）
knowledge_bases   ← 知识库元数据（embedding_model_name/provider，storage_type）
documents         ← 上传文档信息（status: pending/processing/completed/failed）
document_chunks   ← 文档父分块（content, token_count, meta_info jsonb, chunk_index）
chat_sessions     ← 对话会话
chat_messages     ← 对话消息（role: user/assistant/system, content text）
llms              ← LLM 配置（provider_config jsonb 含 api_key/api_base）
tools             ← 自定义工具定义
```

### 关键设计

**UUID 主键（非自增 ID）：**
```go
type BaseModel struct {
    ID        uuid.UUID `gorm:"type:uuid;primarykey;default:uuid_generate_v4()"`
    CreatedAt time.Time
    UpdatedAt time.Time
}
```
- 避免 ID 顺序可预测（安全）
- 天然适合分布式（全局唯一，无需协调）
- 代价：比 bigint 索引略大，范围查询性能稍差

**JSONB 字段（PostgreSQL 特有）：**
- `model_parameters jsonb`：存储 maxTokens/temperature/topP 等参数，字段随时可扩展无需 ALTER TABLE
- `data jsonb`：存储工作流的完整 Graph（节点+边），避免反范式的多表 JOIN
- `meta_info jsonb`：文档分块的元数据（章节号/卷号/页码），支持 Milvus 过滤用

**事务使用：**
```go
// 删除文档需要同时清理 3 个地方
s.repo.transaction(ctx, func(tx *gorm.DB) error {
    s.repo.deleteDocuments(ctx, tx, ...)      // PG documents 表
    s.repo.deleteDocumentChunks(ctx, tx, ...) // PG document_chunks 表
    s.deleteEsIndex(ctx, ...)                 // ES 索引（注意：ES 不支持 PG 事务！）
    return nil
})
```

> ⚠️ 注意：ES 删除被包在 PG 事务里，但 ES 操作实际上不参与 PG 事务的两阶段提交，这是一个潜在的一致性问题（见第 4 章优化点）

### 面试标准话术

> "数据库选型上，项目使用 PostgreSQL 而非 MySQL，主要因为 PostgreSQL 原生支持 JSONB 类型，可以对 JSON 字段建索引（GIN 索引），非常适合存储 AI 相关的半结构化数据，比如模型参数配置、工作流 DAG 数据等。这些数据字段多且变化频繁，用 JSONB 比逐字段建表灵活得多。"
>
> "主键选用 UUID 而非自增 ID，一方面是安全性考虑（防止遍历爬取），另一方面为分布式扩展留出空间——UUID 全局唯一，不需要数据库序列协调，方便未来做分库分表。"

---

## 3. Milvus 向量数据库

### 项目中怎么用的

1. 每个知识库对应一个 Milvus Collection，命名规则：`kb_{uuid}`（连字符替换为下划线）
2. Collection Schema：`id(varchar)` + `parent_id(varchar)` + `doc_id(varchar)` + `content(varchar 8192)` + `vector(float32[768])` + `metadata(json)`
3. 索引类型：HNSW，COSINE 相似度，M=16，efConstruction=200
4. 分批写入：每批 50 条，防止大文档一次性写入超时

### 向量检索流程

```
用户查询 "凡人修仙第500章"
    │
    ▼
parseQueryIntent (LLM提取): keywords="内容", chapter_num=500
    │
    ▼
Embedding 模型: text → float32[768]
    │
    ▼
Milvus 检索 (ef=64, topK=10)
过滤条件: metadata['chapter_num'] == 500
    │
    ▼
返回 Top-10 Child 文档 (带 parent_id)
    │
    ▼
PostgreSQL 查询 parent 完整内容 (IN parent_ids[:5])
    │
    ▼
组装返回给 LLM 的上下文
```

### 面试标准话术

> "知识库的向量存储使用 Milvus，索引选择 HNSW（层次可导航小世界图）。HNSW 是一种近似最近邻算法，建图时构建多层稀疏到密集的导航图，查询时从顶层快速定位再逐层精化，在 768 维的 Embedding 向量下，相比暴力搜索可以达到 100 倍以上的加速，同时 recall@10 仍在 95% 以上。"
>
> "项目中采用了 Parent-Child 两级分块检索策略：写入时把文档拆成小块（child，约400字）存入 Milvus，大块（parent，约1200字）存入 PostgreSQL；检索时先用小块精准定位（向量语义相关），再通过 parent_id 回查大块给 LLM（提供足够的上下文）。这是目前 RAG 工程实践中效果最好的分块策略之一。"

---

## 4. 并发控制

### goroutine 并发处理

**异步文档处理（knowledges/service.go:323）：**
```go
// 上传接口立即返回，文档处理在后台进行
go func() {
    ctx = context.Background()  // 独立的 context，不随请求 context 取消
    s.repo.updateDocumentStatus(ctx, doc.ID, model.DocumentStatusProcessing)
    err = s.processDocumentAndVectorAndStore(ctx, ...)
    if err != nil {
        s.repo.updateDocumentStatus(ctx, doc.ID, model.DocumentStatusFailed)
        return
    }
    s.repo.updateDocumentStatus(ctx, doc.ID, model.DocumentStatusCompleted)
}()
return doc, nil  // 立即返回 pending 状态
```

**关键点**：goroutine 里使用新的 `context.Background()` 而不是请求 context，因为请求结束后 context 会被取消，导致正在进行的文档处理中断。

**RWMutex 保护面试状态（agents/service.go:46）：**
```go
type service struct {
    stateMutex    sync.RWMutex                    // 读写锁
    interviewStates map[string]*interview.StageState
    waitingStates   map[string]bool
}

func (s *service) isWaitingForAnswer(sessionId string) bool {
    s.stateMutex.RLock()    // 读锁（允许多并发读）
    defer s.stateMutex.RUnlock()
    return s.waitingStates[sessionId]
}
```

**sync.Once 单例初始化（workflow_execute.go:44）：**
```go
func (w *WorkflowExecutor) initRegistry() {
    w.once.Do(func() {    // 无论多少 goroutine 并发调用，只执行一次
        w.nodeRegistry[nodes.TextDisplay] = ...
        w.nodeRegistry[nodes.QwenVL] = ...
    })
}
```

### 面试标准话术

> "项目中并发控制主要体现在三处。第一，文档向量化的异步处理：使用 goroutine 将耗时的 Embedding 计算和 Milvus 写入放到后台，避免阻塞 HTTP 请求。goroutine 里使用独立的 `context.Background()` 而非请求 context，防止请求完成后 context 被取消导致处理中断。第二，面试状态的并发保护：多个用户可能同时进行 AI 面试，`interviewStates` map 需要并发读写，这里用了 `sync.RWMutex`，读操作加读锁（多个协程可以同时持有读锁），写操作加写锁（独占），在读多写少的场景下比全互斥锁性能更好。第三，工作流注册表的初始化用 `sync.Once` 保证只执行一次，这是 Go 中实现线程安全单例的标准做法。"

---

## 5. Eino AI 框架（字节跳动开源）

### 核心抽象层次

```
eino 框架
├── components/model    # ChatModel 接口（统一 OpenAI/Qwen/Ollama）
├── components/tool     # Tool 接口（BaseTool/InvokableTool）
├── components/embedding # Embedder 接口
├── components/retriever # Retriever 接口
├── components/prompt   # PromptTemplate
├── compose             # DAG 编排（Workflow/Graph/Chain）
│   ├── Workflow        # 有向图，用于工作流
│   ├── Graph           # 通用图，用于 Agent
│   └── Chain           # 顺序链
└── adk                 # Agent Development Kit
    ├── ChatModelAgent  # ReAct 模式 Agent
    ├── middlewares/skill # Skill 中间件
    └── prebuilt/supervisor # 多 Agent Supervisor 模式
```

### 面试标准话术

> "项目使用字节跳动开源的 Eino 框架作为 AI 编排引擎。Eino 的核心价值是提供了统一的接口抽象：无论底层用 OpenAI、通义千问还是 Ollama 本地模型，对上层业务代码暴露的都是同一个 `ToolCallingChatModel` 接口。工作流引擎使用 `compose.Workflow` 构建 DAG，`AddLambdaNode` 将任意函数包装成节点，`Compile` 阶段做图验证和拓扑排序，`Invoke` 阶段按依赖关系执行。Agent 部分使用 `adk.NewChatModelAgent` 快速创建 ReAct Agent，内部自动处理 LLM 推理→工具调用→结果回填的循环逻辑。"

---

## 6. 事件总线（模块间解耦）

### 项目中怎么用的

```go
// router/event.go：注册事件处理器
event.Register("getProviderConfig", llmService.GetProviderConfig)
event.Register("getEmbeddingConfig", llmService.GetEmbeddingConfig)
event.Register("getToolsByIds", toolService.GetToolsByIds)
event.Register("getKnowledgeBase", knowledgeService.GetKnowledgeBase)
event.Register("searchKnowledgeBase", knowledgeService.SearchKnowledgeBase)

// 使用方（如 knowledges/service.go）
trigger, _ := event.Trigger("getProviderConfig", &shared.GetProviderConfigsRequest{...})
result := trigger.(*model.ProviderConfig)
```

### 面试标准话术

> "项目内部模块间通信使用了事件总线模式（`thunder/event`）。比如知识库模块需要获取 LLM 配置时，不是直接 import llms 包，而是通过 `event.Trigger("getProviderConfig", params)` 发出事件，由 llms 模块的 handler 响应。这样做的好处是打破了包的循环依赖，同时让各模块的边界更清晰——知识库模块不需要关心 LLM 配置怎么存储和查询的。这是一种同进程内的'接口倒置'实现，类似于 Spring 的事件机制，但更轻量。"

---

## 7. MCP（Model Context Protocol）集成

### 项目中怎么用的

```go
// core/ai/mcps/mcp.go
// mcp-server 暴露工具接口（JSON-RPC over SSE）
// Agent 启动时通过 MCP 客户端拉取工具列表
mcpTools, _ := mcps.GetMcpTools(ctx, agent.McpServers)
allTools = append(allTools, mcpTools...)
```

MCP Server（mcp-server/ 目录）：Hertz 框架，提供 weather 工具的 MCP 实现

### 面试标准话术

> "项目实现了 MCP（Anthropic 提出的模型上下文协议）的 Server 端和 Client 端。MCP Server 端（mcp-server）以 SSE 方式暴露工具接口，定义了 weather 工具。Agent 在启动时作为 MCP Client，连接配置的 MCP Server，拉取工具 schema 列表，动态注册为 Agent 可用的工具。这样做的优势是工具与 Agent 完全解耦，工具服务可以独立部署、独立更新，Agent 无需重启即可使用新工具。"

---

## 8. K8s 运维工具集成

### 项目中怎么用的

```go
// core/ai/tools/ops.go：内置 K8s 工具
tools.NewK8sResourceQueryTool()   // 查询 K8s 资源（Pod/Deployment/Service等）
tools.NewK8sLogsTool()            // 获取 Pod 日志
tools.NewK8sResourceActionTool()  // 执行 K8s 操作（扩缩容/重启等）
tools.NewK8sHealthCheckTool()     // 健康检查

// inits.go
err := tools.InitK8sClient()  // 初始化 k8s client（使用 kubeconfig 或 serviceAccount）
```

### 面试标准话术

> "项目将 K8s 运维能力封装成 AI 工具，这是一个很有特色的设计。用户可以用自然语言告诉 Agent '帮我查一下 prod 命名空间所有 Pod 的状态'，Agent 会调用 K8sResourceQueryTool，执行 kubectl get pods，返回结构化结果后再由 LLM 翻译成自然语言。这实现了 AI 运维助手的基础能力，是 AIOps 方向的典型应用。"
