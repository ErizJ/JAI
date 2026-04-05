# JAI 核心功能深度解析

---

## 功能一：用户注册与认证体系

### 1️⃣ 功能流程（用户视角）

**注册流程：**
用户填写用户名/邮箱/密码 → 后端校验唯一性 → bcrypt 加密密码 → 生成邮箱激活 token → 存 Redis（24小时） → 发激活邮件 → 用户点击链接 → Redis 取 token 验 userId → 激活账号

**登录流程：**
用户名/邮箱 + 密码 → 查库 → 邮箱验证检查 → bcrypt 比对 → 生成 JWT token + refreshToken → 返回

**忘记密码流程：**
邮箱 → 查用户 → 生成6位验证码 → Redis 存储(5分钟) → 发邮件 → 用户输入验证码 → 匹配成功 → 生成重置 token(15分钟) → 用 token 重置密码

### 2️⃣ 核心代码解析

**文件：`app/internal/auths/service.go`**

```go
// 注册核心逻辑（第30-103行）
func (s *service) register(req RegisterReq) (*RegisterResp, error) {
    // 1. 重复性检查（用户名 + 邮箱）
    u, _ := s.repo.findByUsername(ctx, req.Username)
    if u != nil { return nil, biz.ErrUserNameExisted }

    // 2. bcrypt 加密（DefaultCost=10，安全与性能的平衡）
    password, _ := bcrypt.GenerateFromPassword([]byte(req.Password), bcrypt.DefaultCost)

    // 3. 生成激活 token（crypto/rand，16字节随机，hex编码=32字符）
    tokenBytes := make([]byte, 16)
    rand.Read(tokenBytes)
    token := hex.EncodeToString(tokenBytes)

    // 4. Redis 存 token -> userId 映射，24小时过期
    tokenKey := fmt.Sprintf("verify_token:%s", token)
    s.cache.Set(tokenKey, userId.String(), 24*60*60)

    // 5. 事务保证：创建用户 + 发送邮件 原子性
    s.repo.transaction(ctx, func(tx *gorm.DB) error {
        s.repo.saveUser(ctx, tx, &user)
        s.sendVerifyEmail(user.Email, user.Username, token)
        return nil
    })
}
```

**关键设计点：**

1. **事务包裹发邮件**（第83-97行）：用户入库和邮件发送在同一事务中，若邮件发送失败则回滚用户创建，保证用户不会注册成功但收不到激活邮件。

2. **token 即用即销**（第133-134行）：邮件激活成功后，立即将 Redis 中的 key 设置为 1 秒过期（`defer s.cache.Set(tokenKey, "", 1)`），防止重复激活。这是一个延迟删除的优化，用 1 秒过期代替直接 Del，避免删除失败导致的问题。

3. **双 token 机制**（第191-217行）：
   - `token`：短期（配置中的 expire，一般几小时）
   - `refreshToken`：长期（refreshExpire，一般几天）
   - 无状态 JWT，Redis 中不存 token，减少 Redis 压力

### 3️⃣ 技术亮点

- **bcrypt 密码加密**：不可逆哈希，DefaultCost=10，每次加密结果不同（内置 salt），彻底防止彩虹表攻击
- **crypto/rand 生成 token**：使用密码学安全的随机数生成器，避免伪随机数被预测
- **Redis key 命名空间规范**：`verify_token:xxx`, `forget_password_code:xxx`, `reset_password_token:xxx` 三套独立命名空间，清晰且不冲突

### 4️⃣ 面试高频问题 + 标准回答

**Q: 为什么密码要用 bcrypt 而不是 MD5/SHA？**

> A: MD5 和 SHA 是快速哈希算法，GPU 每秒可以暴力计算数十亿次，彩虹表攻击极为有效。bcrypt 是慢哈希算法，内置 salt 和 cost 因子，cost=10 时每次计算约需 100ms，大幅增加暴力破解成本。另外 bcrypt 每次生成的哈希值不同（内置随机 salt），所以数据库泄露后，相同密码也无法通过对比发现。

**Q: JWT token 如果被盗怎么办？**

> A: 这是 JWT 无状态的固有缺陷。项目目前使用双 token 机制缓解：access token 生命周期短（如 2 小时），refreshToken 生命周期长但也有限。若要完善，可以在 Redis 中维护一个 token 黑名单（用 token 的 jti 字段作为 key），登出时将 token 加入黑名单，每次验证时先检查黑名单。这以牺牲少量状态换取安全性。

**Q: Redis 存验证码的 key 为什么用邮箱而不是 uuid？**

> A: 一是方便：验证时用户提交邮箱和验证码，直接用邮箱 key 查询无需额外映射；二是防刷：同一邮箱的验证码只会有一个 key，重复发送会覆盖旧验证码，避免一个邮箱有多个有效验证码。

**Q: 注册时发邮件在事务里，如果邮件服务宕机怎么办？**

> A: 这是项目的一个可优化点（见第 4 章）。当前实现是强依赖，邮件发送失败会回滚用户注册。优化方案：将发邮件解耦为异步任务，先完成用户注册，然后通过消息队列（Kafka/Redis Queue）异步发送邮件，失败时重试，提高可用性。

---

## 功能二：Agent 对话 + ReAct Tool Calling

### 1️⃣ 功能流程（用户视角）

用户选择一个 Agent（已配置模型/工具/知识库）→ 发送消息 → 后端构建 Agent 实例 → LLM 分析用户意图 → 决定调用哪些工具（天气/Git/K8s/知识库/工作流）→ 工具执行返回结果 → LLM 综合结果 → 继续思考或输出 → SSE 流式返回 token 给前端

### 2️⃣ 核心代码解析

**文件：`app/internal/agents/service.go`**

```go
// service 结构体（第44-51行）
type service struct {
    repo            repository
    stateMutex      sync.RWMutex          // 并发保护面试状态
    interviewStates map[string]*interview.StageState
    pendingAnswer   map[string]string
    waitingStates   map[string]bool
    checkPointStore compose.CheckPointStore  // 对话历史断点存储
}
```

**Agent 构建核心（buildAgent 函数关键逻辑）：**

```go
// 1. 从数据库加载 Agent 配置
agent, _ := s.repo.getAgent(ctx, agentId)

// 2. 根据 provider 构建不同的 ChatModel（策略模式）
var chatModel aiModel.ToolCallingChatModel
switch agent.ModelProvider {
case "ollama":
    chatModel, _ = ollama.NewChatModel(ctx, &ollama.ChatModelConfig{...})
case "qwen":
    chatModel, _ = qwen.NewChatModel(ctx, &qwen.ChatModelConfig{...})
default: // openai 兼容
    chatModel, _ = openai.NewChatModel(ctx, &openai.ChatModelConfig{...})
}

// 3. 聚合所有工具
var allTools []tool.BaseTool
// 3.1 系统内置工具（天气、Git、K8s）
allTools = append(allTools, tools.GetTools()...)
// 3.2 用户自定义工具（数据库中配置的）
allTools = append(allTools, userTools...)
// 3.3 MCP 工具（通过 MCP 协议从 mcp-server 拉取）
mcpTools, _ := mcps.GetMcpTools(ctx, agent.McpServers)
allTools = append(allTools, mcpTools...)
// 3.4 知识库检索工具（每个知识库封装成一个 Tool）
kbTools, _ := buildKnowledgeBaseTools(agent.KnowledgeBases)
allTools = append(allTools, kbTools...)
// 3.5 工作流工具（每个工作流封装成一个 Tool）
wfTools := buildWorkflowTools(agent.Workflows)
allTools = append(allTools, wfTools...)

// 4. 构建 ReAct Agent（eino adk）
agentInstance, _ := adk.NewChatModelAgent(ctx, &adk.ChatModelAgentConfig{
    Name:        agent.Name,
    Instruction: agent.SystemPrompt,
    Model:       chatModel,
    ToolsConfig: adk.ToolsConfig{
        ToolsNodeConfig: compose.ToolsNodeConfig{Tools: allTools},
    },
})

// 5. 流式执行
stream, _ := agentInstance.Stream(ctx, msgs)
// SSE 推送
for chunk := range stream {
    event.Publish("chat_token", chunk)
}
```

**工作流作为工具（`core/ai/workflow_tool.go`）：**

```go
// WorkflowTool 实现了 eino tool 接口
type WorkflowTool struct {
    workflow *model.Workflow
    node     *model.Node
}

// Info() 把工作流的 JSON Schema 暴露给 LLM
func (w *WorkflowTool) Info(ctx context.Context) (*schema.ToolInfo, error) {
    return &schema.ToolInfo{
        Name: "execute_workflow_" + w.workflow.Name,
        Desc: fmt.Sprintf("执行名为:%s的工作流，描述:%s，配置:%s",
            w.workflow.Name, w.workflow.Description, configJSON),
        ParamsOneOf: schema.NewParamsOneOfByParams(inputParams),
    }, nil
}

// InvokableRun() 当 LLM 决定调用该工作流时被触发
func (w *WorkflowTool) InvokableRun(ctx context.Context, argumentsInJSON string, ...) (string, error) {
    executor := NewWorkflowExecutor()
    executor.initRegistry()
    // 解析 LLM 传入的参数并注入到工作流的 start 节点
    var inputParams map[string]any
    json.Unmarshal([]byte(argumentsInJSON), &inputParams)
    params := w.ConvertParams(inputParams)  // 格式转换
    // 执行工作流 DAG
    result, _ := executor.Execute(w.workflow.Data)
    resultJson, _ := json.Marshal(result)
    return string(resultJson), nil
}
```

### 3️⃣ 技术亮点

1. **工具聚合架构**：系统工具 + MCP工具 + 知识库工具 + 工作流工具 统一聚合为 `[]tool.BaseTool`，Agent 无感知，扩展性极强

2. **工作流 Tool 化**：这是项目最核心的设计亮点。将工作流（DAG）封装成一个 Tool，LLM 可以在对话中自主决定是否"调用"某个工作流，实现了 Agent 与 Workflow 的融合

3. **多模型适配层**：通过 `eino` 框架统一了 OpenAI / Qwen / Ollama 等不同 API 格式，业务代码只需依赖 `aiModel.ToolCallingChatModel` 接口

4. **`sync.RWMutex` 保护状态**：面试状态（interviewStates）需要并发读写，用读写锁保证线程安全

5. **CheckPointStore**：对话历史通过 `compose.CheckPointStore` 持久化，支持会话恢复

### 4️⃣ 面试高频问题 + 标准回答

**Q: ReAct Agent 的工作原理是什么？**

> A: ReAct = Reasoning + Acting，是一种 Agent 范式。LLM 首先 Reasoning（推理）：分析用户问题，决定是否需要工具以及调用哪个工具、传入什么参数。然后 Acting（行动）：执行工具调用，获取结果。再次 Reasoning：将工具结果加入上下文，继续推理，决定是继续调用工具还是直接输出。这个循环一直进行，直到 LLM 认为可以给出最终答案。Eino 框架用 DAG 图来实现这个循环，LLM Node 和 ToolNode 之间有条件边，当 LLM 输出包含 tool_call 时走 ToolNode，否则走 END。

**Q: 如果有多个工具，LLM 怎么知道调用哪个？**

> A: 每个工具实现 `Info()` 方法，返回工具名称和 `Desc`（功能描述）、参数 schema。在构建 Agent 时，这些信息会被格式化放入系统提示词（function calling 格式），LLM 根据用户输入和工具描述来决策。所以工具的 `Desc` 写得是否清晰直接影响 LLM 的调用准确率。

**Q: 多个用户同时发起对话有并发问题吗？**

> A: Agent 实例是每次请求现建的（不是单例），所以不存在实例级并发问题。但 `service` 层的 `interviewStates` 等 map 是共享的，这里用了 `sync.RWMutex` 做读写锁保护。另外 ChatModel 的网络调用是无状态的，本身线程安全。真正的并发瓶颈在于下游 LLM API 的 rate limit 和数据库连接池。

**Q: SSE 是怎么实现的？如果客户端断开怎么处理？**

> A: 服务端通过 Gin 设置 `Content-Type: text/event-stream`，然后持续 `flush` 数据到响应流。A2A Server 使用 Hertz 框架并配置了 `WithSenseClientDisconnection(true)` 来感知客户端断连，触发 Context 取消，从而中止 LLM 流式推送。

---

## 功能三：RAG 知识库（文档处理 + 向量检索）

### 1️⃣ 功能流程（用户视角）

**文档入库：**
上传文件（md/docx/pdf/html/epub）→ 后端识别格式 → 调用对应解析器 → 分层分块（Parent-Child） → Parent 块存 PostgreSQL → Child 块向量化（Embedding模型）→ 向量存 Milvus（HNSW索引）→ 异步完成，前端轮询状态

**知识库检索：**
用户提问 → LLM 解析查询意图（提取关键词/章节号/卷号）→ 向量化查询 → Milvus 检索 Top-K Child 块 → 通过 parent_id 反查 PostgreSQL 获取完整 Parent 块 → 返回相关上下文

### 2️⃣ 核心代码解析

**两级分块策略（`app/internal/knowledges/service.go` 第354-421行）：**

```
文档                    Parent（大块）               Child（小块，存Milvus）
 │                      PostgreSQL                   向量检索用
 │
Markdown ──→ 按 H2 分块（父），H3 分块（子）
Epub     ──→ 按章节分块（父，完整章节内容），500字子块
PDF      ──→ 按页/章节分块（父），400字子块，50字重叠
Docx     ──→ 按正文/标题/页脚分块（父），400字子块
HTML     ──→ 按 H1/H2 分块（父），代码块原子处理
通用      ──→ 1200字窗口滑动（父），400字子块，50字重叠
```

**父子块关系：**
- Parent（大块，存 PostgreSQL）：包含完整语义上下文，1200~2000字，用于回答时提供给 LLM
- Child（小块，存 Milvus）：200~500字，用于向量检索，每个 child 记录 `parent_id`

**Milvus 存储实现（`core/ai/kbs/milvus_vector.go`）：**

```go
const dim = 768  // 向量维度，需与 Embedding 模型一致

// HNSW 索引参数
hnswIndex, _ := entity.NewIndexHNSW(entity.COSINE, 16, 200)
// M=16 (图的最大出度), efConstruction=200 (建图时的搜索精度)

// 检索时
param, _ := entity.NewIndexHNSWSearchParam(64)  // ef=64（查询精度）
retriever, _ := reMilvus.NewRetriever(ctx, &reMilvus.RetrieverConfig{
    MetricType:  entity.COSINE,  // 余弦相似度
    VectorField: "vector",
    ...
})
```

**分批写入（第190-208行）：**
```go
// 防止单次写入过多导致 OOM 或超时
const batchSize = 50
for i := 0; i < total; i += batchSize {
    end := i + batchSize
    s.indexer.Store(ctx, docs[i:end])
}
```

**LLM 辅助查询意图解析（第1186-1238行）：**
```go
// 查询前先用 LLM 提取结构化意图
func (s *service) parseQueryIntent(ctx, kb, query) (*QueryIntent, error) {
    // 构建提示词，让 LLM 提取：keywords + volume_num + chapter_num
    prompt := `你是一个结构化数据提取助手...
    示例：问题："凡人修仙传第四卷第五百章讲了什么？"
    输出：{"keywords": "讲了什么", "volume_num": 4, "chapter_num": 500}`

    message, _ := chatModel.Generate(ctx, []*schema.Message{...})
    // 解析 LLM 输出的 JSON
    json.Unmarshal([]byte(rawJSON), &intent)
    // 兜底：解析失败则用原始 query 作为 keywords
    return &intent, nil
}

// 使用意图过滤
filter["chapter_num"] = intent.ChapterNum  // Milvus 精确过滤
childDocs, _ = store.Search(ctx, intent.Keywords, 10, filter)
```

### 3️⃣ 技术亮点

1. **Parent-Child 两级分块**：Child 小块向量相似度高，检索精准；Parent 大块上下文完整，减少 LLM 幻觉。这是当前 RAG 领域的最佳实践（也叫 "Small-to-Big Retrieval"）

2. **LLM 辅助意图解析**：不是直接把用户问题向量化检索，而是先用 LLM 提取章节号等结构化信息，结合 Milvus 的 metadata 过滤，大幅提升特定内容的检索精度

3. **异步处理文档**：文档向量化是计算密集型操作（调用 Embedding API + Milvus 写入），使用 goroutine 异步处理，接口立即返回，用户体验好

4. **VectorStore 接口抽象**：`core/ai/kbs/vector.go` 定义了 `VectorStore` 接口，Milvus 和 ES 各自实现，可以无缝切换存储后端（代码中两者都有实现，注释切换）

5. **面包屑路径前缀**：每个 chunk 的文本开头都加 `【书名:xxx】 > 【章节:yyy】` 的面包屑，让 LLM 知道这段文字的来源位置，提升回答质量

### 4️⃣ 面试高频问题 + 标准回答

**Q: 为什么要做两级分块，直接存大块或小块不行吗？**

> A: 这是 RAG 系统设计的核心 trade-off。只存小块：检索精度高，但上下文不足，LLM 可能因为缺乏上下文而产生错误回答。只存大块：上下文完整，但大块的向量是"平均化"的，当块内包含多个主题时，向量表达不精确，导致语义检索效果差。两级分块解决了这个矛盾：用小块做检索（精准），用大块喂给 LLM（完整），二者结合是 RAG 工程实践中效果最好的方案之一。

**Q: Milvus 的 HNSW 索引是什么？为什么选它？**

> A: HNSW（Hierarchical Navigable Small World）是一种基于图的近似最近邻（ANN）索引算法。它构建一个多层导航图，顶层稀疏（长程跳跃），底层密集（局部精确），查询时从顶层快速定位，再逐层收窄。相比暴力搜索（Flat 索引）：速度快 1000 倍以上；相比 IVF 索引：在低维（768维）下召回率更高、查询延迟更稳定。HNSW 的参数：M=16 控制图的连接度（越大越精确但占内存），efConstruction=200 控制建图质量，ef=64 控制查询时的搜索深度。

**Q: 文档处理过程中如果 Milvus 写入失败了，数据一致性怎么保证？**

> A: 这是项目的一个薄弱点。目前异步 goroutine 中，PostgreSQL 的 parent 块先存入，然后 Milvus 的 child 块写入。如果 Milvus 写入失败，document_chunks 表已有数据但向量索引没有，会导致搜索时找不到内容。当前的处理是将 document 状态更新为 failed，但 orphan 的 parent chunk 数据没有清理。优化方案：要么引入分布式事务（saga 模式：先写 Milvus，成功后写 PG；或者 PG 写成功后通过消息队列可靠触发 Milvus 写入），要么做定期清理任务，扫描 failed 状态的文档并清理孤儿数据。

**Q: 流量提升 10 倍，RAG 检索如何扩展？**

> A: 从几个层面扩展：① Milvus 集群化：Milvus 支持分布式部署，查询节点（QueryNode）水平扩展，每个 collection 可以分 shard；② Embedding 计算缓存：对同一查询的向量化结果做 Redis 缓存，减少 Embedding API 调用次数；③ 读写分离：Milvus 写节点和查询节点分离；④ 热数据 collection 加载到内存（Milvus 的 LoadCollection）；⑤ 结合 ES 做混合检索（BM25 关键词 + 向量语义），提升 recall。

---

## 功能四：工作流引擎（DAG 执行）

### 1️⃣ 功能流程（用户视角）

用户在前端拖拽节点（Start/TextDisplay/TextCombine/QwenVL/End）→ 连接边 → 保存工作流（数据库存 JSON）→ 执行工作流 → 后端解析 DAG → 按拓扑顺序执行各节点 → 返回结果

### 2️⃣ 核心代码解析

**工作流执行引擎（`core/ai/workflow_execute.go`）：**

```go
// 全局单例，使用 sync.Once 保证只初始化一次
var Executor *WorkflowExecutor

type WorkflowExecutor struct {
    nodeRegistry map[nodes.NodeType]NodeFactory  // 节点类型 -> 工厂函数
    once         sync.Once                        // 注册表只初始化一次
}

// Execute 核心逻辑（第60-153行）
func (w *WorkflowExecutor) Execute(data *model.Graph) (map[string]any, error) {
    // 1. 使用 eino compose 创建工作流
    wf := compose.NewWorkflow[map[string]any, map[string]any]()

    // 2. 构建 source/target 映射（O(n) 构建，O(1) 查询）
    sourceMap := make(map[string][]*model.Edge)  // targetNodeId -> []edges
    targetMap := make(map[string][]*model.Edge)  // sourceNodeId -> []edges

    // 3. 遍历所有节点，从注册表创建节点实例并添加到工作流
    for _, node := range data.Nodes {
        if node.Type == "start" || node.Type == "end" { continue }
        nodeFactory := w.nodeRegistry[nodes.NodeType(node.Type)]
        ref := wf.AddLambdaNode(node.ID,
            compose.InvokableLambda(nodeFactory(node.Data).Invoke))
        nodeRefs[node.ID] = ref
    }

    // 4. 处理边关系（合并同源同目标的多条边为字段映射）
    for _, edge := range data.Edges {
        if edge.Source == startNode.ID {
            nodeRefs[edge.Target].AddInput(compose.START)     // 起始节点
        } else if edge.Target == endNode.ID {
            wf.End().AddInput(edge.Source,                    // 结束节点
                compose.MapFields(edge.SourceHandle, edge.TargetHandle))
        } else {
            // 普通节点间的数据映射（将上游输出字段映射到下游输入字段）
            nodeRefs[key.Target].AddInputWithOptions(key.Source, mappings)
        }
    }

    // 5. 编译 + 执行（eino 内部构建 DAG，做拓扑排序）
    runner, _ := wf.Compile(ctx)
    result, _ := runner.Invoke(ctx, params)
    return results, nil
}
```

**节点接口（`core/ai/nodes/nodes.go`）：**
```go
type WorkflowNode interface {
    Invoke(ctx context.Context, input map[string]any) (map[string]any, error)
}
```

**策略模式注册表（第43-57行）：**
```go
func (w *WorkflowExecutor) initRegistry() {
    w.once.Do(func() {  // sync.Once 保证线程安全且只执行一次
        w.nodeRegistry[nodes.TextDisplay] = func(data map[string]any) nodes.WorkflowNode {
            return nodes.NewTextDisplayNode(data)
        }
        w.nodeRegistry[nodes.QwenVL] = func(data map[string]any) nodes.WorkflowNode {
            return nodes.NewQwenVLNode(data)
        }
        // ... 更多节点类型
    })
}
```

### 3️⃣ 技术亮点

1. **注册表 + 工厂方法**：节点类型与实现解耦，新增节点类型只需在注册表中添加一行，不需要修改执行引擎

2. **sync.Once 单次初始化**：注册表的初始化使用 `sync.Once`，保证并发安全且只执行一次，避免重复注册

3. **基于 eino 的 DAG 引擎**：复用字节跳动开源的 eino 框架来编排 DAG，eino 内部处理拓扑排序、并行执行（无依赖的节点可并行）、数据流转

4. **字段级数据映射**：边上有 `sourceHandle` 和 `targetHandle`，实现了节点输出字段到下游节点输入字段的精确映射，而不是传递整个 map

### 4️⃣ 面试高频问题 + 标准回答

**Q: 工作流 DAG 如果有环怎么处理？**

> A: DAG（有向无环图）本身定义就不能有环。eino 框架在 `wf.Compile(ctx)` 阶段会做图的验证，包括检测环路。如果存在环，Compile 会返回 error。这个设计与 Airflow、Prefect 等工作流引擎一致。前端拖拽时也应该做连线校验，防止用户创建环形依赖。

**Q: 如何保证工作流执行的幂等性？**

> A: 当前项目没有显式的幂等保证。工作流执行是有副作用的（调用 LLM API、修改状态）。完善方案：① 每次执行生成唯一的 executionId；② 幂等键缓存：相同 executionId 的请求只执行一次；③ 对于重要的工作流，加执行日志表，记录每次执行的输入输出和状态，支持重放和审计。

---

## 功能五：AI 面试系统（Supervisor 多 Agent 协作）

### 1️⃣ 功能流程（用户视角）

候选人发送简历文本 → Agent 识别为简历 → 进入面试流程 → **多阶段 AI 面试官**（技术一面→技术二面→终面→HR面）依次出题 → 每道题由 LLM 出题并评分 → 阶段分数 ≥ 60 分进入下一阶段 → 最终生成面试报告

### 2️⃣ 核心代码解析

**文件：`core/ai/interview/interview.go`**

**面试状态机（第37-52行）：**
```go
type StageState struct {
    Stage            int             // 当前阶段（0=简历检查 1=技术一面 2=技术二面 3=终面 4=HR）
    Round            int             // 当前题目轮次
    MaxRound         int             // 每阶段最多3题
    History          []QAPair        // 问答历史
    LastQuestion     string          // 上一道题（用于中断恢复）
    AwaitingAnswer   bool            // 关键标志：是否等待用户回答
    Score            float64         // 本阶段得分
    PreStagesSummary []StageSummary  // 前序阶段汇总（传递给下一面试官参考）
    StageScores      map[int]float64 // 各阶段分数
}
```

**中断/恢复机制（第127-268行）——这是整个面试系统最核心的设计：**

```go
func (a *InterviewStageAgent) Run(...) *adk.AsyncIterator[*adk.AgentEvent] {
    iter, gen := adk.NewAsyncIteratorPair[*adk.AgentEvent]()
    go func() {
        defer gen.Close()

        // 1. 如果处于等待回答状态，尝试获取用户已提交的答案
        if state.AwaitingAnswer && state.Round > 0 {
            if answer, ok := a.provider.GetAndClearAnswer(sessionKey); ok && answer != "" {
                // 用户已回答，进行 LLM 评分
                eval := a.evaluateWithLLM(ctx, state.History[lastIdx])
                state.AwaitingAnswer = false
                // 发送评价结果给前端
                gen.Send(&adk.AgentEvent{Output: ...feedbackMsg...})
            } else {
                // 用户还没回答，发送中断事件并等待
                gen.Send(adk.Interrupt(ctx, map[string]any{
                    "question": state.LastQuestion,
                    "awaiting": true,
                }))
                return  // 协程退出，等待下次调用 Resume
            }
        }

        // 2. 检查本阶段是否完成（3题全部回答）
        if state.Round >= state.MaxRound {
            state.Score = a.calculateScore(state)  // 计算阶段得分
            passed := state.Score >= 60             // 60分及格线
            if passed { state.Stage++ }             // 进入下一阶段
            gen.Send(&adk.AgentEvent{...stage_complete...})
            return
        }

        // 3. 生成下一道题，设置等待状态，发送中断
        question := a.generateQuestion(state)  // LLM 出题
        state.AwaitingAnswer = true
        gen.Send(adk.Interrupt(ctx, map[string]any{
            "question": question,
            "awaiting": true,
        }))
    }()
    return iter
}
```

**LLM 出题（结合简历上下文，第433-464行）：**
```go
func (a *InterviewStageAgent) generateQuestion(state *StageState) string {
    // 把简历内容、前序阶段评价、本轮历史问答 全部注入 prompt
    fullContext := a.buildInterviewContext(state)
    prompt := fmt.Sprintf(`你是%s（第%d轮，第%d题/共%d题）。
%s
【重要规则】
1. 必须结合简历，从简历中挑选具体经历切入
2. 参考前几轮评价决定难易程度
3. 禁止凭空捏造问题
请生成第%d题：`, a.name, state.Stage+1, state.Round, state.MaxRound, fullContext, state.Round)
    result, _ := a.llm.Generate(context.Background(), msgs)
    return result.Content
}
```

**LLM 评分（第370-391行）：**
```go
func (a *InterviewStageAgent) evaluateWithLLM(ctx, qa QAPair) *EvalResult {
    prompt := fmt.Sprintf(`评价回答（0-100分）：
【问题】%s
【回答】%s（%d字）
JSON格式：{"total_score":85,"dimensions":{"%s":85},"feedback":"评价","red_flags":[]}`,
        qa.Question, qa.Answer, len(qa.Answer), a.dimensions[0])
    // 兜底机制：LLM 失败时返回默认 75 分
    result, err := a.llm.Generate(...)
    if err != nil { return &EvalResult{TotalScore: 75, ...} }
    return a.parseEvalResult(result.Content)
}
```

### 3️⃣ 技术亮点

1. **基于 eino adk.Interrupt 的中断/恢复机制**：面试系统需要"问一道题、等用户回答、再继续"的交互模式，这在传统的 HTTP 请求-响应模型下很难实现。项目利用 eino 的 `adk.Interrupt` 机制，Agent 出完题后主动中断自身执行，等下次请求时携带答案 `Resume`，完美解决了多轮有状态交互问题

2. **StateProvider 接口抽象**（第85-94行）：将状态存取抽象为接口（`GetAndClearAnswer / GetState / SaveState / ClearState`），面试状态既可以存内存（当前实现），也可以换成 Redis 或数据库，不影响面试逻辑

3. **简历内容透传**：简历文本在面试全程传递给每个阶段 Agent（`ResumeContext`字段），每个 LLM 出题时都能基于候选人的具体项目经历提问，而不是泛泛而谈

4. **多维度评分**：每道题按 `dimensions`（考察维度，如"算法基础"、"系统设计"）打分，最终聚合为阶段总分，有风险点（抄袭/虚假）则额外扣 20 分

5. **阶段间上下文传递**：`PreStagesSummary` 把前序阶段的强项/弱项传给后续面试官，实现了"技术一面揪出弱点，技术二面重点考察"的递进效果

### 4️⃣ 面试高频问题 + 标准回答

**Q: AI 面试系统怎么实现多轮对话的状态保持？**

> A: 这是系统设计上最有挑战的部分。HTTP 是无状态协议，但面试需要"出题→等待回答→评分→出下一题"的有状态流程。解决方案是利用 eino 框架的 `adk.Interrupt` 机制：InterviewStageAgent 在发出一道题后调用 `gen.Send(adk.Interrupt(...))` 并 `return`，主动中断自身 goroutine；下次用户提交回答时，HTTP 请求携带 sessionId 进入 `agentMessage`，服务端将回答存入 `pendingAnswer` map，然后重新启动该阶段的 Agent（不是 Resume，而是重新 Run），Agent 启动时检测到 `AwaitingAnswer == true` 且 `pendingAnswer` 有数据，就取出来评分，然后继续。整个过程的状态通过 `StageState` 结构体（保存在内存 map 中，用 `sync.RWMutex` 保护）持久化跨请求。

**Q: 如果面试中途用户关闭浏览器怎么办？**

> A: 当前实现中，面试状态存在内存中（`interviewStates map[string]*StageState`），进程重启后状态丢失，用户无法续接面试。完善方案是将 `StageState` 序列化存入 Redis（key = sessionId，TTL = 24小时），这样进程重启或水平扩容后，任意实例都能恢复面试状态。`StateProvider` 接口已经为这个优化预留了扩展点，只需实现一个 `RedisStateProvider` 即可切换。

---

## 功能七：A2A 智能体协作协议

### 1️⃣ 功能流程

A2A（Agent-to-Agent）是 Google 提出的开放协议，让不同系统的 Agent 可以互相调用。项目中的 `a2a-server` 作为一个独立的 Agent 服务，通过 JSON-RPC 协议暴露出去，主 app 中的 Agent 可以通过 A2A 客户端调用它，实现多智能体协作。

### 2️⃣ 核心代码解析

```go
// a2a-server/main.go
// 注册一个 JSON-RPC 服务端点
r, _ := jsonrpc.NewRegistrar(ctx, &jsonrpc.ServerConfig{
    Router:      h,
    HandlerPath: "/a2a",  // 客户端调用地址
})

// 创建 Agent 并注册为 A2A 服务
chatModelAgent, _ := adk.NewChatModelAgent(ctx, &adk.ChatModelAgentConfig{
    Name: "高德天气查询智能体",
    Model: chatModel,  // Ollama 本地 Qwen3 模型
    ToolsConfig: adk.ToolsConfig{Tools: []tool.BaseTool{weatherTool}},
})

// 将 Agent 暴露为 A2A 服务
eino.RegisterServerHandlers(ctx, chatModelAgent, &eino.ServerConfig{
    Registrar: r,
    URL: "http://localhost:8777",  // 服务的公开地址
})
```

### 3️⃣ 技术亮点

- **去中心化多 Agent**：主 Agent 可以调用 A2A Server 上的 Agent，后者完全独立部署，支持异构技术栈
- **协议标准化**：A2A 是开放协议（基于 JSON-RPC），可以接入任何实现了该协议的 Agent 服务

### 4️⃣ 面试高频问题 + 标准回答

**Q: A2A 和 MCP 有什么区别？**

> A: 两者都是 AI 工具调用协议，但定位不同。MCP（Model Context Protocol，Anthropic 提出）解决的是 LLM 调用外部工具的标准化问题，工具是无状态的函数调用。A2A（Google 提出）解决的是 Agent 与 Agent 之间的协作问题，调用方是 Agent，被调用方也是 Agent（有自己的 LLM、工具和状态）。简单说：MCP 是 LLM 调用工具（函数），A2A 是 Agent 委托 Agent（微服务）。
