# 中日字幕续接记录 · 2026-10-14

用户要求为 omindos.cn/chat 开发连续字幕，默认日语→中文，可切换中文→日语；先不做语音播报。
可去掉昨天的试卷批改；录音存阿里云现有私有 OSS。界面从简。部署在国内，Cloudflare 不参与运行。
用户最后要求“下页继续”，因此暂停并保存草稿。没有取得正式发布授权，也没有改动生产运行版本。

已实现：独立字幕页面、真实浏览器收音/16 kHz PCM 重采样、百炼 WebSocket 后端、字幕流与重连、登录隔离、私有 OSS 分段录音/回听/下载、字幕导出、批改入口与实现移除。
源码与测试见 aliyun/live-subtitles/README.md。

尚待解决的主要阻塞：当前 Chat 存储的是 Token Plan 文本配置（续接核实，纠正上一轮的 Coding Plan 判断），原有密钥在 workspace 实时端点和标准 dashscope 实时端点均返回 HTTP 401。
没有把密钥输出或写入仓库。需要配置拥有实时翻译权限的百炼密钥与匹配基址；不要要求用户把密钥贴在对话里。
配置后须完成日语/中文真实音频验证。浏览器测试使用虚拟麦克风和合成字幕，不能代替真实翻译验收。

服务与候选：

- 阿里云运行版本：/opt/omindos-deploy/chat-current → releases/chat-teacher-grading-20261013-v1。
- 阿里云隔离工作目录：/opt/omindos-deploy/staging/live-subtitles-20261014/。
- candidate/ 从现网副本精确改动，保留课程和竞技场的生产差异；已构建前端，尚未启动或切换生产。
- runtime/ 装好独立 ws 8.22.0 和 ali-oss 6.23.0，锁文件已收录；candidate 中依赖为指向该隔离目录的 symlink，正式发布应复制依赖或执行 npm ci。
- pr-source/ 使用 GitHub main 的精确构建输入生成草稿 PR 静态资源，与生产 candidate 分开。
- regression.log 与 baseline.log 证明 4 个失败断言均为现网已有的静态路由测试差异；新功能 9 项测试通过。
- verify-oss.mjs 已用真实私有 OSS 合成录音验证；测试对象已删除，未创建生产录音。
- probe.mjs 和 probe-standard-endpoint.mjs 只在内存解密既有文本密钥，结果均 401；勿无意义重复调用。
- 腾讯云网关候选：/opt/omindos-chat-entry/staging/live-subtitles-20261014/，12 项测试通过；生产仍为 /opt/omindos-chat-entry/current。
- OSS 配置目前在 /etc/originmind-oa/env；未来仅复制所需 OSS 字段到独立 0600 文件，不能整份导入 Chat。

正式发布前仍需：接通语音凭据、真实双向翻译和停止尾段保存验收、准备独立存储环境文件和至少 50 秒 systemd 停止超时、取得发布授权、按现网副本增量切换 Chat 与网关。
不要整仓部署，不要解除 chat-full-deploy.paused，不要清理用户数据。前端入口源码和构建产物已在草稿中移除批改，但生产批改仍保留到正式切换。
服务器磁盘并未满：阿里云约 11 GiB 可用，腾讯云约 29 GiB 可用；100 GB OSS 套餐剩余量尚未查询确认。

## 本页继续开发结果

- 在服务器内存中仅核对 Key 类型、配置存在性和域名：数据库 Key 为套餐类型，数据库 endpoint 为 `token-plan.cn-beijing.maas.aliyuncs.com`；Chat env 的 BAILIAN_BASE_URL 为北京业务空间域名。独立语音 Key 尚未配置。Chat/OA 已知环境文件中未发现普通百炼 Key；未搜索无关服务的凭据，也未输出真实 Key。
- 官方文档明确计费方案的 API Key/域名不能混用，故不再重复用套餐 Key 尝试实时接口。不修改现有聊天套餐设置。
- 新增 `credentials.mjs`；启动前拒绝套餐/畸形 Key，避免无效连接与录音；补充 HTTP 401/403/429 的安全错误分类与握手请求/响应清理。
- 无效语音配置的 status 返回不可用；录音列表和历史下载不依赖有效语音 Key；上游 401 返回服务 503，不触发访客重新登录。
- 新增 `configure-provider.py`：服务器 TTY 内隐藏录入北京业务空间普通 API Key，只创建独立 0600 配置，不覆盖已有文件，默认关闭字幕。拒绝非交互或无法关闭回显的录入。
- 新增 `check-provider.mjs`：从私有配置读取，双向握手和结束确认，不发送音频、不录音，不将认证成功冒充翻译成功。
- 本轮验证：12 个字幕功能测试、5 个真实 ws 回环传输测试、3 个安全配置测试通过。回环测试使用合成服务和测试 Key；缺少真实普通 Key，百炼认证及真实双向语音仍未通过验收。
- 只更新草稿 PR 和阿里云隔离候选/runtime，未改动 Chat/腾讯网关生产版本、凭据或服务，未移除生产批改。

### 用户截图纠正与千问平台兼容

- 用户 Standard 套餐生效，且千问AI平台按量付费区已经有普通 Key，描述包括 `aliyun-omindos-chat`；无需先新建或重置。
- 普通 Key 与 `https://maas.qianwenaiapi.com/compatible-mode/v1` 成对使用；实时字幕实际连接同域名的 `/api-ws/v1/realtime`，已由千问官方实时翻译文档核实。
- 修正本轮此前过严的格式校验，接受千问含点的 `sk-ws-` Key；明确允许千问标准域名，仍拒绝套餐域名、外部域名和 URL 内凭据。
- 安全录入默认选择千问平台并写入对应 URL；旧百炼北京空间仍可通过 `--provider aliyun-workspace` 配置。
- 当前 Chat 数据库仍保存套餐 Key，Chat 的 env 与同目录 env 备份未找到普通 Key。截图为掩码，不能充当完整凭据；未要求用户将 Key 发到聊天里。
- Standard 的 Harness 每月 5 小时语音识别已由官方文档确认；普通 Key 与标准 URL 可识别同账号权益，但尚未确认 LiveTranslate 是否抵扣该 ASR 额度，不能承诺免额外费用。
- 新平台域名转换与含点 Key 的 WebSocket 回环通过；本轮 12 个功能、5 个真实 ws 回环、4 个安全配置测试通过。未向真实平台发送新请求。

下一步：使用用户已有且安全保存的千问普通 Key，按 README 的服务器终端命令连同按量付费 URL 录入字幕独立配置。
当前阻塞是服务器缺少完整普通 Key，而非账户没有套餐/Key。若能定位既有完整凭据，可在服务器内直接复用；不要输出凭据。
Key 不要发到聊天里。
凭据验收后继续真实中日音频、停止尾段、私有录音回听及国内 `/chat` 入口测试，之后再取得正式发布授权。

### OA 后台独立语音配置

用户明确要求在 `https://oa.omindos.cn/admin` 添加另一组地址。已新增实时字幕卡片、普通 Key 输入、连接验证保存和重新检测。
OA 现网四个相关源码文件与仓库版本一致；对应前端也同步到 `maganrobotics-boop/aliyun-oa` 的独立分支。
Chat 新增 `subtitles-provider` 加密配置项及两项签名管理操作；沿用现有 OA 管理权限和独立管理会话校验。
服务器提供独立的双向 WebSocket 验证函数，未启用整套字幕也可以安全配置。失败保留旧配置，空 Key 保留旧语音 Key。
真实录音会话优先用后台配置；没有后台记录时才用独立语音环境变量，历史录音读取不依赖语音凭据。

隔离候选在 `/opt/omindos-deploy/staging/subtitle-admin-20261014/`：OA 从 `oa-assistant-name-20261014-v1` 复制，只改四个管理源码文件；
Chat 从 `chat-teacher-grading-20261013-v1` 复制，只叠加后台语音配置相关模块和服务注入，未叠加字幕页面、批改移除等完整 PR 改动。
保持原生产数据库、模型配置、环境文件及腾讯网关。完整字幕功能仍待普通 Key 和真实双向音频验收。
局部后端本机 23 项测试通过，生产副本上的 11 项配置/管理签名/WebSocket 测试通过，OA TypeScript 与 Next.js 国内构建通过。

## 后台配置已发布（2026-10-14）

- 用户授权添加独立语音地址，已增量发布到 `https://oa.omindos.cn/admin`，聊天配置仍独立。
- OA release：`/opt/omindos-deploy/releases/oa-subtitle-admin-20261014-v1`。
- Chat release：`/opt/omindos-deploy/releases/chat-subtitle-admin-20261014-v1`。只增量加入管理桥、语音配置和无音频连接验证模块，保留生产批改功能。
- 两服务启动与 HTTP 200 检查通过，未登录管理 API 仍返回 401。完整字幕发布暂停文件保留，尚未启用公众字幕。
- 23 项配置/桥接/字幕/传输测试、OA 类型检查和国内构建通过。实际后台组件在合成 API 下通过 1280px 与 390px 保存、空 Key、失败保留输入及无横向溢出检查；测试浏览器缺少中文字体，字形不作为该截图的验收依据。
- 首次发布因候选文件属于 root 导致服务无法读取，已自动回滚；按现有服务账户设置 release 所有者后重试成功。未更改 systemd 安全限制。
- 下一步：用户在新卡片填写普通 Key 并验证。之后继续真实中日音频、录音完整性验收，单独决定完整字幕发布。
- 全功能旧候选 `/opt/omindos-deploy/staging/live-subtitles-20261014` 未更新，后续必须基于本次后台 release 和 PR #9 最新代码重建，避免覆盖新配置入口。
