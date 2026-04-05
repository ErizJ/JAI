# JAI 项目可优化点（面试官视角）

> 面试时主动提出项目不足并给出优化方案，是展示技术深度和工程成熟度的重要机会。

---

## 1. 架构层面

### 问题：注册时发邮件与数据库事务耦合

**现状（`auths/service.go:83-97`）：**
```go
s.repo.transaction(ctx, func(tx *gorm.DB) error {
    s.repo.saveUser(ctx, tx, &user)     // DB 写入
    s.sendVerifyEmail(...)              // SMTP 调用（网络 IO！）
    return nil
})
```

**问题：**
- 如果 SMTP 服务宕机，用户注册会失败（强依赖邮件服务）
- SMTP 通常延迟高（100ms~1s），延长了数据库事务持有锁的时间
- 邮件服务与用户注册服务强耦合

**优化方案：**
```
用户注册 → DB 写入（事务结束）→ 投递消息队列（Kafka/Redis Queue）
                                        │
                         ┌──────────────▼──────────────┐
                         │   邮件发送 Worker（异步）     │
                         │   - 失败自动重试（3次）       │
                         │   - 死信队列记录失败邮件      │
                         └─────────────────────────────┘
```

---

### 问题：全局工具注册表是全局变量单例

**现状（`core/ai/tools/registry.go`）：**
```go
var _register *Registry  // 全局变量，非线程安全的替换操作
```

**问题：**
- `RegisterSystemTools` 覆盖整个注册表，线程不安全
- 不支持运行时动态注册/注销工具
- 测试困难（全局状态污染）

**优化方案：**
- 用 `sync.RWMutex` 保护注册表的读写
- 支持增量注册（`RegisterTool(tool)`）而非全量替换
- 考虑使用依赖注入，避免全局状态

---

### 问题：工作流文档处理 goroutine 泄漏风险

**现状（`knowledges/service.go:323`）：**
```go
go func() {
    ctx = context.Background()  // 无超时控制！
    s.processDocumentAndVectorAndStore(ctx, ...)
    // 如果 Milvus 一直不响应，这个 goroutine 会永远阻塞
}()
```

**问题：**
- goroutine 没有超时控制，可能永久泄漏
- 没有 goroutine 数量限制，大量上传时可能创建海量 goroutine

**优化方案：**
```go
// 使用 goroutine pool 控制并发数
pool := semaphore.NewWeighted(10)  // 最多 10 个并发处理任务
go func() {
    pool.Acquire(ctx, 1)
    defer pool.Release(1)

    // 带超时的 context
    ctx, cancel := context.WithTimeout(context.Background(), 30*time.Minute)
    defer cancel()

    s.processDocumentAndVectorAndStore(ctx, ...)
}()
```

---

## 2. 数据一致性问题

### 问题：PG 事务中包含 ES/Milvus 操作（跨存储事务）

**现状（`knowledges/service.go:533-558`）：**
```go
s.repo.transaction(ctx, func(tx *gorm.DB) error {
    s.repo.deleteDocuments(ctx, tx, ...)
    s.repo.deleteDocumentChunks(ctx, tx, ...)
    s.deleteEsIndex(ctx, ...)      // ES 不参与 PG 事务！
    s.deleteMilvusIndex(ctx, ...)  // Milvus 也不参与！
    return nil
})
```

**问题：**
- PG 事务回滚时，ES/Milvus 的删除操作**无法回滚**
- 如果 PG 成功但 ES/Milvus 失败（部分失败），数据不一致

**优化方案（Saga 模式）：**
```
步骤1: 逻辑删除文档（PG 标记 deleted=true）
步骤2: 异步消息触发 ES/Milvus 清理
步骤3: 所有异步步骤成功后物理删除 PG 记录

补偿事务：如果任意步骤失败，执行反向操作（恢复逻辑删除标记）
```

---

### 问题：文档分块写入的原子性

**现状：**
- Parent 分块写入 PG document_chunks
- Child 分块写入 Milvus
- 两个步骤不在同一事务中

**问题：** PG 写入成功但 Milvus 失败时，会产生孤儿 parent chunk（有元数据无向量）

**优化方案：**
- 增加重试机制：Milvus 写入失败时，记录失败任务到重试队列，定期重试
- 定期扫描：扫描 document_chunks 中没有对应 Milvus 向量的记录，触发补偿写入

---

## 3. 性能问题

### 问题：每次 Agent 对话都重新构建 ChatModel 实例

**现状：** 每次请求都 `ollama.NewChatModel(...)` 创建新实例

**影响：** 额外的对象创建开销，连接池无法复用

**优化方案：**
- 根据 provider+model 组合对 ChatModel 实例做 LRU 缓存
- 注意：ChatModel 本身需要是线程安全的（通常是无状态的，可以安全复用）

---

### 问题：知识库搜索每次都重建 VectorStore 实例

**现状（`knowledges/service.go:644`）：**
```go
// 每次搜索都新建 Milvus 连接和 Retriever
store, err := kbs.NewMilvusVectorStore(ctx, s.milvusClient, index, embedder)
```

**影响：** `NewMilvusVectorStore` 内部会调用 `ensureMilvusCollection`，每次都有一次 `HasCollection` 的 RPC 调用

**优化方案：**
- 对已知存在的 collection 做本地缓存（sync.Map），避免重复检查
- VectorStore 实例按 kbId 缓存，复用 indexer 和 retriever 对象

---

### 问题：Embedding 计算没有缓存

**现状：** 相同查询每次都调用 Embedding API 重新计算向量

**优化方案：**
```go
// 对查询文本做 SHA256，作为缓存 key
cacheKey := fmt.Sprintf("embedding:%s", sha256(query))
if cached, ok := redisCache.Get(cacheKey); ok {
    return cached, nil
}
vector = embeddingModel.Embed(query)
redisCache.Set(cacheKey, vector, 1*time.Hour)
```

---

## 4. 可扩展性问题

### 问题：订阅/计划系统是 Mock 数据

**现状（`subscriptions/handler.go`）：**
```go
func (h Handler) GetUserSubscription(c *gin.Context) {
    res.Success(c, &SubscriptionResponse{
        Plan: string(model.FreePlan),
        Configs: &model.PlanConfig{MaxAgents: 10, ...},
        // 全是硬编码！
    })
}
```

**影响：** 无法实现真实的付费计划限制（maxAgents/maxKnowledgeBaseSize 等限制均无效）

**优化方案：** 完整实现订阅表查询、Plan 配额检查中间件（在 Agent/Knowledge 创建时检查是否超出配额）

---

### 问题：没有统一的限流和熔断

**现状：** Agent 对话直接透传到 LLM API，没有限流保护

**问题：**
- 单个用户可以无限发起对话，耗尽 LLM API quota
- LLM API 出现故障时，会导致大量请求积压

**优化方案：**
```
用户请求 → 限流中间件（令牌桶/漏桶）
            → 熔断器（Sentinel/Hystrix）
            → LLM API 调用
```
- 按用户维度限流：每分钟最多 N 次对话请求
- 按模型维度限流：openai-gpt4 并发数限制
- 熔断器：LLM API 错误率超过阈值时快速失败

---

### 问题：文件上传未集成云存储

**现状（`knowledges/service.go:290-296`）：**
```go
// 创建临时文件处理，处理后删除
tempFile, _ := os.CreateTemp("", "upload-*.tmp")
defer os.Remove(tempFile.Name())
// StorageKey 只存了文件名，没有真正上传到云存储
doc.StorageKey = uploadFile.Filename  // TODO
```

**影响：** 文件没有持久化存储，重启后无法找回原始文件；多实例部署时文件在本机临时目录，无法共享

**优化方案：** 集成已有的 MinIO（docker-compose 中已部署）：上传时将文件存入 MinIO，`StorageKey` 存储 MinIO 对象路径

---

## 5. 可维护性问题

### 问题：工具注册 ApiKey 硬编码

**现状（`core/ai/tools/weather_tool.go` 推测）：**
```go
var ApiKey = "your_amap_api_key"  // 硬编码！
```

**优化方案：** 从配置文件或环境变量读取，走 `config.GetConfig()` 统一管理

---

### 问题：错误处理不统一

**现状：** 部分地方直接 `panic`（如 milvusClient 初始化失败）：
```go
milvusClient, err := client.NewClient(...)
if err != nil {
    panic(err)  // 启动时 panic，无法优雅降级
}
```

**优化方案：**
- 启动时的基础设施 panic 是合理的（快速失败原则）
- 但对于可选依赖（如 K8s client），应该允许启动失败并记录警告，而不是 panic

---

## 6. 安全性问题

### 问题：SMTP 密码明文存配置

**现状（`app/etc/config.yml`）：** SMTP 密码直接写在配置文件中

**优化方案：** 使用环境变量注入或 K8s Secret，配置文件中只写占位符

---

### 问题：LLM API Key 存数据库

**现状：** `llms` 表中的 `provider_config` jsonb 字段直接存储 API Key

**优化方案：**
- API Key 落库时加密（AES-256）
- 或者使用外部密钥管理服务（Vault/AWS KMS）
- 至少保证数据库字段标记为敏感，日志中不打印

---

## 面试中如何讲优化点

**推荐话术模板：**

> "这个项目在 [功能X] 上目前的实现是 [简短描述]，有一个潜在的问题是 [问题描述]，在 [场景] 下会出现 [具体影响]。如果我来优化，我会 [优化方案]，这样可以解决 [问题] 并带来 [收益]。"

**示例：**

> "文档向量化是异步 goroutine 处理的，目前的实现没有并发数量限制和超时控制。如果用户同时上传 1000 个文档，会启动 1000 个 goroutine，每个都在等待 Embedding API 响应，容易把系统搞垮。我会引入信号量（`golang.org/x/sync/semaphore`）限制并发数为 10，同时给每个 goroutine 设置 30 分钟的超时 context，防止 goroutine 泄漏。"
