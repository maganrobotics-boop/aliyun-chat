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
CHAT_SUBTITLES_BASE_URL=https://dashscope.aliyuncs.com
CHAT_SUBTITLES_API_KEY=<可调用实时翻译的百炼密钥>
CHAT_SUBTITLES_MODEL=qwen3.8-livetranslate-flash-realtime
CHAT_SUBTITLES_STORAGE_ENV=/etc/originmind-chat/subtitles-storage.env
CHAT_SUBTITLES_DB=/var/lib/originmind-chat/subtitles.sqlite
```

基址与密钥须属于同一区域/空间，也支持服务端显式配置的百炼 workspace 域名。
不自动复用 Chat 的 Coding Plan 文本密钥。`subtitles-storage.env` 权限 0600，仅含所需 OSS 项：
`OA_OSS_BUCKET`、`OA_OSS_REGION`、`OA_OSS_ENDPOINT`、`OSS_ACCESS_KEY_ID`、`OSS_ACCESS_KEY_SECRET`、可选 `OSS_STS_TOKEN`。
沿用现有已授权私有桶及内网 endpoint；不要把 OA 全部环境变量导入 Chat。

## 存储和恢复

录音默认开启，开始前可取消。每约 30 秒生成一个独立可播放的 WAV，直接上传 `chat-recordings/v1/<会话 UUID>/<片段>.wav`。
显式 private ACL、上传 MD5、对象元数据 SHA-256、HEAD 长度校验；下载再次核对 SHA-256。
SQLite 仅保存归属、片段索引、字幕及状态。所有读取先核对登录邮箱，浏览器不获取 OSS 密钥或公开对象 URL。
保存失败会中断收音并标记 `save_failed`。正常退出等待尾段写入，服务管理器应保留至少 50 秒停止时间。
硬断电/进程被强杀可能丢失内存中不足 30 秒的尾段；已经上传并登记的片段保留。
一小时原始 WAV 约 115.2 MB；未验证用户所说 100 GB 套餐的余额，也没有自动删除录音。

## 验证（2026-10-14）

- 9 个功能测试通过：账号隔离、PCM 分片、重传去重、字幕重放、保存失败、关机等待、权限头和 44.1/48 kHz 重采样。
- Chromium 实际 getUserMedia / AudioWorklet 使用虚拟麦克风通过；服务端字幕为合成测试数据。覆盖双向切换、结束、录音入口、XSS 文本、接口失败、未登录和未配置，1366/390 宽度。
- 真实 OSS 合成 1 秒录音写入、HEAD/下载完整性、private ACL 和账号隔离通过；测试对象已删除。
- 腾讯云网关候选 12 项测试通过，包含字幕路径前缀和麦克风权限头。
- 国内现网副本回归 111 项中 107 通过、4 失败；现网原版本同样有这 4 个静态路由旧断言失败，未扩大失败范围。
- 现有 Chat 文本凭据在实时翻译握手返回 HTTP 401；尚不能声称真实日中翻译已验收。需配置可用实时翻译凭据并以日语/中文分别验证。

```sh
node --test chat-cloudflare/test/live-subtitles.test.mjs
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
