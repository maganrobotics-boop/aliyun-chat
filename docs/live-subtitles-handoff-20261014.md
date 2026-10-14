# 中日字幕续接记录 · 2026-10-14

用户要求为 omindos.cn/chat 开发连续字幕，默认日语→中文，可切换中文→日语；先不做语音播报。
可去掉昨天的试卷批改；录音存阿里云现有私有 OSS。界面从简。部署在国内，Cloudflare 不参与运行。
用户最后要求“下页继续”，因此暂停并保存草稿。没有取得正式发布授权，也没有改动生产运行版本。

已实现：独立字幕页面、真实浏览器收音/16 kHz PCM 重采样、百炼 WebSocket 后端、字幕流与重连、登录隔离、私有 OSS 分段录音/回听/下载、字幕导出、批改入口与实现移除。
源码与测试见 aliyun/live-subtitles/README.md。

尚待解决的主要阻塞：当前 Chat 存储的是 Coding Plan 文本配置，原有密钥在 workspace 实时端点和标准 dashscope 实时端点均返回 HTTP 401。
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
