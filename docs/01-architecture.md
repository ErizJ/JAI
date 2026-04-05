# JAI 项目架构分析

## 项目类型

**准微服务架构 / AI 中台系统**

- 不是标准微服务（没有服务发现、网关层），但按业务边界拆分了多个独立进程
- 核心是一个 **AI Agent 平台**，支持多模型接入、RAG 知识库、工作流编排、A2A 智能体协作

---

## 进程拆分（服务边界）

```
┌─────────────────────────────────────────────────────────────┐
│                        Client (Vue3)                         │
│                     前端 :5173                               │
└────────────────────────┬────────────────────────────────────┘
                         │ HTTP / SSE
┌────────────────────────▼────────────────────────────────────┐
│               app (主服务)  :8888                            │
│  ┌─────────┐ ┌─────────┐ ┌──────────┐ ┌─────────────────┐  │
│  │ auths   │ │ agents  │ │knowledges│ │   workflows     │  │
│  │ llms    │ │ tools   │ │  a2a     │ │   nodes         │  │
│  └────┬────┘ └────┬────┘ └────┬─────┘ └────────┬────────┘  │
└───────┼───────────┼───────────┼─────────────────┼───────────┘
        │           │           │                 │
        ▼           ▼           ▼                 ▼
   PostgreSQL    Redis    Milvus+ES         Eino Framework
   (用户/Agent/  (JWT黑   (向量检索)        (工作流引擎)
    工作流元数据) 名单/
                验证码)

┌──────────────────────────────┐   ┌──────────────────────────┐
│   mcp-server  :7777          │   │  a2a-server  :8777        │
│  (MCP协议工具服务器)           │   │  (A2A智能体服务)           │
│  hertz框架 + SSE             │   │  hertz框架 + Ollama本地模型│
└──────────────────────────────┘   └──────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│                    基础设施 (Docker)                          │
│  PostgreSQL:15432  Redis:6379  ES:9200  Milvus:19530        │
│  MinIO:9000/9001   Kibana:5601  etcd(for milvus)            │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│                  K8s 部署层（k8s/ 目录）                      │
│  Deployment + HPA + Ingress + ConfigMap + PVC               │
└─────────────────────────────────────────────────────────────┘
```

---

## 核心模块划分（app 服务内部）

```
app/
├── main.go                   # 启动入口
├── internal/
│   ├── inits/inits.go        # 初始化总协调（DB/Redis/JWT/工具/路由）
│   ├── router/               # 路由注册层
│   │   ├── event.go          # 事件总线注册（模块间解耦）
│   │   ├── agents.go         # Agent 路由
│   │   ├── auths.go          # 认证路由
│   │   ├── knowledges.go     # 知识库路由
│   │   ├── llms.go           # 模型管理路由
│   │   ├── tools.go          # 工具路由
│   │   └── workflows.go      # 工作流路由
│   ├── auths/                # 认证模块（注册/登录/JWT/邮箱验证）
│   ├── agents/               # Agent 核心（对话/工具调用/多智能体）
│   ├── knowledges/           # 知识库（文档解析/分块/向量化/RAG检索）
│   ├── llms/                 # 模型管理（OpenAI/Qwen/Ollama适配）
│   ├── tools/                # 工具管理（系统工具+MCP工具）
│   ├── workflows/            # 工作流 CRUD
│   ├── nodes/                # 工作流节点管理
│   ├── a2a/                  # A2A 协议（Agent to Agent）
│   └── subscriptions/        # 订阅计划（付费功能骨架）
├── shared/                   # 跨模块共享 DTO（LLM参数/知识库参数）
└── etc/config.yml            # 配置文件

core/                         # 核心 AI 能力库（独立 Go Module）
├── ai/
│   ├── workflow_execute.go   # 工作流执行引擎（基于 eino）
│   ├── workflow_tool.go      # 工作流作为工具暴露给 Agent
│   ├── message.go            # 消息格式处理
│   ├── template.go           # Prompt 模板
│   ├── kbs/                  # 知识库向量存储实现
│   │   ├── vector.go         # VectorStore 接口定义
│   │   ├── milvus_vector.go  # Milvus 实现（HNSW索引，COSINE相似度）
│   │   ├── es_vector.go      # ES 实现
│   │   └── parser.go         # 多格式文档解析器工厂
│   ├── tools/                # 系统内置工具
│   │   ├── registry.go       # 工具注册表（全局单例）
│   │   ├── weather_tool.go   # 高德天气工具
│   │   ├── git_tool.go       # Git 查询工具
│   │   ├── git_commit.go     # Git 提交工具
│   │   └── ops.go            # K8s 运维工具
│   ├── nodes/                # 工作流节点实现
│   │   ├── nodes.go          # 节点接口 + 节点类型枚举
│   │   ├── textDisplay.go    # 文本展示节点
│   │   ├── textCombine.go    # 文本合并节点
│   │   ├── htmlDisplay.go    # HTML展示节点
│   │   └── qwenVL.go         # 千问视觉语言模型节点
│   ├── mcps/mcp.go           # MCP 协议客户端封装
│   ├── store/store.go        # 会话 CheckPoint 存储
│   └── interview/            # AI 面试功能模块

model/                        # 数据模型层（独立 Go Module）
├── agents.go                 # Agent + ChatSession + ChatMessage
├── workflows.go              # Workflow + Node + Edge + Graph
├── knowledges.go             # KnowledgeBase + Document + DocumentChunk
├── llms.go                   # LLM + ProviderConfig
├── tools.go                  # Tool
├── users.go                  # User
├── subscriptions.go          # Plan + Subscription
└── market.go                 # AgentMarket

common/                       # 通用工具库
├── biz/code.go               # 业务错误码统一定义
└── utils/                    # token计数、md解析、epub解析等
```

---

## 请求调用链路

### 1. 普通 REST 请求（以登录为例）

```
前端 POST /api/v1/auth/login
    │
    ▼
Gin Router (thunder框架封装)
    │
    ▼
auths.Handler.Login()           # handler层：参数绑定、鉴权
    │ 调用
    ▼
auths.service.login()           # service层：业务逻辑
    ├── repo.findByUsernameOrEmail()  → PostgreSQL
    ├── bcrypt.CompareHashAndPassword()
    └── jwt.GenToken()
    │
    ▼
返回 LoginResp{Token, RefreshToken, UserInfo}
```

### 2. Agent 对话请求（SSE 流式）

```
前端 POST /api/v1/agents/chat
    │
    ▼
agents.Handler.AgentMessage()        # handler层（agents/handler.go:89）
    ├── rc.SetWriteDeadline(time.Time{})  # 取消超时限制！AI响应慢
    ├── 设置 SSE 响应头
    │   Content-Type: text/event-stream
    │   Cache-Control: no-cache
    │   Connection: keep-alive
    ├── context.WithCancel(c.Request.Context())  # 可取消 context
    ├── 启动心跳 Ticker（5秒），防止防火墙断连
    │
    ▼ 同时开两个 channel
    ├── datachan  ← service.agentMessage(ctx, ...)
    └── errchan
    │
    ▼ select 循环
    ├── <-ctx.Done()      → 客户端断连，退出
    ├── <-heartbeat.C     → 写 ": keep-alive\n\n" + Flush
    ├── data <-datachan   → 写 "data: {json}\n\n" + Flush
    └── err  <-errchan    → 写 "data: [ERROR]{msg}\n\n"，退出
    │
    ▼ datachan 关闭时
    写 "data: [DONE]\n\n" + Flush，退出
```

**SSE 消息格式：**
```
data: {"type":"token","content":"你好"}\n\n   ← 正常 token
: keep-alive\n\n                               ← 心跳（5秒一次）
data: [DONE]\n\n                               ← 流式结束
data: [ERROR]错误信息\n\n                      ← 错误
```

### 3. 知识库文档上传（异步处理）

```
前端 POST /api/v1/knowledges/:kbId/documents (multipart)
    │
    ▼
knowledges.service.uploadDocuments()
    ├── 解析文件格式（md/docx/pdf/html/epub）
    ├── 调用对应 eino parser 解析文档
    ├── 创建 Document 记录（status=pending）→ PostgreSQL
    └── go func() {                         # 异步处理！
            updateDocumentStatus(processing)
            processDocumentAndVectorAndStore()
            ├── 按文件类型分块（Parent-Child 两级）
            │   Parent → PostgreSQL (document_chunks)
            │   Child  → Milvus (向量+HNSW索引)
            └── updateDocumentStatus(completed/failed)
        }()
    ▼
立即返回 Document 对象（status=pending）
```

---

## API 路由速查表

| 模块 | 方法 | 路径 | 说明 |
|------|------|------|------|
| **认证** | POST | `/api/v1/auth/register` | 注册（发激活邮件）|
| | POST | `/api/v1/auth/login` | 登录（返回双 token）|
| | GET | `/api/v1/auth/verify-email?token=` | 邮箱激活链接 |
| | POST | `/api/v1/auth/refresh` | 刷新 token |
| | POST | `/api/v1/auth/forgot-password` | 发验证码 |
| | POST | `/api/v1/auth/verify-code` | 验证码换重置 token |
| | POST | `/api/v1/auth/reset-password` | 重置密码 |
| **Agent** | POST | `/api/v1/agents/create` | 创建 Agent |
| | POST | `/api/v1/agents/list` | 列表（支持分页/搜索）|
| | GET | `/api/v1/agents/:id` | 详情（预加载 Tools/KB/Workflow）|
| | PUT | `/api/v1/agents/update` | 更新配置 |
| | DELETE | `/api/v1/agents/:id` | 删除 |
| | POST | `/api/v1/agents/chat` | **对话（SSE流式）** |
| | POST | `/api/v1/agents/:id/tools/batch` | 批量更新工具 |
| | POST | `/api/v1/agents/:id/knowledge-bases` | 关联知识库 |
| | POST | `/api/v1/agents/:id/workflows` | 关联工作流 |
| | POST | `/api/v1/agents/sessions` | 创建会话 |
| | GET | `/api/v1/agents/sessions` | 会话列表 |
| | GET | `/api/v1/agents/sessions/:sessionId/messages` | 消息历史 |
| **知识库** | POST | `/api/v1/knowledges` | 创建知识库 |
| | POST | `/api/v1/knowledges/:kbId/documents` | 上传文档（multipart）|
| | GET | `/api/v1/knowledges/:kbId/search` | 检索（RAG）|
| **工作流** | POST | `/api/v1/workflows` | 创建工作流 |
| | POST | `/api/v1/workflows/:id/execute` | 执行工作流 |
| **LLM** | GET | `/api/v1/llms` | 模型列表 |
| **工具** | GET | `/api/v1/tools` | 工具列表 |
| **健康** | GET | `/health` | K8s 存活/就绪探针 |

---

## 中间件及作用总结

| 中间件 | 用途 | 具体体现 |
|--------|------|----------|
| **PostgreSQL** | 主数据库 | 用户、Agent、工作流、知识库元数据、对话历史 |
| **Redis** | 缓存/临时状态 | 邮箱验证 token(24h)、重置密码验证码(5min)、重置密码 token(15min) |
| **Milvus** | 向量数据库 | 知识库文档的 Embedding 向量存储，HNSW 索引，COSINE 相似度检索 |
| **Elasticsearch** | 全文检索（备选） | 与 Milvus 互为备选的向量存储后端，代码中已同时实现 |
| **MinIO** | 对象存储 | Milvus 的底层存储依赖（当前文档未上传到 MinIO，为 TODO） |
| **etcd** | 分布式协调 | Milvus 元数据存储依赖 |

---

## Go Module 工作区（go.work）

```
workspace:
├── app          # 主业务服务
├── core         # AI 能力内核
├── model        # 数据模型
├── common       # 公共工具
├── a2a-server   # A2A 智能体服务
├── mcp-server   # MCP 工具服务器
└── benchmark    # 性能测试
```

> 关键设计：`model` 和 `common` 作为独立 Module 被多个服务共享，避免了重复定义数据结构。

---

## 架构层次图（精简版）

```
┌───────────────────────────────────────────────────────┐
│  Presentation Layer  │  Vue3 + Pinia + VueFlow         │
├───────────────────────────────────────────────────────┤
│  API Gateway Layer   │  Gin (thunder封装) + JWT认证     │
├───────────────────────────────────────────────────────┤
│  Business Layer      │  Handler → Service → Repository │
├───────────────────────────────────────────────────────┤
│  AI Engine Layer     │  Eino Framework (核心AI能力)     │
│                      │  ├── ChatModel (多模型适配)       │
│                      │  ├── Agent (ReAct模式)            │
│                      │  ├── RAG (Retriever+Embedder)     │
│                      │  └── Workflow (DAG执行引擎)       │
├───────────────────────────────────────────────────────┤
│  Data Layer          │  PostgreSQL + Redis              │
│  Vector Layer        │  Milvus + ElasticSearch          │
│  Storage Layer       │  MinIO                           │
└───────────────────────────────────────────────────────┘
```
