# AI 核心概念详解（新手向）

> 本文档面向 AI 学习新手，结合项目中的真实代码，从零开始解释每一个关键概念。
> 读完本文再去看 `02-core-features.md`，你会对项目有更深的理解。

---

## 目录

1. [LLM 是什么 + Token + Context Window](#1-llm-是什么--token--context-window)
2. [Embedding 是什么 + 向量空间直觉](#2-embedding-是什么--向量空间直觉)
3. [RAG 是什么 + 为什么需要它](#3-rag-是什么--为什么需要它)
4. [Tool Calling 是什么 + 完整通信流程](#4-tool-calling-是什么--完整通信流程)
5. [ReAct Agent 原理 + 代码对应](#5-react-agent-原理--代码对应)
6. [HNSW 向量索引原理](#6-hnsw-向量索引原理)
7. [eino 框架的 DAG 编排是什么](#7-eino-框架的-dag-编排是什么)
8. [adk.Interrupt 中断机制原理](#8-adkinterrupt-中断机制原理)
9. [Prompt Engineering + System Prompt 是什么](#9-prompt-engineering--system-prompt-是什么)
10. [SSE 流式响应原理 + 项目代码详解](#10-sse-流式响应原理--项目代码详解)
11. [Parent-Child 两级分块：数据如何存储与关联](#11-parent-child-两级分块数据如何存储与关联)

---

## 1. LLM 是什么 + Token + Context Window

### LLM 是什么

LLM（Large Language Model，大语言模型）本质上是一个**预测下一个词的概率模型**。

它的训练过程是：拿来几乎整个互联网的文字，学习"在这段文字之后，最可能出现的下一个词是什么"。训练完成后，这个模型就能根据你给它的输入（prompt），一个词一个词地预测出合理的续写内容——这就是"生成"。

所以当你问 GPT-4 "上海今天天气怎么样"，它不是真的查了天气，而是根据训练数据的模式，生成了一段听起来合理的回复。这也是为什么 LLM 会"幻觉"——它只是在预测"接下来应该说什么"。

### Token 是什么

LLM 处理的不是"字"或"词"，而是 **Token**。

Token 是 LLM 的最小处理单元，大致上：
- 英文：1 个单词 ≈ 1.3 个 token（`hello` = 1 token，`tokenization` = 3 tokens）
- 中文：1 个汉字 ≈ 1~2 个 token（`你好` ≈ 2 tokens）

**为什么项目里要计算 Token 数？**

看 `common/utils/token.go`：

```go
// 文档分块时，要知道每块有多少 token
func GetTokenCount(text string) int {
    tkmOnce.Do(func() {
        // cl100k_base 是 GPT-4 使用的分词方案
        tke, _ := tiktoken.GetEncoding("cl100k_base")
        tkm = tke
    })
    if tkm == nil {
        return len([]rune(text)) // 兜底：直接用字符数估算
    }
    tokens := tkm.Encode(text, nil, nil)
    return len(tokens) // 返回 token 数量
}
```

这段代码用 tiktoken（OpenAI 官方分词器）精确计算文本有多少个 token，然后存在数据库 `document_chunks.token_count` 字段里。

### Context Window 是什么

每次调用 LLM，你能"喂给它"的文字总量是有限的，这个上限叫 **Context Window（上下文窗口）**。

```
┌──────────────────────────────────────────┐
│           Context Window（如 128K token）  │
│                                          │
│  系统提示词        工具列表       对话历史    │
│  (2000 tokens) + (1000 tokens) + ... + 当前问题
│                                          │
└──────────────────────────────────────────┘
                              ↑
                         超出这个限制就会报错
```

这就是为什么文档分块时要控制每块的 token 数——如果把整本书原文塞给 LLM，会超出 context window 限制。

---

## 2. Embedding 是什么 + 向量空间直觉

### 文字怎么变成数字

Embedding（向量化/嵌入）是把文字转换成一组数字（向量）的过程。

项目中文档被向量化后，每段文字变成一个 768 维的浮点数数组：

```
"上海今天下雨"  →  [0.12, -0.34, 0.89, 0.05, ..., -0.67]  // 768 个数字
                                                      ↑
                              这就是 milvus_vector.go 里的 const dim = 768
```

**为什么是 768 维？**

这是由 Embedding 模型决定的。不同模型输出不同维度：
- `text-embedding-ada-002`（OpenAI）→ 1536 维
- `nomic-embed-text`（本地 Ollama）→ 768 维
- `text-embedding-3-small`（OpenAI）→ 1536 维

项目代码 `core/ai/kbs/milvus_vector.go` 第 18 行写死了 `const dim = 768`，因此知识库必须配套使用输出 768 维的 Embedding 模型，否则维度不匹配会报错。

### 向量空间的直觉

向量化之后，**语义相似的文字，对应的向量在空间中距离近**。

```
向量空间（简化为 2D 示意）：

        ^ 天气相关
        |
  "北京下雨" •
  "上海晴天" •  •"今天天气不错"
        |
--------+-------------------------> 技术相关
        |
        |  • "神经网络训练"
        |  • "反向传播算法"
        |     • "梯度下降"
```

"上海晴天"和"今天天气不错"在向量空间里很近，因为它们语义相关。这就是**语义检索**——不是关键词匹配，而是"意思相近就能找到"。

### 项目中 Embedding 在哪里发生

在 `milvus_vector.go` 的 `NewMilvusVectorStore` 函数中，创建 indexer 时传入了 `embedder`：

```go
indexer, err := milvus.NewIndexer(ctx, &milvus.IndexerConfig{
    Embedding: embedder,  // ← 这个 embedder 负责把文字转成向量
    DocumentConverter: func(ctx context.Context, docs []*schema.Document, vectors [][]float64) ([]interface{}, error) {
        rows := make([]interface{}, len(docs))
        for i, doc := range docs {
            vec32 := make([]float32, len(vectors[i]))
            for j, v := range vectors[i] {
                vec32[j] = float32(v)      // float64 → float32，节省存储空间
            }
            rows[i] = map[string]interface{}{
                "content": doc.Content,
                "vector":  vec32,          // ← 存入 Milvus 的就是这个向量
                ...
            }
        }
        return rows, nil
    },
})
```

eino 框架在调用 `indexer.Store(docs)` 时，内部会：
1. 取每个 doc 的 `Content` 文本
2. 调用 `embedder` 将文本转成 `[]float64`（768 个数字）
3. 把文本 + 向量一起存入 Milvus

---

## 3. RAG 是什么 + 为什么需要它

### 问题：LLM 不知道你的私有知识

LLM 的训练数据有截止日期（如 2024 年），而且完全不包含你的私有文档（公司内部资料、你上传的小说等）。

```
用户问："凡人修仙传第500章讲了什么？"
LLM 直接回答：不知道 or 胡编乱造（幻觉）
```

### RAG 的解决思路

RAG（Retrieval-Augmented Generation，检索增强生成）的核心思路是：

**回答问题之前，先从文档库里找到相关内容，塞进 prompt 里，再让 LLM 根据这些内容回答。**

```
                  ┌─────────────────────────────────────────┐
                  │              RAG 流程                    │
                  │                                          │
  用户提问         │  1. 把问题向量化                          │
  "第500章讲了什么" │        ↓                                │
                  │  2. 在 Milvus 里搜索相似向量              │
                  │        ↓                                │
                  │  3. 找到最相关的文档片段                   │
                  │        ↓                                │
                  │  4. 把文档片段 + 原始问题一起给 LLM        │
                  │        ↓                                │
                  │  5. LLM 基于真实文档内容回答               │
                  └─────────────────────────────────────────┘
```

### 项目 RAG 的实现流程

**第一步：文档入库（`knowledges/service.go` 第 323 行）**

```go
go func() {                        // ← 异步处理，不阻塞 HTTP 响应
    ctx = context.Background()     // ← 独立 context，不随请求取消
    s.repo.updateDocumentStatus(ctx, doc.ID, model.DocumentStatusProcessing)

    // 核心处理：分块 + 向量化 + 存储
    err = s.processDocumentAndVectorAndStore(ctx, doc, docs, kb)
    if err != nil {
        s.repo.updateDocumentStatus(ctx, doc.ID, model.DocumentStatusFailed)
        return
    }
    s.repo.updateDocumentStatus(ctx, doc.ID, model.DocumentStatusCompleted)
}()
return doc, nil  // ← 立即返回，前端轮询状态
```

**第二步：分块策略（同文件第 354 行）**

```go
const (
    maxChildSize     = 500  // child 块最大 500 字
    childOverlapSize = 150  // 相邻 child 块有 150 字重叠（防止语义在边界断裂）
)
```

以 Markdown 文档为例（第 424 行），按标题层级分块：

```
原始 Markdown 文档
    │
    ├── H1（文档标题）：不存，只作为面包屑前缀
    ├── H2（大章节）：存为 Parent 块 → document_chunks 表（PostgreSQL）
    │     └── H3（小节）→ 切成 Child 块（400字，50字重叠）→ Milvus
    └── ...
```

代码中构建面包屑路径（第 414 行）：
```go
pathPrefix := fmt.Sprintf("【文档:%s】【片段:%d】\n", doc.Name, i+1)
// 每个 child 块的文本都带上来源标记，例如：
// 【文档:凡人修仙传.epub】【卷:第四卷】【章:第500章】
// （章节内容正文）...
```

**为什么要加面包屑？** LLM 收到这段文字时，能知道"这是哪本书的哪一章"，回答时会更准确，不会混淆不同书的内容。

**第三步：LLM 辅助意图解析（第 1186 行）**

在向量检索之前，先用 LLM 从用户问题中提取结构化信息：

```go
func (s *service) parseQueryIntent(ctx, kb, query string) (*QueryIntent, error) {
    prompt := `你是一个结构化数据提取助手。请从用户的提问中提取查询关键词、卷号和章节号。
示例：
问题："凡人修仙传第四卷风起海外第五百章讲了什么？"
输出：{"keywords": "讲了什么", "volume_num": 4, "chapter_num": 500}`

    message, _ := chatModel.Generate(ctx, [...])

    // 解析 LLM 返回的 JSON
    var intent QueryIntent
    json.Unmarshal([]byte(rawJSON), &intent)

    // 兜底：如果 LLM 解析失败，直接用原始问题作为关键词
    if intent.Keywords == "" {
        intent.Keywords = query
    }
    return &intent, nil
}
```

拿到意图后，向量检索时加上精确过滤条件（`milvus_vector.go` 第 210 行）：

```go
func (s *MilvusVectorStore) Search(ctx, query string, topK int, filters SearchFilter) ([]*schema.Document, error) {
    // 把过滤条件转成 Milvus 表达式
    var expr string
    if len(filters) > 0 {
        expr = s.buildMilvusFilter(filters)
        // 例如：metadata['chapter_num'] == 500
    }
    // 向量检索时同时做精确过滤
    options := []retriever.Option{
        retriever.WithTopK(topK),                  // 取最相似的 Top-K 个
    }
    if expr != "" {
        options = append(options, reMilvus.WithFilter(expr)) // 限定章节号
    }
    return s.retriever.Retrieve(ctx, query, options...)
}
```

**意图解析的价值：** 假设用户问"第500章讲了什么"，纯向量检索只能靠语义相似度，可能返回第499章或第501章的内容。加上 `chapter_num==500` 的精确过滤后，Milvus 只会在第500章的 child 块中做向量排序，精度大幅提升。

---

## 4. Tool Calling 是什么 + 完整通信流程

### 最重要的认知纠正

**LLM 不能"执行"代码。**

LLM 只是一个文字预测模型，它没有能力直接调用 HTTP 接口、查数据库。当我们说 "LLM 调用了天气工具"，实际发生的是：

1. LLM 输出了一段**特殊格式的 JSON 文本**，表示"我想要调用某个工具，参数是xxx"
2. **后端代码**读到这段 JSON，真正去执行查询天气的代码
3. 执行结果被转换成文字，**塞回到对话上下文**里
4. LLM 再次读到这段内容，继续生成回复

这个过程叫 **Function Calling / Tool Calling**。

### 完整通信流程图

```
用户问："上海今天天气怎么样？"
        │
        ▼
【第1轮 LLM 调用】
后端把用户问题 + 工具定义列表 一起发给 LLM
发送内容：
  ┌──────────────────────────────────┐
  │ 用户消息："上海今天天气怎么样？"      │
  │                                  │
  │ 可用工具：                         │
  │   - get_weather(city, extensions)│
  │     描述：查询指定城市的天气信息      │
  └──────────────────────────────────┘
        │
        ▼
LLM 返回（不是普通文字，而是 tool_call JSON）：
  {
    "tool_calls": [{
      "name": "get_weather",
      "arguments": {"city": "上海", "extensions": "base"}
    }]
  }
        │
        ▼
【后端执行工具】（weather_tool.go 的 InvokableRun）
真正发送 HTTP 请求到高德天气 API：
  GET https://restapi.amap.com/v3/weather/weatherInfo?city=上海&key=xxx
        │
        ▼
工具返回结果（JSON 字符串）：
  {"lives":[{"city":"上海","weather":"晴","temperature":"28"}]}
        │
        ▼
【第2轮 LLM 调用】
后端把工具结果加入对话历史，再次调用 LLM：
  ┌──────────────────────────────────────────────┐
  │ 用户消息："上海今天天气怎么样？"                  │
  │ 工具调用：get_weather(上海)                    │
  │ 工具结果：{"weather":"晴","temperature":"28"} │
  └──────────────────────────────────────────────┘
        │
        ▼
LLM 最终回答（普通文字）：
"上海今天天气晴，气温28°C，适合出行。"
```

### 天气工具的完整代码对应

`core/ai/tools/weather_tool.go`：

```go
// Step 1: Info() 告诉 LLM "这个工具叫什么，能干什么，需要什么参数"
func (w *WeatherTool) Info(ctx context.Context) (*schema.ToolInfo, error) {
    return &schema.ToolInfo{
        Name: "get_weather",
        Desc: "查询指定城市的天气信息，使用高德天气API",
        // 参数定义：LLM 看到这个，才知道调用时要传什么
        ParamsOneOf: schema.NewParamsOneOfByParams(map[string]*schema.ParameterInfo{
            "city": {
                Desc:     "需要查询天气的城市名称或区域编码",
                Type:     schema.String,
                Required: true,                // city 是必填参数
            },
            "extensions": {
                Desc: "气象类型：base(实况天气)/all(预报天气)",
                Type: schema.String,
                Enum: []string{"base", "all"}, // LLM 只能传这两个值之一
            },
        }),
    }, nil
}

// Step 2: InvokableRun() 是真正执行的代码，LLM 决定调用时，这里被触发
// argumentsInJSON 是 LLM 生成的 JSON 参数，如 {"city":"上海","extensions":"base"}
func (w *WeatherTool) InvokableRun(ctx context.Context, argumentsInJSON string, opts ...tool.Option) (string, error) {
    // 解析 LLM 生成的 JSON 参数
    var params map[string]any
    json.Unmarshal([]byte(argumentsInJSON), &params)

    city := params["city"].(string)  // 取出 LLM 传来的城市名

    // 真正的 HTTP 请求
    queryParams := url.Values{}
    queryParams.Set("key", w.apiKey)
    queryParams.Set("city", city)
    // ...

    resp, _ := http.Get(fullUrl)  // 调用高德天气 API
    body, _ := io.ReadAll(resp.Body)
    return string(body), nil       // 返回给 LLM 看的内容
}
```

### 工作流也是一种工具

`core/ai/workflow_tool.go` 中的 `WorkflowTool` 遵循完全相同的模式：

```go
// Info() 把工作流的名称、描述、输入参数暴露给 LLM
func (w *WorkflowTool) Info(ctx context.Context) (*schema.ToolInfo, error) {
    return &schema.ToolInfo{
        Name: "execute_workflow_" + w.workflow.Name,
        // LLM 通过这段描述，知道什么时候应该调用这个工作流
        Desc: fmt.Sprintf("执行名为:%s的工作流，工作流描述为:%s。工作流配置%s",
            w.workflow.Name,
            w.workflow.Description,  // ← 这段描述写得好不好，直接决定 LLM 会不会正确调用
            string(configJSON)),
        ParamsOneOf: schema.NewParamsOneOfByParams(inputParams),
    }, nil
}

// InvokableRun() 当 LLM 决定调用时，真正执行 DAG 工作流
func (w *WorkflowTool) InvokableRun(ctx context.Context, argumentsInJSON string, ...) (string, error) {
    var inputParams map[string]any
    json.Unmarshal([]byte(argumentsInJSON), &inputParams)

    params := w.ConvertParams(inputParams)  // 格式转换

    executor := NewWorkflowExecutor()
    executor.initRegistry()
    result, _ := executor.Execute(w.workflow.Data)  // 执行整个 DAG

    resultJson, _ := json.Marshal(result)
    return string(resultJson), nil  // 结果返回给 LLM
}
```

**这就是"工作流 Tool 化"的核心**：工作流和天气查询一样，都实现了相同的接口（`Info` + `InvokableRun`），LLM 无法区分它调用的是一个 HTTP 请求还是一个复杂的 DAG 执行引擎。

---

## 5. ReAct Agent 原理 + 代码对应

### ReAct = Reasoning + Acting 的循环

ReAct 不是一次性的请求-响应，而是一个**思考→行动→观察**的循环。

```
┌────────────────────────────────────────────────────┐
│                  ReAct 循环                          │
│                                                    │
│  用户提问                                           │
│     │                                              │
│     ▼                                              │
│  [Reasoning] LLM 分析：需要查天气，调用 get_weather   │
│     │                                              │
│     ▼                                              │
│  [Acting] 后端执行天气工具，返回 JSON 结果            │
│     │                                              │
│     ▼                                              │
│  [Reasoning] LLM 分析：有了天气数据，可以回答了        │
│     │                                              │
│     ▼                                              │
│  [Output] 输出最终答案                               │
│                                                    │
│  （如果LLM认为还需要调用更多工具，循环继续）           │
└────────────────────────────────────────────────────┘
```

### eino 框架如何实现这个循环

在 eino 内部，ReAct Agent 对应的 DAG 结构如下：

```
              START
                │
                ▼
          ┌── LLM Node ──┐
          │               │
  有 tool_call?     无 tool_call
          │               │
          ▼               ▼
      Tool Node         END
          │
          │（把工具结果加回 messages）
          └──────────────┘（循环回 LLM Node）
```

"有没有 tool_call" 是**条件边**：LLM 的输出如果包含 `tool_calls` 字段，就走向 Tool Node 执行；如果没有（说明 LLM 认为可以直接回答了），就走向 END。

eino 框架（`adk.NewChatModelAgent`）把这整个逻辑封装好了，项目代码只需要：

```go
// agents/service.go 中 buildAgent 函数
agentInstance, _ := adk.NewChatModelAgent(ctx, &adk.ChatModelAgentConfig{
    Name:        agent.Name,
    Instruction: agent.SystemPrompt,   // 系统提示词（Agent 的角色设定）
    Model:       chatModel,             // 底层 LLM（OpenAI/Qwen/Ollama）
    ToolsConfig: adk.ToolsConfig{
        ToolsNodeConfig: compose.ToolsNodeConfig{
            Tools: allTools,           // 所有可用工具（天气/知识库/工作流/...）
        },
    },
})

// 流式执行（SSE 推送给前端）
stream, _ := agentInstance.Stream(ctx, msgs)
```

eino 会自动处理 LLM→Tool→LLM→Tool→... 的循环，直到 LLM 决定不再调用工具为止。

### 工具描述对调用准确率的影响

LLM 根据 `Info().Desc` 决定要不要调用工具。所以描述写得清不清楚，直接决定 Agent 能不能正确工作：

```go
// ❌ 差的描述：
Desc: "执行工作流"  // LLM 不知道这个工作流是干嘛的

// ✅ 好的描述（workflow_tool.go 中实际使用）：
Desc: fmt.Sprintf("执行名为:%s的工作流，工作流描述为:%s。工作流配置%s",
    w.workflow.Name,          // 工作流名称
    w.workflow.Description,   // ← 这里写的描述越详细，LLM 调用越精准
    string(configJSON))
```

---

## 6. HNSW 向量索引原理

### 问题：768 维空间里找"最近邻"

当 Milvus 存了 100 万条 768 维向量，用户查询时需要找"和查询向量最相似的 Top-K 个"。

**暴力搜索**：把查询向量和 100 万条向量逐一计算余弦相似度，取最大的 K 个。
- 准确率：100%（精确）
- 速度：太慢（每次查询需要 100 万次向量运算）

**HNSW（Hierarchical Navigable Small World）** 是一种**近似**最近邻算法，用少量准确率换取大量速度。

### HNSW 的核心思想：分层导航

想象你在一个城市找餐厅：
- 先看地图（大范围、稀疏）：找到大概的区域
- 再看街道图（中等范围）：缩小到附近街区
- 最后步行查看（精细、密集）：找到最近的餐厅

HNSW 的多层结构就是这个思路：

```
第 2 层（最稀疏，只有少量节点，长程跳跃）：
  A ─────────────────────────────── B
                                    │
第 1 层（中等密度）：                  │
  A ─── C ─── D ─── E ─────────── B
                      │
第 0 层（最密集，所有节点都在这里）：
  A ─ C ─ F ─ G ─ D ─ H ─ E ─ I ─ B
                            │
                         查询向量落在这里
```

查询过程：
1. 从第 2 层的入口点出发，用大步跳跃快速找到大概位置
2. 逐层下降，每层用更细粒度的邻居关系精化结果
3. 在第 0 层（所有节点）中做最终的精确比较

### 三个参数的含义

在 `milvus_vector.go` 第 316 行：

```go
// 创建 HNSW 索引：COSINE 相似度，M=16，efConstruction=200
hnswIndex, _ := entity.NewIndexHNSW(entity.COSINE, 16, 200)
```

| 参数 | 值 | 含义 | 增大效果 |
|------|-----|------|---------|
| `M` | 16 | 每个节点最多有多少条边（图的连通度） | 召回率更高，但内存占用更大 |
| `efConstruction` | 200 | 建图时的搜索深度（构建质量） | 索引质量更好，但建图更慢 |

```go
// 查询时的参数（第 107 行）
param, _ := entity.NewIndexHNSWSearchParam(64)  // ef=64
```

| 参数 | 值 | 含义 | 增大效果 |
|------|-----|------|---------|
| `ef`（查询时） | 64 | 查询时的搜索候选集大小 | 召回率更高，但查询更慢 |

**实际效果**：M=16、efConstruction=200 是 HNSW 的推荐默认值，在 768 维向量下，比暴力搜索快约 100 倍，召回率（recall@10）约 95%——即"真正最相关的 10 个"中，HNSW 能找到其中约 9.5 个。

### 为什么选 COSINE（余弦相似度）而不是 L2 距离

```
余弦相似度 = 两个向量夹角的余弦值
         = 向量的方向是否相似（与长度无关）

L2 距离（欧氏距离）= 向量在空间中的直线距离
                = 与方向和长度都有关
```

对于文本语义来说，我们关心的是"方向"（语义是否相关），而不是"长度"（文本的绝对大小）。所以用余弦相似度更合适。

代码中统一用 `entity.COSINE`：
```go
hnswIndex, _ := entity.NewIndexHNSW(entity.COSINE, 16, 200)
// ...
MetricType: entity.COSINE,  // retriever 检索时也用 COSINE
```

---

## 7. eino 框架的 DAG 编排是什么

### DAG 是什么

DAG = Directed Acyclic Graph（有向无环图）。

"有向"：每条边有方向（A → B 表示 A 的输出流向 B 的输入）
"无环"：不能形成循环（A → B → C → A 是非法的）

工作流就是一个 DAG：

```
[Start] → [TextDisplay节点] → [QwenVL节点] → [End]
              ↓
          (这里的箭头方向就是"有向")
```

### eino 如何执行 DAG

`core/ai/workflow_execute.go` 中的 `Execute` 函数：

```go
func (w *WorkflowExecutor) Execute(data *model.Graph) (map[string]any, error) {
    // Step 1: 创建 eino Workflow 对象
    wf := compose.NewWorkflow[map[string]any, map[string]any]()

    // Step 2: 遍历所有节点，从注册表中取出对应实现，添加到图中
    for _, node := range data.Nodes {
        if node.Type == "start" || node.Type == "end" { continue }

        // nodeRegistry 是个 map：节点类型字符串 → 工厂函数
        nodeFactory := w.nodeRegistry[nodes.NodeType(node.Type)]
        // AddLambdaNode 把任意函数包装成 DAG 节点
        ref := wf.AddLambdaNode(node.ID,
            compose.InvokableLambda(nodeFactory(node.Data).Invoke))
        nodeRefs[node.ID] = ref
    }

    // Step 3: 遍历所有边，告诉 eino 数据怎么流转
    for _, edge := range data.Edges {
        if edge.Source == startNode.ID {
            nodeRefs[edge.Target].AddInput(compose.START)     // 起始节点接收 START 输入
        } else if edge.Target == endNode.ID {
            wf.End().AddInput(edge.Source,
                compose.MapFields(edge.SourceHandle, edge.TargetHandle))
        } else {
            // SourceHandle = 上游节点的输出字段名
            // TargetHandle = 下游节点的输入字段名
            nodeRefs[key.Target].AddInputWithOptions(key.Source, mappings)
        }
    }

    // Step 4: Compile = 图的合法性验证 + 拓扑排序
    runner, _ := wf.Compile(ctx)
    // 这一步 eino 会：
    // - 检测是否有环（有环报错）
    // - 检测是否有孤立节点（没有连接到任何边）
    // - 计算执行顺序（拓扑排序）
    // - 识别可以并行的节点（无依赖关系的节点）

    // Step 5: Invoke = 按拓扑顺序执行各节点
    result, _ := runner.Invoke(ctx, params)
    return results, nil
}
```

### SourceHandle 和 TargetHandle 是什么

VueFlow 前端每个节点有多个"端口"（handle），每个端口代表一个字段：

```
┌──────────────────┐         ┌──────────────────┐
│   TextDisplay    │         │   QwenVL 节点      │
│                  │         │                  │
│  output_text ●──────────── ●  image_url       │
│  file_path  ●──────────── ●  prompt           │
└──────────────────┘         └──────────────────┘
      ↑                               ↑
  SourceHandle              TargetHandle
  (上游输出字段)              (下游输入字段)
```

`edge.SourceHandle` = 上游节点哪个输出端口
`edge.TargetHandle` = 下游节点哪个输入端口

`compose.MapFields(edge.SourceHandle, edge.TargetHandle)` 告诉 eino："把上游的 `output_text` 字段，映射到下游的 `image_url` 字段"。

这实现了精细的数据流控制，而不是粗暴地把整个 map 传给下游。

---

## 8. adk.Interrupt 中断机制原理

### 问题：HTTP 无状态 vs 面试需要有状态

HTTP 协议是无状态的：每个请求独立，请求结束后服务端什么都不记得。

但 AI 面试需要：
```
请求1：LLM 出题 → 发给用户
（等待用户思考作答... 可能等几分钟）
请求2：用户提交答案 → LLM 评分 → 出下一题
```

这两个请求之间有状态依赖，普通的请求-响应无法处理。

### adk.Interrupt 的解决思路

eino 的 `adk.Interrupt` 让 Agent 可以主动"暂停自己"：

```go
// core/ai/interview/interview.go 中的 Run 函数
func (a *InterviewStageAgent) Run(...) *adk.AsyncIterator[*adk.AgentEvent] {
    iter, gen := adk.NewAsyncIteratorPair[*adk.AgentEvent]()
    // gen 是生产者，iter 是消费者

    go func() {
        defer gen.Close()

        // ① 检查是否在等待用户回答
        if state.AwaitingAnswer && state.Round > 0 {
            if answer, ok := a.provider.GetAndClearAnswer(sessionKey); ok && answer != "" {
                // 用户已经回答了，取出来评分
                eval := a.evaluateWithLLM(ctx, state.History[lastIdx])
                state.AwaitingAnswer = false
            } else {
                // 用户还没回答，发出"中断"信号
                gen.Send(adk.Interrupt(ctx, map[string]any{
                    "question": state.LastQuestion,
                    "awaiting": true,
                }))
                return  // ← goroutine 退出！这次请求结束了
            }
        }

        // ② 轮次没到上限，出下一题
        question := a.generateQuestion(state)  // LLM 生成题目
        state.AwaitingAnswer = true             // 标记"正在等待回答"
        state.LastQuestion = question

        // 发出"中断"信号，告诉前端："这是你的题目，等你的答案"
        gen.Send(adk.Interrupt(ctx, map[string]any{
            "question": question,
            "awaiting": true,
        }))
        // goroutine 执行完毕退出，这次 HTTP 请求结束
    }()
    return iter
}
```

### 状态如何跨请求保存

面试状态（已出哪些题、当前分数、阶段等）保存在 `agents/service.go` 的 map 中：

```go
type service struct {
    stateMutex      sync.RWMutex                   // 保护 map 的读写锁
    interviewStates map[string]*interview.StageState // sessionId → 面试状态
    pendingAnswer   map[string]string               // sessionId → 用户的答案
    waitingStates   map[string]bool                 // sessionId → 是否在等待回答
}
```

**完整的请求序列**：

```
HTTP 请求 1（用户发送简历）
    │
    ▼
服务端识别为简历 → 创建 StageState → 存入 interviewStates[sessionId]
Agent 出第1题 → gen.Send(Interrupt{question: "第1题..."})
goroutine 退出 → HTTP 响应返回给用户（题目通过 SSE 推送）

...用户思考中...

HTTP 请求 2（用户提交答案）
    │
    ▼
服务端把答案存入 pendingAnswer[sessionId]
重新运行 InterviewStageAgent.Run()
Agent 启动 → 检测到 AwaitingAnswer==true
  → GetAndClearAnswer(sessionId) 取到答案
  → 调用 LLM 评分
  → 出第2题
  → gen.Send(Interrupt{question: "第2题..."})
  → HTTP 响应返回
```

**关键**：`StageState` 存在内存里（当前实现），所以进程重启会丢失。优化方案是存 Redis（`StateProvider` 接口已预留扩展点）。

### sync.RWMutex 为什么用读写锁而不是互斥锁

```go
// 多个用户同时进行面试，isWaitingForAnswer 会被频繁并发读取
func (s *service) isWaitingForAnswer(sessionId string) bool {
    s.stateMutex.RLock()    // 读锁：多个 goroutine 可以同时持有读锁
    defer s.stateMutex.RUnlock()
    return s.waitingStates[sessionId]
}

// 只有少数情况需要写入
func (s *service) setWaitingState(sessionId string, val bool) {
    s.stateMutex.Lock()     // 写锁：独占，同时只能有一个写操作
    defer s.stateMutex.Unlock()
    s.waitingStates[sessionId] = val
}
```

读多写少的场景下：
- `sync.Mutex`（互斥锁）：读和读之间也互斥，性能浪费
- `sync.RWMutex`（读写锁）：读和读可以并发，只有写才需要独占

面试场景中，"查询某个用户是否在等待回答" 的读操作远多于 "更新等待状态" 的写操作，所以读写锁性能更好。

---

## 9. Prompt Engineering + System Prompt 是什么

### 最基本的认知

你和 LLM 的每一次对话，实际上是发给它一段结构化文本。这段文本里有三种角色的消息：

```
┌─────────────────────────────────────────────────────────┐
│                发给 LLM 的完整输入                        │
│                                                         │
│  【system】  你是一个AI智能助手，你的任务是...（角色设定）   │
│  【user】    上海今天天气怎么样？（用户的问题）             │
│  【assistant】我来查一下天气...（历史回复，对话历史）        │
│  【tool】    {"weather": "晴", "temp": "28"}（工具结果）   │
│  【user】    再帮我查一下明天的（当前最新问题）             │
└─────────────────────────────────────────────────────────┘
```

- `system` 消息：**系统提示词**，在对话最开始发送，设定 LLM 的"角色"和"行为规则"，用户看不到
- `user` 消息：用户说的话
- `assistant` 消息：LLM 之前回复的内容（历史对话）
- `tool` 消息：工具调用的返回结果

### System Prompt 在项目中的体现

`core/ai/template.go` 中定义了两套系统提示词：

**基础 Agent 的 System Prompt：**
```go
const BaseSystemPrompt = `
# 角色与目标
你是一个AI智能助手。你的任务是理解用户的需求，通过一系列的"思考"和"行动"来解决问题。
{role}          ← 占位符，运行时替换成该 Agent 的具体角色描述

# 知识库
-------如果以下知识库有内容，优先匹配知识库数据进行回答----------
{ragContext}    ← 占位符，运行时替换成 RAG 检索到的相关文档片段
-----------------

# 能力清单
你必须调用提供的skill列表，选择合适的进行调用，严禁编造任何事实。
{toolsInfo}     ← 占位符，运行时替换成工具列表（由 eino 框架自动填充）
-----------------
{agentsInfo}    ← 可调用的下游 Agent 列表
`
```

**DevOps 专用 System Prompt（更细化的角色设定）：**
```go
const DevOpsSystemPrompt = `
# 角色定义
你是AI运维助手OpsMaster，一个专业的Kubernetes集群运维专家。
...
# 工作原则
1. 安全第一：所有操作必须确保集群安全，避免误操作
2. 先诊断后操作：执行破坏性操作前，必须先收集信息
...
`
```

**运行时如何注入（`agents/service.go` 第 306 行）：**
```go
// 根据 agent 类型选择不同的 system prompt 模板
systemPrompt := ai.BaseSystemPrompt
if agent.Type == "devops" {
    systemPrompt = ai.DevOpsSystemPrompt
}

// 构建 ReAct Agent 时传入 system prompt
agentInstance, _ := adk.NewChatModelAgent(ctx, &adk.ChatModelAgentConfig{
    Name:        agent.Name,
    Instruction: systemPrompt,   // ← system prompt 通过这里传入
    Model:       chatModel,
    ToolsConfig: ...,
})
```

eino 框架收到 `Instruction` 后，会自动将其作为 `system` 角色的消息放在对话历史的第一条，然后再附上工具列表。

### Prompt Engineering 是什么

**Prompt Engineering（提示词工程）** 就是"如何写 System Prompt 和用户 Prompt，才能让 LLM 输出你想要的结果"。

几个关键技巧（在项目代码中都能找到对应）：

**1. 清晰的角色定义**
```
❌ "你是助手"
✅ "你是AI运维助手OpsMaster，专业的Kubernetes集群运维专家"
```
LLM 的行为会随着角色设定的具体程度而变化，越具体的角色描述越能让 LLM 专注于特定领域。

**2. 明确的行为约束**
```go
// interview.go 面试官的 prompt 片段
prompt := `你是技术面试官（第%d轮，第%d题/共%d题）。
【重要规则】
1. 必须结合简历，从简历中挑选具体经历切入    ← 约束：不能凭空出题
2. 参考前几轮评价决定难易程度               ← 约束：要有连贯性
3. 禁止凭空捏造问题                        ← 反幻觉约束`
```

**3. 结构化输出要求**
```go
// evaluateWithLLM 中要求 LLM 输出 JSON 格式
prompt := `评价回答（0-100分）：
...
JSON格式：{"total_score":85,"dimensions":{...},"feedback":"评价"}`
// 要求 JSON 格式，后端就能直接 json.Unmarshal，不用解析自然语言
```

**4. Few-shot 示例（给 LLM 看例子）**
```go
// parseQueryIntent 中给出了示例
prompt := `你是一个结构化数据提取助手。
示例：
问题："凡人修仙传第四卷第五百章讲了什么？"
输出：{"keywords": "讲了什么", "volume_num": 4, "chapter_num": 500}
// ← 这个"示例"就是 Few-shot，教会 LLM 输出格式`
```

### 为什么 System Prompt 写得好很重要

项目中工具描述的 `Desc` 字段，本质上也是 Prompt 的一部分——它会被格式化后放入 System Prompt，LLM 靠它决定要不要调用这个工具：

```go
// 工作流工具描述（workflow_tool.go）
Desc: fmt.Sprintf("执行名为:%s的工作流，工作流描述为:%s。工作流配置%s",
    w.workflow.Name,
    w.workflow.Description,   // ← 用户填写的工作流描述
    string(configJSON))
```

用户在前端给工作流填写的"描述"，最终会出现在 LLM 的上下文里。描述写"处理订单"，LLM 收到"帮我下单"时就会调用；描述写"工作流1号"，LLM 可能根本不知道什么时候该调用它。

---

## 10. SSE 流式响应原理 + 项目代码详解

### 为什么需要流式响应

LLM 生成内容是"一个 token 一个 token 往外蹦"的，不是一次性算完再返回。

```
用户发问 → LLM 开始生成 → 生成中... → 生成完毕

普通 HTTP（等全部生成完再返回）：
用户发问 ─────────────────────────────────────→ 收到完整回答（等待 10~30 秒）
                                              ↑
                                        用户一直看到空白页面

SSE 流式响应（每生成一个 token 就立即推送）：
用户发问 → "上" → "海" → "今" → "天" → "天" → "气" → "晴" → [DONE]
              ↑                                               ↑
          用户立即看到第一个字                              响应完成
```

SSE（Server-Sent Events）让服务端可以持续向客户端"推"数据，不需要客户端轮询。

### SSE 协议格式

SSE 是纯文本协议，每条消息的格式是：
```
data: 这是消息内容\n\n
```

- `data:` 前缀表示这是一条数据消息
- `\n\n`（两个换行）表示这条消息结束
- 以 `:` 开头的行是注释（心跳用这个）：`: keep-alive\n\n`
- 客户端收到 `data: [DONE]\n\n` 时知道流结束了

### 项目 SSE 实现代码详解

`app/internal/agents/handler.go` 第 95-173 行：

```go
func (h *handler) chatMessage(c *gin.Context) {
    // ① 取消 HTTP 写超时
    // 默认全局超时是 10 秒，但 AI 响应可能要 30 秒甚至更久
    // time.Time{} 表示"零值"，即永不超时
    rc := http.NewResponseController(c.Writer)
    rc.SetWriteDeadline(time.Time{})  // ← 取消写超时，否则 AI 生成到一半连接就断了

    // ② 设置 SSE 响应头，告诉浏览器"这是一个流式响应，不要缓冲"
    c.Header("Content-Type", "text/event-stream")  // ← SSE 的 MIME 类型
    c.Header("Cache-Control", "no-cache")           // ← 不要缓存，每次都是实时数据
    c.Header("Connection", "keep-alive")            // ← 保持 TCP 连接不断开

    // ③ 创建可取消的 context
    // 当客户端关闭浏览器/切换页面时，c.Request.Context() 会自动取消
    // 我们用它来检测断连，及时停止 LLM 推理，节省算力
    ctx, cancel := context.WithCancel(c.Request.Context())
    defer cancel()

    // ④ 启动 LLM 推理（在 goroutine 里异步执行）
    // 返回两个 channel：
    //   datachan：LLM 每生成一段文字，往这里发
    //   errchan：如果发生错误，往这里发
    datachan, errchan := h.service.agentMessage(ctx, userID, messageReq)

    // ⑤ 心跳定时器（每 5 秒）
    // 某些防火墙/Nginx/CDN 会把"超过 X 秒没有数据"的连接强制断开
    // 定期发送心跳注释行，让连接保持活跃
    heartbeat := time.NewTicker(time.Second * 5)
    defer heartbeat.Stop()

    // ⑥ 事件循环：同时监听 4 个事件源
    for {
        select {
        case <-ctx.Done():
            // 客户端断开了（关闭浏览器、网络断开）
            // context 被取消，LLM 的推理也会随之取消（因为共享同一个 ctx）
            return

        case <-heartbeat.C:
            // 5 秒到了，发送心跳
            c.Writer.Write([]byte(": keep-alive\n\n"))
            c.Writer.Flush()  // ← 必须 Flush，否则数据还在缓冲区里，没有真正发出去

        case data, ok := <-datachan:
            if !ok {
                // channel 被关闭，说明 LLM 生成完毕
                c.Writer.Write([]byte("data: [DONE]\n\n"))  // ← SSE 结束标记
                c.Writer.Flush()
                return
            }
            // 把这一片 token 按 SSE 格式发出去
            // data 是 JSON 格式的字符串，如 {"content":"上海"}
            c.Writer.Write([]byte("data: " + data + "\n\n"))
            c.Writer.Flush()  // ← 每次都要 Flush，确保立即发送给客户端

        case err, ok := <-errchan:
            if !ok {
                errchan = nil  // errchan 关闭后置 nil，select 不再选这个 case
                continue
            }
            if err != nil {
                c.Writer.Write([]byte("data: [ERROR]" + err.Error() + "\n\n"))
                c.Writer.Flush()
                return
            }
        }
    }
}
```

### 为什么用两个 Channel（datachan + errchan）而不是一个

```
方案一：一个 channel（混在一起）
chan Result  →  每次发的是 {data, error}，收到后判断是否有 error

方案二：两个 channel（项目实际用法）
chan string  →  datachan，只发数据
chan error   →  errchan，只发错误

优势：
1. 类型更清晰，datachan 里永远是有效数据，不需要 nil 判断
2. select 语句分支更直观，每个 case 职责单一
3. LLM 推理协程可以在错误发生后立即发 errchan，不影响已经在 datachan 里的数据
```

### 前端如何接收 SSE

```javascript
// Vue3 前端用 EventSource API（浏览器原生支持）
const eventSource = new EventSource('/api/agent/chat')

eventSource.onmessage = (event) => {
    if (event.data === '[DONE]') {
        eventSource.close()  // 收到结束标记，关闭连接
        return
    }
    if (event.data.startsWith('[ERROR]')) {
        console.error(event.data)
        eventSource.close()
        return
    }
    // 解析 JSON，把 token 追加到页面上
    const chunk = JSON.parse(event.data)
    displayText += chunk.content  // 实时显示
}
```

---

## 11. Parent-Child 两级分块：数据如何存储与关联

### 一张图看清楚数据关系

```
上传一个文件："凡人修仙传.epub"
                │
                ▼
        documents 表（一行）
        ┌──────────────────────────────────────┐
        │ id: "doc-001"                        │
        │ name: "凡人修仙传.epub"               │
        │ status: "completed"                  │
        │ knowledge_base_id: "kb-123"          │
        └──────────────────────────────────────┘
                │
                │ 按章节分块
                ▼
        document_chunks 表（PostgreSQL，存 Parent 大块）
        ┌──────────────────────────────────────────────┐
        │ id: "chunk-A"  ← 第499章（Parent块）         │
        │ doc_id: "doc-001"                            │
        │ content: "第499章：韩立此时站在..."（完整章节） │
        │ token_count: 1200                            │
        │ meta_info: {"chapter_num": 499, "volume": 4} │
        └──────────────────────────────────────────────┘
        ┌──────────────────────────────────────────────┐
        │ id: "chunk-B"  ← 第500章（Parent块）         │
        │ doc_id: "doc-001"                            │
        │ content: "第500章：韩立踏入..."（完整章节）   │
        │ token_count: 1350                            │
        │ meta_info: {"chapter_num": 500, "volume": 4} │
        └──────────────────────────────────────────────┘
                │
                │ 每个 Parent 块再切成若干 Child 块
                ▼
        Milvus Collection "kb_kb123"（存 Child 小块 + 向量）
        ┌───────────────────────────────────────────────────────┐
        │ id: "child-001"                                       │
        │ parent_id: "chunk-B"  ← 指向 PostgreSQL 里的父块      │
        │ doc_id: "doc-001"                                     │
        │ content: "【文档:凡人修仙传】【章:第500章】\n韩立踏入..."│
        │           （前150字，带面包屑前缀）                     │
        │ vector: [0.12, -0.34, ..., 0.67]  （768维浮点数）      │
        │ metadata: {"chapter_num": 500, "volume_num": 4}       │
        └───────────────────────────────────────────────────────┘
        ┌───────────────────────────────────────────────────────┐
        │ id: "child-002"                                       │
        │ parent_id: "chunk-B"  ← 同一个父块的第二段            │
        │ content: "...（第100-300字，与child-001有50字重叠）..."  │
        │ vector: [0.09, -0.28, ..., 0.71]                      │
        │ metadata: {"chapter_num": 500, "volume_num": 4}       │
        └───────────────────────────────────────────────────────┘
        ┌───────────────────────────────────────────────────────┐
        │ id: "child-003"                                       │
        │ parent_id: "chunk-B"  ← 同一个父块的第三段            │
        │ ...                                                   │
        └───────────────────────────────────────────────────────┘
```

### 检索时的数据流向（代码对应）

用户问："凡人修仙传第500章主角做了什么？"

**第一步：LLM 提取意图**（`service.go` 第 1186 行）
```go
intent := parseQueryIntent(query)
// 结果: {keywords: "主角做了什么", chapter_num: 500, volume_num: 4}
```

**第二步：Milvus 向量检索 Child 块**（`milvus_vector.go` 第 210 行）
```go
// 把 "主角做了什么" 向量化，在 Milvus 中搜索
// 同时加过滤条件：只看 chapter_num == 500 的块
childDocs, _ = store.Search(ctx, "主角做了什么", 10,
    SearchFilter{"chapter_num": 500})
// 返回: [child-001, child-002, child-003]（第500章的小块）
```

**第三步：通过 parent_id 反查 PostgreSQL 获取 Parent 大块**（`service.go` 第 663 行）
```go
// 从 child 块里拿出 parent_id
orderedParentIds := []string{}
for _, cd := range childDocs {
    pId := cd.MetaData["parent_id"].(string)  // 取出 "chunk-B"
    orderedParentIds = append(orderedParentIds, pId)
}

// 去 PostgreSQL 查完整的父块内容
parentChunks, _ := s.repo.getDocumentChunksByIds(ctx, orderedParentIds)
// 返回: chunk-B 的完整内容（1350 token 的完整章节文字）
```

**第四步：把 Parent 大块喂给 LLM**
```
最终传给 LLM 的 prompt（示意）：

【参考资料】
【来源：凡人修仙传.epub - 第500章】
韩立踏入那片迷雾，耳边传来阵阵怪异的声响...
（完整章节内容，约1350个token）
【参考资料结束】

【用户问题】
凡人修仙传第500章主角做了什么？
```

### 重叠区域（overlap）的作用

Child 块之间有 50 字的重叠，防止关键内容被切断：

```
第500章原文（示意）：
...韩立大喝一声，[祭出了三十六枚火龙]，将周围的魔兽悉数焚毁...

如果恰好在 "祭出" 前后切开（无重叠）：
  Child-001: "...韩立大喝一声，祭出了"   ← 语义不完整！
  Child-002: "三十六枚火龙，将周围的..."   ← 向量检索时找不到这个完整事件

加了 50 字重叠后：
  Child-001: "...韩立大喝一声，祭出了三十六枚火龙，将周围的魔兽..."（前250字）
  Child-002: "...祭出了三十六枚火龙，将周围的魔兽悉数焚毁..."（从第200字开始）
                ↑
           这50字在两个 child 里都有，保证关键内容不会因为切块位置而丢失
```

这就是代码里的：
```go
const (
    maxChildSize     = 500  // child 块最大 500 字
    childOverlapSize = 150  // 相邻块重叠 150 字
)
```

---

## 总结：知识点关联图

```
                    LLM
                  （预测下一个Token）
                      │
           ┌──────────┼──────────────┬──────────────┐
           │          │              │              │
         Token    Tool Calling    Context Window  System Prompt
         计数      （工具调用）      （输入长度限制）  （角色设定/行为约束）
           │          │                              │
     ┌─────┘       ┌──┘                          Prompt
     │             │                             Engineering
  文档分块       ReAct Agent                    （Few-shot/结构化输出）
  控制大小      （循环Reasoning+Acting）
     │             │
     ▼             ▼
  Embedding     工具注册表
  （文字→向量）   （Info+InvokableRun）
     │             │
     ▼             ▼
  向量空间      WeatherTool  WorkflowTool  KnowledgeBaseTool
  （语义距离）
     │                                          │
     ▼                                          ▼
  Milvus HNSW                           Parent-Child 分块
  （快速近似最近邻）                      （Milvus存小块+overlap）
     │                                          │
     ▼                                          ▼
  RAG 检索                               PostgreSQL 存大块
  （意图解析+精确过滤）                    （parent_id 关联）
                                               │
                                               ▼
                                          SSE 流式推送
                                          （逐Token返回前端）
```

每个概念都有其存在的理由，缺一不可。理解了这张图，整个项目的技术逻辑就通了。
