# JAI 面试指南（可直接背诵版）

---

## 🧠 项目一句话介绍（30秒版本）

> "我参与开发了一个 **AI Agent 中台系统**，基于 Go 语言，集成了多 LLM 接入、RAG 知识库、可视化工作流编排、A2A 多智能体协作等核心功能，使用 PostgreSQL + Redis + Milvus 向量数据库，前端用 Vue3 + VueFlow 实现可拖拽的 Agent 工作流编辑器，完整支持 Docker Compose 本地部署和 K8s 生产部署。"

---

## 🧠 项目亮点总结（1分钟版本）

> "这个项目有几个我认为比较有意思的技术设计：
>
> 第一，**工作流 Tool 化**。我们把工作流（DAG）封装成了 AI 工具，这样 Agent 在对话过程中可以自主决定是否'调用'某个工作流。用户不需要手动触发工作流，LLM 会根据对话语义自动判断，实现了 Agent 能力和工作流能力的融合。
>
> 第二，**Parent-Child 两级分块 RAG**。知识库的向量检索采用了'小块检索、大块喂给 LLM'的策略，再结合 LLM 辅助意图解析（提取章节号等结构化元数据做精确过滤），RAG 的准确率比直接向量检索有明显提升。
>
> 第三，**多协议工具接入**。除了系统内置工具（天气/Git/K8s），还支持 MCP 协议的外部工具服务器，以及 A2A 协议的外部 Agent 服务，工具体系完全开放。
>
> 第四，**认证体系设计**完整：bcrypt 密码加密、双 token 机制、邮箱激活、Redis 临时状态管理，安全性有保证。"

---

## 🧠 核心功能讲解（3~5分钟版本）

### 讲解顺序建议：架构 → 认证 → Agent对话 → RAG → 工作流 → 优化点

---

**【架构层次】**

> "整个项目分为四个进程：主服务 app（8888）处理所有核心业务；mcp-server（7777）是 MCP 协议的工具服务器；a2a-server（8777）是 A2A 协议的智能体服务；前端 Vue3 应用（5173）。基础设施用 Docker Compose 编排：PostgreSQL 存业务数据，Redis 存临时状态，Milvus 做向量存储，ES 作为备选。项目用 Go Workspace 管理多个 Module：app、core（AI内核）、model（数据模型）、common（工具库）分包，职责清晰。"

---

**【认证模块】**

> "认证模块实现了完整的用户体系。注册流程：用户名/邮箱唯一性校验 → bcrypt 加密密码（DefaultCost=10，防彩虹表）→ crypto/rand 生成16字节随机激活 token → Redis 存 token:userId 映射（24小时过期）→ 事务中创建用户并发送激活邮件。
>
> 登录是 JWT 双 token 机制：access token（短期）和 refresh token（长期），无状态设计，Redis 里不存 token，减轻 Redis 压力。
>
> 忘记密码是三步设计：发验证码（Redis 存5分钟）→ 验证通过后生成重置 token（Redis 存15分钟）→ 用 token 重置密码，三个步骤用不同的 Redis key 命名空间隔离。"

---

**【Agent 对话 + SSE 实现】**

> "Agent 对话是系统最核心的功能。用户发起对话时，我们从数据库加载 Agent 配置，然后动态构建 ChatModel（根据 provider 字段选择 OpenAI 兼容接口、通义千问或 Ollama 本地模型）。
>
> 工具聚合是这里的亮点：把系统内置工具（天气/Git/K8s）、用户自定义工具、MCP 外部工具、知识库检索工具、工作流工具 五类工具统一聚合成一个 `[]tool.BaseTool` 列表，通过 eino 框架的 `adk.NewChatModelAgent` 构建 ReAct Agent。
>
> ReAct 模式：LLM 推理用户意图 → 决定调用哪个工具 → 执行工具 → 结果回填上下文 → 继续推理，直到可以给出最终答案。
>
> SSE 实现上有几个细节值得说：① 用 `rc.SetWriteDeadline(time.Time{})` 取消写超时，因为 AI 响应可能很慢；② 每 5 秒发一次 `: keep-alive\n\n` 心跳，防止防火墙/Nginx 因为空闲超时强制断连；③ 用 `context.WithCancel` 感知客户端断开，及时取消 LLM 调用避免资源浪费；④ datachan 和 errchan 两个 channel 分开传输数据和错误，Handler 层通过 select 统一处理。"

---

**【AI 面试系统】**

> "项目有一个特色功能：AI 多阶段面试系统。用户发送简历 → 系统识别为简历 → 进入面试流程，依次经过技术一面（编程基础/算法）→ 技术二面（项目经验/架构）→ 终面（综合素质）→ HR 面，每个阶段由独立的 LLM 驱动的 InterviewStageAgent 出 3 道题，60 分及格线，通过才进下一阶段。
>
> 技术难点在于多轮有状态交互：HTTP 是无状态的，但面试需要'出题→等用户回答→评分→再出下一题'。解决方案是利用 eino 的 `adk.Interrupt` 机制——Agent 出完题后调用 `gen.Send(adk.Interrupt(...))` 主动中断自身 goroutine，下次用户提交回答时，服务端将答案存入 `pendingAnswer` map（用 sync.RWMutex 保护），重新启动 Agent，Agent 检测到有待处理的答案就先评分，再出下一题。
>
> LLM 出题时会传入候选人简历内容和前序阶段评价，确保问题紧扣候选人经历，而不是泛泛而谈。"

---

**【RAG 知识库】**

> "知识库模块实现了完整的 RAG 流程，支持五种文件格式：md、docx、pdf、html、epub，每种格式有定制化的解析和分块策略。
>
> 核心是两级分块策略：文档被切成 Parent 大块（约1200字）存 PostgreSQL，再进一步切成 Child 小块（约400字，50字重叠）向量化存 Milvus。检索时用 Child 小块定位（向量语义精准），通过 parent_id 回查 Parent 大块（上下文完整），喂给 LLM 生成答案。
>
> 检索前还有一个 LLM 辅助意图解析：用 LLM 从用户问题中提取关键词、章节号、卷号等结构化信息，结合 Milvus 的 metadata 字段过滤精确命中（比如查'第500章'时直接过滤 chapter_num==500，不再依赖语义相似度）。
>
> Milvus 使用 HNSW 索引，COSINE 相似度，768 维向量，分批写入（每批50条）防止超时。"

---

**【工作流引擎】**

> "工作流引擎基于字节跳动开源的 eino 框架实现 DAG 执行。前端用 VueFlow 可视化拖拽节点（Start/TextDisplay/TextCombine/QwenVL/End），保存时序列化为 JSON 存 PostgreSQL。
>
> 后端执行时，WorkflowExecutor 从数据库加载 Graph JSON，遍历节点列表从注册表（注册表+工厂方法模式）取出对应节点实现，用 `compose.NewWorkflow` 构建 DAG，设置节点间的字段映射（sourceHandle→targetHandle），最后 `Compile` 验证图合法性并生成 runner，`runner.Invoke` 按拓扑顺序执行。
>
> 最有意思的是 WorkflowTool：将完整的工作流封装为一个实现了 eino Tool 接口的对象，Agent 可以在对话中自主调用，LLM 从工作流的描述和参数 schema 中知道何时该调用这个工作流。"

---

## 🧠 面试官可能深挖的问题 + 回答

### 关于系统设计

**Q: 为什么选 Go 而不是 Java 或 Python？**

> "Go 在这个项目里有几个优势：一是轻量并发，goroutine 模型非常适合处理 LLM 流式响应和异步文档处理；二是编译型语言，性能比 Python 好，AI 服务通常要处理大量文本；三是部署简单，单二进制文件，Docker 镜像体积小；四是 eino 框架本身是 Go 的，生态匹配。如果用 Python 当然也行，LangChain/LlamaIndex 生态更丰富，但 Go 在服务稳定性和性能上有优势。"

**Q: 为什么选 Milvus 而不是 pgvector 或 Pinecone？**

> "pgvector 的优势是 PostgreSQL 生态，但性能在百万级向量时会显著下降，我们预期知识库文档量较大。Milvus 是专为向量搜索设计的，HNSW 索引在查询延迟和召回率上更好，而且支持元数据过滤（我们的章节号过滤功能依赖这点）。项目也同时实现了 ES 的向量存储（代码里有切换注释），作为备选方案，灵活性好。Pinecone 是云服务，有外部依赖和成本问题，项目追求完全自托管。"

**Q: 工作流执行有没有考虑并行执行？**

> "eino 的 `compose.Workflow` 在编译阶段做拓扑排序，理论上对没有依赖关系的节点可以并行执行，这是 eino 框架层面的能力。当前项目的节点主要是线性的（简单的数据流），所以并行优化不明显。如果工作流复杂（如多个独立的 LLM 调用），eino 的并行能力就会发挥作用了。"

---

### 关于数据一致性

**Q: 文档删除时 PG 和 Milvus 如何保证一致性？**

> "坦白说，这是项目当前的一个不足。删除操作用了 PG 事务包裹，但 ES/Milvus 的删除不参与 PG 事务。如果 PG 成功但 Milvus 失败，会有孤儿向量数据。完善方案是用 Saga 模式：先软删除（PG 标记 deleted=true），通过消息队列异步触发向量数据库清理，所有步骤完成后再物理删除 PG 记录，任何步骤失败都有补偿操作。"

**Q: 用户会话历史怎么存储的？有没有考虑消息数量太多的问题？**

> "会话历史存在 `chat_sessions` 和 `chat_messages` 表中，每次对话会 SELECT 出历史消息传给 LLM。问题是随着对话增长，消息量越来越大，超过 LLM 的上下文窗口限制，而且数据库查询也越来越慢。优化方案：一是消息截断，只取最近 N 条消息；二是消息摘要，用 LLM 对历史对话做总结，用摘要替代原始消息，压缩 token 使用量；三是重要信息提取，把对话中的关键信息抽取存储，作为后续对话的记忆。"

---

### 关于性能

**Q: Agent 对话的延迟主要在哪里？如何优化？**

> "端到端延迟由几部分组成：① 工具列表构建（从 DB 加载 Agent 配置、MCP 工具拉取）：约 50~100ms；② LLM 首 token 延迟（TTFT）：取决于模型和网络，GPT-4 通常 500ms~2s；③ LLM 流式推送：对用户体验影响不大；④ 工具执行时间：取决于具体工具（知识库检索约 200ms）。
>
> 优化方向：Agent 配置缓存（减少 DB 查询）；MCP 工具列表缓存（避免每次重连拉取）；知识库 Embedding 缓存（相同查询复用向量）；选择响应快的 LLM（如 deepseek-v3 vs GPT-4）。"

**Q: 如果并发 1000 个对话请求，系统能撑住吗？**

> "瓶颈主要在三处：LLM API 的并发限制（openai 有 rate limit）、Milvus 查询 QPS、PostgreSQL 连接池。当前单实例的 Gin 服务器可以处理大量并发（每个对话用 goroutine 处理，开销很小）。LLM API 这边可以做请求队列 + 多 API Key 轮询。Milvus 可以配置多个 QueryNode 水平扩展。PostgreSQL 可以用 PgBouncer 做连接池代理。应用层有 K8s HPA 配置，可以自动扩容多实例。"

---

### 关于技术选型

**Q: eino 框架了解多少？和 LangChain 有什么区别？**

> "eino 是字节跳动开源的 Go AI 框架，核心是 compose 包实现的 DAG 编排引擎。和 LangChain 相比：LangChain 是 Python，生态更丰富（embedding、loader、retriever 组件非常多）；eino 是 Go，性能更好，类型系统更严格，编译时发现问题而非运行时。设计哲学上 eino 更轻量，核心是 interface + compose，扩展靠 eino-ext 仓库，而 LangChain 更倾向于大而全。在 Go 技术栈里，eino 是目前最成熟的选择。"

**Q: 为什么用 thunder 这个框架而不是直接用 Gin？**

> "thunder 是对 Gin 的封装，提供了开箱即用的配置加载（Viper）、日志（zerolog）、JWT 工具、Redis 缓存封装、PostgreSQL（GORM）、事件总线等常用组件。减少了大量重复的脚手架代码。trade-off 是有额外的依赖和一定的黑盒性，如果 thunder 有 bug 排查会困难些。但对于快速开发原型来说，这个 trade-off 是值得的。"

---

### 关于部署

**Q: 项目怎么部署到生产的？**

> "项目提供了完整的 K8s 部署配置。应用以 Deployment 部署，配置了三种探针：startupProbe（最长 150 秒启动时间，应对 AI 服务启动慢）、livenessProbe（30 秒检测一次死锁/OOM）、readinessProbe（控制是否加入 Service 负载均衡）。HPA 配置了 CPU > 70% 自动扩容，最多 10 个副本。配置通过 ConfigMap 注入，敏感信息后续应改用 Secret。数据库（PostgreSQL/Redis）通过 ExternalName Service 对接外部实例，而不是部署在集群内，更稳定。"

**Q: K8s 中 AI 服务有什么特殊挑战？**

> "AI 服务对普通 Web 服务的最大区别是：① 启动慢（加载模型/建立 ES+Milvus 连接），需要 startupProbe 而不能靠 initialDelaySeconds 硬等；② 请求处理时间长（LLM 调用可能 30 秒以上），HTTP 超时要单独处理（项目用 `SetWriteDeadline(time.Time{})` 取消写超时），K8s Ingress 也需要配置合适的超时时间；③ 流式响应（SSE），Nginx/Ingress 的 proxy_buffering 要关闭，否则 token 会被缓冲批量发送，用户看不到流式效果；④ GPU 资源调度（如果用本地模型），需要 K8s 的 GPU 资源管理插件。"

---

## 🧠 项目技术栈总结表（背诵用）

| 分层 | 技术选型 | 用途 |
|------|----------|------|
| 后端框架 | Gin (thunder封装) | HTTP 路由 + 中间件 |
| ORM | GORM | PostgreSQL 访问 |
| AI框架 | eino (字节开源) | ChatModel/Agent/工作流 DAG |
| 数据库 | PostgreSQL 18 | 业务数据持久化 |
| 缓存 | Redis 7.2 | 临时状态（验证码/token）|
| 向量库 | Milvus v2.6 | Embedding 向量存储+检索 |
| 全文检索 | Elasticsearch 8.16 | 向量检索备选方案 |
| 对象存储 | MinIO | 文件存储（Milvus依赖）|
| 前端框架 | Vue3 + Pinia | 状态管理 |
| 流程图 | VueFlow | 工作流可视化编辑 |
| 认证 | JWT 双 token | 无状态认证 |
| 密码加密 | bcrypt | 防彩虹表 |
| 协议 | MCP + A2A + SSE | 工具/智能体协作/流式输出 |
| 部署 | Docker Compose / K8s | 本地/生产环境 |
| K8s特性 | HPA + Ingress + PVC | 自动扩容+外部访问+持久化 |
| CI/CD | GitLab CI | 自动化构建 |

---

## 🧠 快速背诵卡片

### 项目一句话
> AI Agent 中台，Go + eino + PostgreSQL + Milvus，支持多LLM、RAG知识库、可视化工作流、A2A多智能体协作

### 三大技术亮点
1. **工作流 Tool 化** → Agent 自主调用工作流
2. **Parent-Child RAG + LLM意图解析** → 精准知识库检索
3. **AI面试 中断/恢复机制** → eino Interrupt 实现多轮有状态面试

### 四大技术亮点（背诵）
1. **工作流 Tool 化** → `WorkflowTool` 实现 eino tool 接口，Agent 自主调用 DAG
2. **Parent-Child RAG + LLM 意图解析** → 小块检索大块喂给 LLM，结构化过滤
3. **AI 面试中断/恢复** → `adk.Interrupt` + `sync.RWMutex` 状态机实现多轮有状态面试
4. **五类工具聚合** → 系统/MCP/知识库/工作流/自定义统一为 `[]tool.BaseTool`

### 四大设计模式（背诵）
1. **注册表+工厂方法** → 工作流节点类型扩展（`nodeRegistry`）
2. **策略模式** → 多 LLM provider 适配（ollama/qwen/openai switch）
3. **事件总线** → 模块间解耦（`thunder/event` 替代直接 import）
4. **状态机** → AI 面试多阶段流转（Stage 0→1→2→3→4，60分及格线）

### 四个可优化点（面试加分）
1. 注册发邮件 → 解耦到消息队列异步发送，提高可用性
2. 文档处理 goroutine → 加信号量限流 + 超时 context，防 goroutine 泄漏
3. 跨存储删除 → Saga 模式保证 PG/Milvus 最终一致性
4. 面试状态内存存储 → 迁移 Redis，支持多实例和进程重启恢复
