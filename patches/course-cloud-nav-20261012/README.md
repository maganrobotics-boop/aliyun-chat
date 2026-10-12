# 课程顶部云机器人入口

用户要求把课程顶部挑战赛入口换成“云机器人”。实际顶部旧标签为“竞技场”，目标为 `/arena/`。

## 修改

- 顶部入口：`云机器人` → `https://cloud.omindos.cn/`。
- 继续使用原有同页跳转方式、导航样式和显示条件。
- 仅修改 `chat-cloudflare/public/learning/honors.mjs` 的一行。

## 发布记录

2026-10-12 10:34（北京时间），在当前生产版本 `chat-learning-full-acceptance-20261012-v1` 上定向原子更新该静态模块。没有整站部署或服务重启。主分支缺少完整线上课程基线，保留 `chat-full-deploy.paused` 保护，不可用本分支全量替换生产。

- 原文件 SHA-256：`237d6a92e936e2cd70cc2d71ac3bc01f44d28375dc051e28e20bd1c07bc6b236`
- 新文件 SHA-256：`8766a76cd15a4698ccfd4a02e462239088fea54052d9991c40fc19ee08a23d2a`
- 回退文件：`/opt/omindos-deploy/backups/course-cloud-nav-20261012/honors.mjs`
- 定向补丁：`navigation.patch`（在生产副本根目录使用 `patch -p1`，应用前核对原文件散列；不要将旧生产副本整体覆盖线上）。

## 验证

- JavaScript 语法检查通过。
- 修改差异精确比对通过，只有顶部导航的一行变更。
- 发布前再次核对当前版本及原文件散列；采用文件原子替换。
- 现有 `Cache-Control: no-cache` 让刷新页面时重新验证模块。
