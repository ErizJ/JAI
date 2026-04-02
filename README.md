视频观看地址：
https://h01bmlq5jz.feishu.cn/wiki/XRdIwBZWAiaCLrkcSa4ciuIknNe?from=from_copylink
笔记等地址：
https://h01bmlq5jz.feishu.cn/wiki/GceTwRmAii5MLtkp86GcrTZRnYg?from=from_copylink

---

## 启动指南

### 一、启动基础设施（Docker）

修改 `docker/.env` 中的 `ROOT` 为本地实际路径：

```env
ROOT=/your/local/path/JAI/docker
```

```bash
cd docker
docker compose up -d
```

| 服务           | 端口          |
|---------------|---------------|
| PostgreSQL    | 15432         |
| Redis         | 6379          |
| Elasticsearch | 9200          |
| Milvus        | 19530         |
| Minio         | 9000 / 9001   |
| Kibana        | 5601          |

---

### 二、启动后端

**主服务 app**（端口 8888）

```bash
cd app
go run main.go
```

**MCP Server**（端口 7777）

```bash
cd mcp-server
go run main.go
```

**A2A Server**（端口 8777，需本地运行 Ollama）

```bash
cd a2a-server
go run main.go
```

---

### 三、启动前端

```bash
cd frontend
npm install
npm run dev
```

前端地址：`http://localhost:5173`，API 请求自动代理到 `http://localhost:8888`

---

### 启动顺序

```
Docker 基础设施 → app (8888) → mcp-server (7777) + a2a-server (8777) → frontend (5173)
```
