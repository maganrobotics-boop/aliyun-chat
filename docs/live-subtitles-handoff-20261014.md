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

下一步：在百炼北京地域选择或创建与业务空间对应的普通 API Key，使用 README 中服务器终端命令安全录入。
无需新增 Coding Plan/Token Plan 套餐；普通 API 调用按百炼计费规则处理。Key 不要发到聊天里。
凭据验收后继续真实中日音频、停止尾段、私有录音回听及国内 `/chat` 入口测试，之后再取得正式发布授权。
