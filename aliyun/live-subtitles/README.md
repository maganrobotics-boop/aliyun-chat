# 中日连续字幕（国内部署）

腾讯云 `omindos.cn/chat` 网关 → 阿里云现有 Node Chat 服务 → 阿里云百炼实时翻译。
录音直接写入阿里云私有 OSS；不经过 Cloudflare，也不把音频写到服务器磁盘。
`chat-cloudflare/` 是现有共享应用的历史目录名。

默认日语→中文，可在会话结束后切换中文→日语。浏览器麦克风以单声道 16 kHz PCM 分片发送，原文/译文通过 NDJSON 连续返回。
支持字幕导出、私有录音列表、WAV 分段回听/下载。暂不播报译文，不接系统内其他应用的音频。
进入后台会结束当前收音；每场最多一小时，每账号一场，全服务最多四场。

## 已发布与免登录使用（2026-10-14）

用户 13:34 明确要求上线，随后要求先免登录。正式入口为 `https://omindos.cn/chat/subtitles`，Chat 功能区也已显示“实时字幕”。
匿名访问状态接口会取得 Secure / HttpOnly / SameSite=Strict 的加密浏览器凭证，无需邮箱或扫码登录。
凭证有效期 30 天，再次打开字幕页面会续期；匿名录音和字幕会话按此浏览器隔离，清除浏览器数据或更换浏览器后无法恢复访问，请及时下载。
已有登录用户仍使用自己的账号归属。游客每浏览器一场、全服务四场，并沿用同源检查及每 IP 每小时 12 次开始限制。

阿里云运行版本：`chat-live-subtitles-20261014-v1`；腾讯入口：`20261014-live-subtitles-v1`。
独立 OSS 文件权限 0600，字幕库权限 0600，服务停止超时 60 秒。完整自动部署暂停标记保留。
24 项相关测试、12 项网关测试、1366/390px 实际 AudioWorklet（虚拟麦克风）检查通过。
正式 `/chat` HTTPS 入口已验证免登录创建翻译会话、连续事件、正常结束、浏览器间隔离、跨站写入拒绝、录音列表和麦克风权限头；没有生成生产测试录音。
真实双向音频和 OSS 尾段验收数据见下方。旧试卷批改页面/API 按用户此前要求停用，历史数据保留。

## 运行配置

Node.js 22.16+。在独立目录执行 `npm ci --omit=dev --ignore-scripts`。
只有 `CHAT_SUBTITLES_ENABLED=true` 才加载实时服务。初始化失败不影响现有 Chat。
在服务器受保护的环境文件中配置以下项，密钥不得进入仓库或浏览器：

```dotenv
CHAT_SUBTITLES_ENABLED=true
CHAT_SUBTITLES_BASE_URL=https://maas.qianwenaiapi.com/compatible-mode/v1
CHAT_SUBTITLES_API_KEY=<千问AI平台按量付费普通密钥>
CHAT_SUBTITLES_MODEL=qwen3.8-livetranslate-flash-realtime
CHAT_SUBTITLES_STORAGE_ENV=/etc/originmind-chat/subtitles-storage.env
CHAT_SUBTITLES_DB=/var/lib/originmind-chat/subtitles.sqlite
```

基址与密钥须成对配置。上例对应千问AI平台按量付费 Key（支持含点的 `sk-ws-` 格式）；
服务将该 HTTPS 基址转换为 `wss://maas.qianwenaiapi.com/api-ws/v1/realtime?model=qwen3.8-livetranslate-flash-realtime`。
也保留百炼 `https://<业务空间ID>.cn-beijing.maas.aliyuncs.com` 和标准 DashScope 域名支持，使用时需匹配地域/空间的普通 Key。
不自动复用 Chat 的 Token Plan / Coding Plan 套餐密钥；既有聊天配置保持独立。
`subtitles-storage.env` 权限 0600，仅含所需 OSS 项：
`OA_OSS_BUCKET`、`OA_OSS_REGION`、`OA_OSS_ENDPOINT`、`OSS_ACCESS_KEY_ID`、`OSS_ACCESS_KEY_SECRET`、可选 `OSS_STS_TOKEN`。
沿用现有已授权私有桶及内网 endpoint；不要把 OA 全部环境变量导入 Chat。

### 认证排查与安全录入（本轮新增）

OA `/admin` 新增独立“实时字幕”连接区：预填千问标准地址，可填写普通 Key、验证保存及检测已保存连接。
沿用 OA 管理员权限和独立管理密码；通过带防重放的服务签名调用 Chat 管理桥。
双向 WebSocket 会话验证成功后，Key 使用现有 AES-GCM 加密，写入 Chat `settings` 的 `subtitles-provider` 项；
独立于聊天的 `model` 项，页面只返回是否已配置和验证时间，失败保留旧值，留空保留原语音 Key。
字幕创建会话时优先读取该配置；没有后台配置时才回退到独立环境变量。保存配置不会启用字幕或自动开始录音。
后台仅验证连接与会话，不代表真实中日音频测试通过，也不承诺 Harness ASR 额度覆盖 LiveTranslate。

2026-10-14 续接时只在服务器内存中核对密钥类型和非敏感域名：Chat 数据库的密钥为 `sk-sp-` 套餐类型，
配置地址为 `token-plan.cn-beijing.maas.aliyuncs.com`，实际属于 **Token Plan**，纠正上一轮所写的 Coding Plan。
该凭据与普通百炼实时接口不匹配；仅换 endpoint 不能解决 401。本轮未再次拿不匹配的密钥请求百炼。
Chat 环境未设置独立 `CHAT_SUBTITLES_API_KEY`；检查过的 Chat/OA 环境文件未发现普通百炼语音 Key。
用户最新截图确认千问AI平台账户已有普通 Key（描述含 `aliyun-omindos-chat`），配套地址是 `maas.qianwenaiapi.com`，无需因本次问题先新建或重置 Key。
截图仅含掩码，无法用于认证；当前 Chat 环境及该目录的 env 备份均未找到普通 Key，数据库当前仍为套餐 Key。
需要从用户已保存的完整普通 Key 安全录入独立字幕配置。不要将“服务器未配置”误写成“账户没有 Key/套餐”。

也可在阿里云服务器交互终端配置环境变量回退项（不能把 Key 当作参数、发到聊天或提交仓库）：

```sh
sudo python3 /opt/omindos-deploy/staging/live-subtitles-20261014/runtime/configure-provider.py
sudo node /opt/omindos-deploy/staging/live-subtitles-20261014/runtime/check-provider.mjs
```

第一条默认选择千问AI平台，隐藏输入普通 Key 并配套写入按量付费 URL；
如使用旧百炼北京空间，显式添加 `--provider aliyun-workspace`，再输入业务空间 ID。
只创建 `/etc/originmind-chat/subtitles-provider.env`（0600、不覆盖已有文件、默认禁用字幕）。
第二条只验证双向 WebSocket 认证、会话参数和结束确认，不发送音频、不建立录音。
两条命令均不修改聊天 Key、不重启、不发布；检查成功也**不等于真实语音翻译验收通过**。
正式发布时才把独立 provider 文件作为 systemd EnvironmentFile 加载，并按发布流程启用字幕。
若文件已存在，脚本会停止，管理员核对后再处理；不会静默覆盖凭据。

代码会在发起连接前拒绝套餐 Key、缺失/畸形 Key 和不允许的 endpoint；
上游 401/403/429 分别给出认证、权限、额度提示，作为服务不可用（503）返回，不会误报为访客登录过期。
上游原始响应体、请求头和密钥不会被输出。

Standard/Pro 附赠 Harness 每月 5 小时语音识别，官方要求普通 Key 与标准 Base URL，系统识别同账号权益。
该权益不是“任意语音模型免费”：尚未确认本实现直接调用的 LiveTranslate 能否抵扣 Harness ASR 额度，
不可承诺实时翻译已包含在 5 小时内；真实接口调用和账单抵扣仍待验证。

## 存储和恢复

录音默认开启，开始前可取消。每约 30 秒生成一个独立可播放的 WAV，直接上传 `chat-recordings/v1/<会话 UUID>/<片段>.wav`。
显式 private ACL、上传 MD5、对象元数据 SHA-256、HEAD 长度校验；下载再次核对 SHA-256。
SQLite 仅保存归属、片段索引、字幕及状态。所有读取先核对登录邮箱，浏览器不获取 OSS 密钥或公开对象 URL。
保存失败会中断收音并标记 `save_failed`。正常退出等待尾段写入，服务管理器应保留至少 50 秒停止时间。
硬断电/进程被强杀可能丢失内存中不足 30 秒的尾段；已经上传并登记的片段保留。
一小时原始 WAV 约 115.2 MB；未验证用户所说 100 GB 套餐的余额，也没有自动删除录音。

## 验证（2026-10-14）

### 最新实际验收（13:28 北京时间）

用户通过 OA 后台保存普通 Key，13:24:18 双向连接验证成功，先前的 401 已解除。
`check-live-audio.mjs` 使用阿里官方公开试听样本调用真实翻译服务，未使用用户麦克风或私有录音：

| 方向 | 样本长度 | 首段译文 | 停止至结束并保存 | 录音分段 |
| --- | --- | --- | --- | --- |
| 日语→中文 | 17.666 秒 | 3.449 秒 | 1.106 秒 | 4 |
| 中文→日语 | 16.520 秒 | 3.415 秒 | 1.220 秒 | 4 |

两方向均返回原文和译文，最终字幕完成；录音下载合并后与输入 PCM 逐字节相同，包含停止尾段。
对象 ACL 为 private，跨账号访问被拒绝，8 个临时测试对象均已删除。测试将分段阈值缩短为 5 秒，以短样本覆盖分段与尾段。
这验证了真实接口和存储链路，不代表长报告、嘈杂环境或用户手机麦克风已验收；短样本时延不是服务保证。
中文→日语样本中“场景”一词保留了中文写法，仍应把译文视为辅助字幕。

新候选 `/opt/omindos-deploy/staging/live-subtitles-20261014/candidate-verified` 基于最新后台生产版增量重建，保留普通 Key 配置能力。
前端构建、23 项相关测试与腾讯网关 12 项测试通过，随后追加免登录隔离测试并正式发布，见上方最新状态。

以下保留早期无普通 Key 时的测试记录，不能用作最新连接状态。

- 本轮 12 个功能测试通过：原 9 项加套餐密钥预检、认证状态码分类和无效配置下录音列表仍可访问。
- 本轮 5 个真实 `ws` 回环传输测试通过：401/403/429/500 连接清理、认证头、两种语言参数和结束确认；仅本机合成服务，不是百炼真实翻译。
- 本轮 4 个安全录入测试通过：千问普通 Key 与域名配对、0600、默认关闭、不覆盖现有文件、拒绝套餐/畸形输入、拒绝符号链接。
- Chromium 实际 getUserMedia / AudioWorklet 使用虚拟麦克风通过；服务端字幕为合成测试数据。覆盖双向切换、结束、录音入口、XSS 文本、接口失败、未登录和未配置，1366/390 宽度。
- 真实 OSS 合成 1 秒录音写入、HEAD/下载完整性、private ACL 和账号隔离通过；测试对象已删除。
- 腾讯云网关候选 12 项测试通过，包含字幕路径前缀和麦克风权限头。
- 国内现网副本回归 111 项中 107 通过、4 失败；现网原版本同样有这 4 个静态路由旧断言失败，未扩大失败范围。
- 千问按量域名转换、含点普通 Key 的认证头和双向回环会话通过；仍未使用用户的真实普通 Key 完成供应商认证。
- 上轮现有 Chat 套餐凭据在实时翻译握手返回 HTTP 401；本轮已确认 Token Plan 凭据类型不匹配，普通 Key 尚未安全录入服务器，仍未完成真实日中翻译验收。

```sh
node --test chat-cloudflare/test/live-subtitles.test.mjs
node --test aliyun/live-subtitles/provider-transport.test.mjs
python3 -m unittest discover -s aliyun/live-subtitles -p 'test_*.py'
PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs node scripts/check-chat-subtitles-browser.mjs
```

## 发布范围与回滚

本变更移除试卷批改的页面、入口、API 实现及测试；旧 URL/API 返回 410。
保留聊天、共享文档提取依赖、用户数据、其他业务和历史发布文档。
不要整包覆盖生产：现网存在课程/竞技场等独立更新，`chat-full-deploy.paused` 应保留。
应从当前国内生产目录复制候选，精确应用相关文件修改，重新构建现网前端；腾讯云仅扩展网关 `ROOTS` 中的字幕路径。
先验证源站和 `/chat` 前缀下的登录、收音、字幕流、真实翻译、OSS 回听，再在取得发布授权后切换版本。
回滚时恢复旧 Chat/网关版本及环境配置，保留字幕 SQLite 和 OSS 录音。

接口依据：[百炼实时翻译](https://help.aliyun.com/zh/model-studio/qwen3-5-livetranslate-flash-realtime)。
认证依据：[Base URL 与计费方案配套](https://help.aliyun.com/zh/model-studio/base-url)、[普通 API Key](https://help.aliyun.com/en/model-studio/get-api-key)。
千问平台依据：[普通 API Key](https://platform.qianwenai.com/docs/api-reference/preparation/api-key)、[实时翻译与 WebSocket 地址](https://platform.qianwenai.com/docs/developer-guides/speech/realtime-translation)、[Harness 权益](https://platform.qianwenai.com/docs/token-plan/personal/token-plan-harness-benefits)。
