# 中日连续字幕（国内部署）

腾讯云 `omindos.cn/chat` 网关 → 阿里云现有 Node Chat 服务 → 阿里云百炼实时翻译。
录音直接写入阿里云私有 OSS；不经过 Cloudflare，也不把音频写到服务器磁盘。
`chat-cloudflare/` 是现有共享应用的历史目录名。

默认日语→中文，可在会话结束后切换中文→日语。浏览器麦克风以单声道 16 kHz PCM 分片发送，原文/译文通过 NDJSON 连续返回。
支持字幕导出、登录账号自己的录音列表、WAV 分段回听/下载。暂不播报译文，不接系统内其他应用的音频。
进入后台会结束当前收音；每场最多一小时，每账号一场，全服务最多四场。

## 运行配置

Node.js 22.16+。在独立目录执行 `npm ci --omit=dev --ignore-scripts`。
只有 `CHAT_SUBTITLES_ENABLED=true` 才加载实时服务。初始化失败不影响现有 Chat。
在服务器受保护的环境文件中配置以下项，密钥不得进入仓库或浏览器：

```dotenv
CHAT_SUBTITLES_ENABLED=true
CHAT_SUBTITLES_BASE_URL=https://<业务空间ID>.cn-beijing.maas.aliyuncs.com
CHAT_SUBTITLES_API_KEY=<可调用实时翻译的百炼密钥>
CHAT_SUBTITLES_MODEL=qwen3.8-livetranslate-flash-realtime
CHAT_SUBTITLES_STORAGE_ENV=/etc/originmind-chat/subtitles-storage.env
CHAT_SUBTITLES_DB=/var/lib/originmind-chat/subtitles.sqlite
```

基址与密钥须属于同一区域/空间，也支持服务端显式配置的百炼 workspace 域名。
不自动复用 Chat 的 Token Plan / Coding Plan 套餐密钥。语音使用普通百炼按量计费 API Key；既有聊天配置保持独立。
`subtitles-storage.env` 权限 0600，仅含所需 OSS 项：
`OA_OSS_BUCKET`、`OA_OSS_REGION`、`OA_OSS_ENDPOINT`、`OSS_ACCESS_KEY_ID`、`OSS_ACCESS_KEY_SECRET`、可选 `OSS_STS_TOKEN`。
沿用现有已授权私有桶及内网 endpoint；不要把 OA 全部环境变量导入 Chat。

### 认证排查与安全录入（本轮新增）

2026-10-14 续接时只在服务器内存中核对密钥类型和非敏感域名：Chat 数据库的密钥为 `sk-sp-` 套餐类型，
配置地址为 `token-plan.cn-beijing.maas.aliyuncs.com`，实际属于 **Token Plan**，纠正上一轮所写的 Coding Plan。
该凭据与普通百炼实时接口不匹配；仅换 endpoint 不能解决 401。本轮未再次拿不匹配的密钥请求百炼。
Chat 环境未设置独立 `CHAT_SUBTITLES_API_KEY`；检查过的 Chat/OA 环境文件未发现普通百炼语音 Key。
这不代表用户百炼账户从未创建过其他 Key；若已有北京地域、相同业务空间的普通 Key，可先验证再复用。

在阿里云服务器交互终端执行（不能把 Key 当作参数、发到聊天或提交仓库）：

```sh
sudo python3 /opt/omindos-deploy/staging/live-subtitles-20261014/runtime/configure-provider.py
sudo node /opt/omindos-deploy/staging/live-subtitles-20261014/runtime/check-provider.mjs
```

第一条隐藏输入普通 Key，只创建 `/etc/originmind-chat/subtitles-provider.env`（0600、不覆盖已有文件、默认禁用字幕）。
第二条只验证双向 WebSocket 认证、会话参数和结束确认，不发送音频、不建立录音。
两条命令均不修改聊天 Key、不重启、不发布；检查成功也**不等于真实语音翻译验收通过**。
正式发布时才把独立 provider 文件作为 systemd EnvironmentFile 加载，并按发布流程启用字幕。
若文件已存在，脚本会停止，管理员核对后再处理；不会静默覆盖凭据。

代码会在发起连接前拒绝套餐 Key、缺失/畸形 Key 和不允许的 endpoint；
上游 401/403/429 分别给出认证、权限、额度提示，作为服务不可用（503）返回，不会误报为访客登录过期。
上游原始响应体、请求头和密钥不会被输出。

## 存储和恢复

录音默认开启，开始前可取消。每约 30 秒生成一个独立可播放的 WAV，直接上传 `chat-recordings/v1/<会话 UUID>/<片段>.wav`。
显式 private ACL、上传 MD5、对象元数据 SHA-256、HEAD 长度校验；下载再次核对 SHA-256。
SQLite 仅保存归属、片段索引、字幕及状态。所有读取先核对登录邮箱，浏览器不获取 OSS 密钥或公开对象 URL。
保存失败会中断收音并标记 `save_failed`。正常退出等待尾段写入，服务管理器应保留至少 50 秒停止时间。
硬断电/进程被强杀可能丢失内存中不足 30 秒的尾段；已经上传并登记的片段保留。
一小时原始 WAV 约 115.2 MB；未验证用户所说 100 GB 套餐的余额，也没有自动删除录音。

## 验证（2026-10-14）

- 本轮 12 个功能测试通过：原 9 项加套餐密钥预检、认证状态码分类和无效配置下录音列表仍可访问。
- 本轮 5 个真实 `ws` 回环传输测试通过：401/403/429/500 连接清理、认证头、两种语言参数和结束确认；仅本机合成服务，不是百炼真实翻译。
- 本轮 3 个安全录入测试通过：0600、默认关闭、不覆盖现有文件、拒绝套餐/畸形输入、拒绝符号链接。
- Chromium 实际 getUserMedia / AudioWorklet 使用虚拟麦克风通过；服务端字幕为合成测试数据。覆盖双向切换、结束、录音入口、XSS 文本、接口失败、未登录和未配置，1366/390 宽度。
- 真实 OSS 合成 1 秒录音写入、HEAD/下载完整性、private ACL 和账号隔离通过；测试对象已删除。
- 腾讯云网关候选 12 项测试通过，包含字幕路径前缀和麦克风权限头。
- 国内现网副本回归 111 项中 107 通过、4 失败；现网原版本同样有这 4 个静态路由旧断言失败，未扩大失败范围。
- 上轮现有 Chat 套餐凭据在实时翻译握手返回 HTTP 401；本轮已确认 Token Plan 凭据类型不匹配，但尚无普通语音 Key，仍未完成真实日中翻译验收。

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
