# 国家虚拟仿真实验平台接入：开发与联调说明

日期：2026-10-15。本文对应 `aliyun/ilab/` 开发模块与离线安装器。模块代码和本地模拟测试不代表国家平台已验收，也不代表系统已通过等级保护测评。

## 本次实现的边界

适配器负责平台身份交换、独立实验会话、实验步骤与 AI 调用证据汇总、成绩和实验报告上报。它不会把已有课程的提交次数、课程解锁进度、AI 点评文本自动转换为正式成绩。实际外部接口字段与校验以 `aliyun/ilab/protocol.mjs` 为准；HTTP 与内部事件接口以 `aliyun/ilab/integration.mjs` 为准。

当前课程与 Cloud 的真实运行事件、教师数值评分、国家平台账号与课程账号绑定仍须在业务入口接入。安装路由后不能对外宣布“全课程已接通国家平台”。平台分配的项目参数和测试权限到位、真实教学评分规则落实后，才能完成外部联调。

正式接口说明入口：<https://shenbao.ilab-x.com/declare/wiki/v2>。平台正式服务入口：<https://www.ilab-x.com>。应使用申报平台当前分配的接口文档与测试参数，不能把测试成功当作正式项目开通。

## 现网课程代码核查结果

已通过“腾讯云连接”对阿里云当前部署源码 `/opt/omindos-deploy/chat-current` 进行只读核查；未更改服务器文件、数据库、服务或配置。当前仓库主分支缺少现网的部分课程模块，不能直接用主分支覆盖整套现网目录。

| 当前入口或数据 | 能证明的事实 | 接入位置与限制 |
| --- | --- | --- |
| `aliyun/learning/service.mjs` | 课程外层 ROS2 入口；调用 `service-core.mjs` | 当前主分支未完整包含此模块，必须基于部署目录的完整副本做增量接入 |
| `service-core.mjs` 的 `progressFor()` | 学生向某课程提交过作业及课程解锁状态 | 不是教师评分，不得映射为 60 分、100 分或实验通过 |
| `learning_submissions.review_state` 与 AI 点评 | 作业已保存、AI 反馈是否完成 | 现有提示明确“正式验收由教师确认”；无数字成绩或教师评分表 |
| `POST /api/learning/ros2/run` | 服务器签名调用 ROS2，核查返回的 `runId`、`source`、CSV、PNG、`passed` | `service.mjs` 调用 `ros.run()` 之后可记录真实步骤；该预设运行结果当前未写入课程数据库，需持久化后引用 |
| `POST /api/learning/graduation` | 服务端 ROS2 的七段指令、Pose 采样和 `gradeGraduation()` 的逐项判定 | `service-core.mjs` 持久化 `evidence` 后记录步骤；只有 `passed` 和七项检查，没有正式数字总分 |
| `POST /api/learning/patrol` | 服务器运动学巡检的轨迹、记录、观测与指标 | 成功保存 `learning_patrol_attempts` 后接入；应标记仿真模型来源，不能声称实机巡检 |
| 提交中的 `patrolRunId` | 已验证该运行属于当前学生，且运行已完成 | `service-core.mjs` 核验并形成 `serverEvidence` 后引用该运行，不能信任浏览器随意提供的运行数据 |
| `POST /api/learning/git` 的 `check` | 真实 Git 操作及结果摘要 | 只证明版本操作，不证明机器人实验或教师验收通过 |
| Cloud 浏览器的按钮、页面进度 | 用户界面发生过交互 | 不能直接作为服务端运行成功或评分证据；需要 Cloud 后端签名发送执行记录 |

已确认的服务端运行入口只是可利用的证据源，本次没有把这些业务文件改写为自动上报。后续需为本次申报的一个完整实验明确真实步骤、教学目标、评分点和预计时长。通知要求学生交互操作不少于 20 步；现有七段 ROS2 结业练习不能通过拆分记录、复制事件或补造时间来凑足步骤。

## 账号、步骤和成绩如何挂接

1. 国家平台票据由适配器向平台验证，换成独立的本地 iLAB 会话。HTTP 层用 `URLSearchParams` 解码一次；`exchangeTicket()` 接收解码后的原文，仅在外发 URL 中编码一次。平台启动链接中不可避免会包含短期票据，入口代理应屏蔽该路由的查询参数日志；页面跳转使用 `no-referrer`，票据、平台 token 和项目密钥不能进入前端脚本或课程提交正文。
2. 现有课程仍使用 `worker` 的 `/api/visitor/status` 登录身份和学生邮箱；正式提交还检查新手村协议。国家平台 `username` 不能直接当作邮箱，也不能仅凭前端传来的邮箱创建绑定。
3. 在已经验证的两种会话之间建立明确的账号绑定。业务后端将 `attemptId` 与当前授权用户、本实验、`runId`/`submissionId` 关联并保存；后续从这个关联读取，不相信浏览器提供的任意 `attemptId`。
4. 真实运行开始时记录服务端时间；真实运行完成、证据格式校验和数据库写入成功后，通过 `recordStep(attemptId, {eventId, source, evidenceId, step})` 接入。`step` 必须包含真实步骤字段，其他三项是可追溯事件编号、来源及证据编号；确切字段由运行时校验。
5. 正式评分来自已授权教师确认或事先确定并版本化的服务端判分器，再调用 `complete(attemptId, result)`。总分、分步分数、评分标准及实验时长必须有真实依据。AI 建议、作业提交次数和布尔通过状态不能擅自转换为正式数字总分。
6. 跨服务器场景使用 `POST /api/internal/ilab/events` 的 HMAC 认证入口；签名密钥只在后端持有。根据运行时协议签名原始请求体并携带时间及唯一 nonce，避免篡改和重放。浏览器没有写步骤、写成绩或增加 AI 次数的权限。

内部记录方法是受信任后端接口，不是供网页直接调用的 SDK。浏览器只可以展示当前会话的状态并发起适配器允许的操作。将写分数的按钮隐藏起来，不能代替服务端权限检查。

服务端直接方法的参数如下。这里的 `step`、`score` 和时间必须由真实证据及确定的评分规则生成，不能照示例补造：

```js
ilabIntegration.recordStep(attemptId, {
  eventId, source, evidenceId,
  step: verifiedAndGradedStep,
});
ilabIntegration.recordAiCall(attemptId, {
  eventId, source, evidenceId,
  model, version, deployment, provider, scenario,
  // inputTokens / outputTokens 仅在供应商实际提供时附加
});
ilabIntegration.complete(attemptId, {
  eventId, source, evidenceId, score, completedAt,
});
```

跨服务器后端可以导入 `signIlabEvent()`，对包含 `{attemptId, type, data}` 的原始 JSON 字符串签名，再原样 POST。`type` 为 `step`、`ai` 或 `complete`，`data` 是上述对应参数。签名头为 `x-ilab-timestamp`（毫秒）、`x-ilab-nonce`、`x-ilab-signature`；可接受的时钟偏差为五分钟。重试同一业务事件时保留 `eventId` 与内容，但生成新的请求 nonce。未改变的业务事件会幂等处理，相同编号的不同内容会拒绝。

## 配置与路由

启用前保持 `ILAB_ENABLED` 未设置或为 `false`。关闭时不创建 iLAB 数据库、不要求项目密钥；相关接入路由返回未启用状态，其他业务路由继续分发。安装器不会改变这些环境变量。

| 配置 | 用途 |
| --- | --- |
| `ILAB_ENABLED=true` | 显式启用本模块 |
| `ILAB_MODE` | `mock`、`test`、`production`；默认 `test`，`mock` 必须通过代码注入本地模拟 `fetcher` |
| `ILAB_PUBLIC_ORIGIN` | 浏览器访问的完整 HTTPS 源，默认 `https://omindos.cn`；不能含路径 |
| `APP_ORIGIN` | 已有服务器请求源；支持 HTTPS 或本地回环 HTTP |
| `ILAB_EXPERIMENT_PATH` | 同源 `/learning` 下的固定实验入口；默认 `/learning` |
| `ILAB_APPID`、`ILAB_SECRET` | 国家平台分配的项目编号及密钥；必须通过服务器私密配置提供 |
| `ILAB_STORAGE_KEY` | 32 随机字节的 Base64，独立加密本地平台凭据；不得丢失或直接轮换 |
| `ILAB_EVENT_SECRET` | 跨服务签名密钥，至少 32 字节；未配置时后端事件 HTTP 入口关闭 |
| `ILAB_SQLITE_PATH` | 独立数据库路径；服务器集成默认 `/var/lib/originmind-chat/ilab.sqlite` |
| `ILAB_EXPERIMENT_TITLE` | 本次申报的真实实验名称 |
| `ILAB_REQUIRED_STEPS` | 本实验完整步骤数，默认 24，允许 20–200；数目应由真实教学设计确定 |
| `ILAB_API_ORIGIN` | 固定官方测试或正式接口地址；不接受任意第三方源 |
| `ILAB_ALLOW_PRODUCTION=true` | 使用正式模式时另行显式允许正式请求 |

| 路由 | 权限与作用 |
| --- | --- |
| `GET /learning/ilab/launch?ticket=...` | 国家平台进入；服务端验证票据后跳转到固定实验入口 |
| `GET /learning/ilab/session` | 当前 HttpOnly Cookie 对应的实验状态和 CSRF token |
| `GET /learning/ilab/preview` | 当前会话已经由后端形成的完整上报数据；证据不齐时拒绝 |
| `POST /learning/ilab/submit` | 当前会话请求同步，要求同源及 `x-ilab-csrf`；请求体仅可为空或 `{}`，不能指定分数 |
| `POST /learning/ilab/report?filename=report.pdf` | 当前会话保存 PDF 原始字节，要求同源及 CSRF；最多 5,000,000 字节 |
| `POST /learning/ilab/report/submit` | 当前会话同步报告，请求体为空，要求同源及 CSRF |
| `POST /api/internal/ilab/events` | 仅接受后端 HMAC 签名证据，不接受浏览器 Origin 请求 |

此处的 PDF 校验只有类型、大小及文件头约束，并非完整 PDF 内容安全扫描。平台回执超时或不确定时不得盲目重发成绩或报告；应先核查平台状态及本地记录。数据库与加密密钥应一起纳入受限访问的恢复计划。当前持久化适用于单实例运行，同一数据库不能同时启动两个接入实例；打开数据库会把上次未完成的发送标为待核查，避免重启重复上报。应由负责人核对国家平台记录后决定后续处理，当前版本不提供绕过核查的自动重发。

## AI 调用怎么记真实数据

现网课程 AI 答疑与点评经 `chat-cloudflare/src/app.mjs` 中的 `reviewLearningSubmission()` 调用模型。底层 `modelCall()` 可以为完成一个回答多次调用供应商；`workersAiCall()` 也是实际供应商入口。当前课程最终只拿到答复字符串，供应商的 token usage 尚未进入课程记录。

应在每次实际供应商请求完成的位置接入 `recordAiCall(attemptId, call)`：

- 百炼：`modelCall()` 内 `context.runtime.fetch()` 的每次回包；非流式响应读取 JSON 后、提取答案前取得供应商返回的模型和 `usage`。流式场景须单独解析供应商最终 usage 事件，不能用文本字数估算 token。
- Workers AI：`workersAiCall()` 内每次 `env.AI.run()` 返回之后，依据供应商实返字段记录；供应商未给 token 时保留未知说明，不填伪造的零。
- 场景：明确区分答疑、作业反馈、策略生成等，关联本次实验会话。一般聊天和其他学生的调用不能计入本实验。
- 幂等：使用供应商请求编号或服务端唯一事件编号。相同回包不重复累计；同一次用户操作触发多个供应商调用时按实际请求记录。
- 隐私：模型名、版本、部署方式、供应商、实际 token 计数足够支撑计量；不要把 API Key、完整作业、完整聊天或供应商认证头写入统计记录。

`learning_limits` 是频控计数，不能用作实际 AI 调用台账；本地预置提示命中时没有实际调用，也不应计数。模型名不能代替模型版本；版本未知时应明确记录未知及说明，不补造版本。正式环境接入前还需确认错误调用、供应商续写和备用服务切换的统一计数口径。

## 离线安装到现网完整副本

安装器 `scripts/install-ilab-overlay.mjs` 只适合已经准备好的完整部署副本。它不登录服务器，不读取密钥，不迁移课程库，不修改环境变量，也不启动或重启服务。

安装器将增量复制 `aliyun/ilab/` 中的运行文件，并向副本中的 `aliyun/chat-server.mjs` 插入四处明确标记：导入、初始化、`webRequest()` 后优先分发、退出关闭。其他课程、OA、竞技场及 AI 模块保留原样。遇到未知入口、残缺集成、不同的已有 iLAB 文件或符号链接会拒绝处理。

在仓库根目录运行，以下路径均为示例的离线副本，不能指向正在运行的版本：

```bash
node scripts/install-ilab-overlay.mjs --target /srv/omindos-staging/chat-with-current-learning --check
```

检查输出的 SHA-256 变更清单。决定写入这个副本时，提供一个尚不存在的备份目录，其父目录必须已经存在：

```bash
node scripts/install-ilab-overlay.mjs --target /srv/omindos-staging/chat-with-current-learning --apply --backup-dir /srv/omindos-backups/ilab-overlay-20261015-01
```

`--target` 和 `--backup-dir` 必须是显式绝对路径；备份不能放在目标树中。默认仅检查，不写文件。安装前会对候选服务器文件及运行模块做 `node --check`，已有文件备份与哈希清单先保存；变更过程中检测原文件是否被其他操作改动。安装失败会尝试恢复已变更文件，并将结果记入备份目录的 `manifest.json`。已经存在、内容一致的完整安装可重复检查；不同版本的运行文件须单独审查升级，不会自动覆盖。

运行测试：

```bash
node --test aliyun/ilab/*.test.mjs
```

安装器的测试覆盖未知锚点、残缺集成、只读检查、备份要求、不覆盖既有备份、源码语法错误、符号链接、现有不同运行文件、幂等和保留课程文件。它不验证真实国家平台凭据，也不替代生产发布前的完整课程回归。

若需要撤回离线副本改动，首先停下对该副本的其他编辑，检查 `manifest.json` 的 `before`/`after` 哈希；将备份中的 `aliyun/chat-server.mjs` 恢复到副本，仅删除清单中 `before: null` 且当前哈希仍等于 `after` 的新增运行文件。不要删除独立数据目录中的数据库，也不要覆盖清单之外的任何文件。运行服务版本的回退应使用既有发布系统的完整版本回退流程。

## 正式外部联调与等保的待办

| 工作 | 完成条件 |
| --- | --- |
| 取得项目权限 | 国家平台测试/正式 `appid`、密钥与文档；在服务器配置中保管，代码和文档不存真实凭据 |
| 会话与本地账号桥接 | 经验证的国家平台账号绑定经验证的课程账号，实验记录不会串到其他人 |
| 本次实验教学设计 | 真实的至少 20 个交互步骤、时间、证据类型、评分标准、教师或服务端判分器 |
| 课程和 Cloud 业务 hook | 真实后端事件写入，失败、重试、停止、无 AI 调用情况均保留真实状态 |
| 平台测试联调 | 身份进入、实验完成、AI 字段、成绩回执、报告上传、失败处理的完整往返记录 |
| 正式环境启用 | 获得正式参数和配置、完成小范围验收后再开放，不以本地 mock 代替正式验收 |
| 等保二级材料 | 按平台当前答疑以高校为课程系统备案责任主体，明确系统边界，确认学校现有测评能否覆盖；由学校及专业测评机构落实证明。企业可参与技术建设并为自身运营系统办理等保，但企业报告能否用于本次高校申报需另行确认 |

软件可提供权限、审计、会话隔离、密钥保护和数据追溯等整改基础。等保定级、备案及第三方测评报告仍需对应组织办理，不能由安装脚本或自动测试生成合格证明。
