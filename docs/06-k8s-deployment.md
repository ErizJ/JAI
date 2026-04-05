# JAI K8s 部署分析（面试专项）

> 项目在 `k8s/` 目录下提供了完整的 Kubernetes 部署配置，覆盖了生产部署的主要关注点，是面试时展示 DevOps 能力的加分项。

---

## 整体 K8s 资源清单

| 文件 | 资源类型 | 作用 |
|------|----------|------|
| `app-deployments.yml` | Deployment | 应用 Pod 定义（副本数、镜像、探针、资源限制）|
| `app-service.yml` | Service | Pod 内部访问入口（ClusterIP）|
| `app-ingress.yml` | Ingress | 外部 HTTP 入口（域名路由）|
| `app-hpa.yml` | HPA | 水平自动扩缩容（CPU 指标驱动）|
| `app-configmap.yml` | ConfigMap | 应用配置文件（config.yml 注入）|
| `database-service.yml` | Service | 数据库 ExternalName（映射外部 DB）|
| `pvc.yml` | PVC | 持久化存储卷声明 |
| `rabc.yml` | RBAC | K8s API 权限（运维工具需要）|

---

## Deployment 关键配置解析

### 三探针配置（`app-deployments.yml`）

```yaml
# 启动探针：允许 150 秒启动时间（AI服务加载模型慢）
startupProbe:
  httpGet: { path: /health, port: 8888 }
  initialDelaySeconds: 10
  periodSeconds: 5
  failureThreshold: 30   # 30次 × 5秒 = 150秒

# 存活探针：检测是否死锁/OOM，失败则重启
livenessProbe:
  httpGet: { path: /health, port: 8888 }
  initialDelaySeconds: 60
  periodSeconds: 30
  failureThreshold: 3    # 连续3次失败重启

# 就绪探针：检测是否可以接收流量，失败则从 Service 摘除
readinessProbe:
  httpGet: { path: /health, port: 8888 }
  initialDelaySeconds: 30
  periodSeconds: 10
  failureThreshold: 3
```

**面试话术：**
> "项目配置了 K8s 的三种探针。启动探针（startupProbe）给应用最长 150 秒启动时间，避免还没完全初始化就被存活探针误判为故障；存活探针（livenessProbe）每 30 秒检查一次 /health，连续 3 次失败会触发 Pod 重启，应对内存泄漏或死锁；就绪探针（readinessProbe）控制 Service 是否将流量路由到该 Pod，滚动升级时新版本就绪前老版本继续服务，实现零停机发布。"

### 资源限制

```yaml
resources:
  requests:
    memory: "256Mi"
    cpu: "250m"     # 0.25 核
  limits:
    memory: "512Mi"
    cpu: "500m"     # 0.5 核
```

**面试话术：**
> "requests 是调度保证（K8s 调度时需要保证节点有足够资源），limits 是硬上限（超出 CPU 会被 throttle，超出内存会被 OOM Kill）。AI 服务的内存需求可能在知识库检索时突增（大文档向量化），limits 设为 requests 的 2 倍给了一定的弹性空间。"

### Pod 反亲和性

```yaml
affinity:
  podAntiAffinity:
    preferredDuringSchedulingIgnoredDuringExecution:
      - podAffinityTerm:
          topologyKey: kubernetes.io/hostname
```

**面试话术：**
> "Pod 反亲和性配置让 2 个副本尽量调度到不同节点（preferredDuring 是软约束，最大努力），防止单节点故障导致服务完全不可用。用 `Preferred` 而不是 `Required` 是因为测试环境可能只有单节点，强约束会导致第二个副本无法调度。"

---

## HPA 自动扩缩容（`app-hpa.yml`）

```yaml
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
spec:
  minReplicas: 2
  maxReplicas: 10
  metrics:
    - type: Resource
      resource:
        name: cpu
        target:
          type: Utilization
          averageUtilization: 70    # CPU 使用率 > 70% 触发扩容
```

**扩缩容逻辑：**
- 当前 CPU 使用率 / 目标 CPU 使用率 = 期望副本数 / 当前副本数
- 例：2 个副本 CPU 90%，目标 70%，期望 = 2 × 90/70 ≈ 3 → 扩容到 3

**面试话术：**
> "HPA 基于 CPU 指标自动扩缩容，min=2 保证基础可用性，max=10 防止过度扩容导致成本失控。对于 AI 对话服务，CPU 指标有一定局限性：当瓶颈在 LLM API 的网络 I/O 时，CPU 可能不高但响应已经变慢。更精确的做法是用自定义指标（如请求队列深度或 P99 延迟）来驱动 HPA，需要配置 Prometheus + KEDA。"

---

## RBAC 权限配置（`rabc.yml`）

```yaml
# ServiceAccount：ai-ops
# ClusterRole 权限：
rules:
  - apiGroups: [""]
    resources: ["pods", "pods/log", "services", "endpoints"]
    verbs: ["get", "list", "watch"]
  - apiGroups: ["apps"]
    resources: ["deployments", "replicasets"]
    verbs: ["get", "list", "watch", "update", "patch"]
```

**为什么需要 RBAC？**

项目内置了 K8s 运维工具（`core/ai/tools/ops.go`），Agent 在对话时可以用自然语言查询 Pod 状态、拉取日志、重启 Deployment 等。这些操作需要通过 K8s API，因此 Pod 需要挂载具有相应权限的 ServiceAccount。

```yaml
# Deployment 中挂载 ServiceAccount
spec:
  serviceAccountName: ai-ops
```

**面试话术：**
> "RBAC 配置是为了支持 AI 运维工具功能。应用 Pod 挂载了 `ai-ops` ServiceAccount，该 SA 绑定了 ClusterRole，拥有读取 Pod/Log/Service 等资源的权限，以及 patch Deployment 的权限（用于扩缩容和重启）。权限设计遵循最小权限原则，只开放了 get/list/watch/patch，没有 delete 权限，防止 AI 误操作删除生产资源。"

---

## ConfigMap 配置注入

```yaml
# 将 config.yml 作为 ConfigMap 注入 Pod
volumes:
  - name: app-config-volume
    configMap:
      name: app-config

volumeMounts:
  - name: app-config-volume
    mountPath: /app/etc/config.yml  # 挂载到固定路径
    subPath: config.yml
```

**面试话术：**
> "应用配置通过 ConfigMap 而不是镜像内嵌的方式提供，好处是同一个镜像可以部署到不同环境（dev/staging/prod），只需切换 ConfigMap。但当前配置文件里可能包含 API Key 等敏感信息，更安全的做法是把敏感值抽取到 K8s Secret，ConfigMap 只存非敏感配置，Secret 通过 env 环境变量或 Volume 注入。"

---

## 完整部署流程（面试可讲）

```
1. 构建镜像
   docker build -f docker/Dockerfile.app -t harbor/mszlu-ai/app:v1.0.0 .
   docker push harbor/mszlu-ai/app:v1.0.0

2. 创建命名空间
   kubectl create namespace mszlu-ai

3. 创建 ConfigMap（注入 config.yml）
   kubectl apply -f k8s/app-configmap.yml

4. 创建 RBAC
   kubectl apply -f k8s/rabc.yml

5. 部署应用
   kubectl apply -f k8s/app-deployments.yml
   kubectl apply -f k8s/app-service.yml
   kubectl apply -f k8s/app-ingress.yml
   kubectl apply -f k8s/app-hpa.yml

6. 验证
   kubectl rollout status deployment/mszlu-ai-app -n mszlu-ai
   kubectl get pods -n mszlu-ai
```

---

## K8s 面试高频追问

**Q: 滚动升级时如何保证零停机？**

> A: K8s 默认的 RollingUpdate 策略保证了零停机：先启动新版本 Pod，等就绪探针通过后，再将旧版本 Pod 摘除。关键是就绪探针要配置正确——如果 readinessProbe 没配好，新 Pod 可能在还没完全初始化时就开始接收流量，导致请求失败。项目中就绪探针的 `initialDelaySeconds: 30` 给了 30 秒初始化时间。另外 `terminationGracePeriodSeconds: 30` 保证被删除的 Pod 有 30 秒处理完 in-flight 请求再退出。

**Q: 如果 LLM API 限流，HPA 扩出来的新 Pod 有用吗？**

> A: 这是一个很好的问题。HPA 扩容增加了处理能力，但 LLM API 的 rate limit 是针对 API Key 的，扩容后多个 Pod 共用同一个 API Key，hit rate limit 的概率反而更高。解决方案：① 配置多个 API Key（在不同 LLM provider 账号下申请），轮询或按 Pod 哈希分配；② 实现请求队列 + 背压机制，超过 rate limit 时返回 503 让客户端重试，而不是让 Pod 无限等待；③ 接入多模型路由（如同时支持 OpenAI 和通义千问），主路由打满时自动切换备用模型。

**Q: 数据库（PostgreSQL/Redis）部署在 K8s 里还是外部？**

> A: 项目的 `database-service.yml` 使用 ExternalName 类型的 Service，把外部数据库的 DNS 名映射进 K8s 集群网络。这说明数据库部署在 K8s 集群外部（如云服务商的 RDS 或独立服务器）。这是生产环境的标准做法：有状态服务（数据库）部署在集群外，由专业的 DBaaS 管理（备份/HA/故障转移）；无状态服务（应用）部署在 K8s 中享受弹性扩缩容。把数据库放进 K8s 虽然可行，但需要处理持久化存储、StatefulSet 调度、数据备份等复杂问题，门槛较高。
