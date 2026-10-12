# 发布记录 · 2026-10-12

用户于北京时间 08:05 明确要求“合并部署”后，PR #5 已合并，并于 **08:10** 完成定向发布。

- 正式入口：https://omindos.cn/learning
- 后端入口：https://chat.omindos.cn/learning
- PR：https://github.com/maganrobotics-boop/aliyun-chat/pull/5
- 补丁提交：`01db585732f75b5aca06cdb6d87bb37b605c66d4`
- 合并提交：`930816491bd5008974d0288ca22baaa217551d3e`
- 发布版本：`chat-learning-full-acceptance-20261012-v1`
- 回退版本：`chat-learning-runtime-feedback-20261012-v1`

## 发布范围

从当时最新生产目录复制完整候选，定向修改以下三个文件：

1. `aliyun/learning/service-core.mjs`
2. `chat-cloudflare/public/learning/course-progression.mjs`
3. `chat-cloudflare/public/learning/app.js`

修复普通学生公共课程进度被未选项目阻断、提交回执丢失并刷新后重复提交、取消切换样例后标签不一致，以及高级课程重复显示练习区。保留每学期一个项目的选课规则、真实完成记录、教师验收边界、点评配额及原 Python 运行器。

PR #5 合并到既有 `codex/learning-runtime-feedback-20261012` 基线分支。未合并旧仓库主分支，未执行全站自动部署；`chat-full-deploy.paused` 保护保持原状。

## 发布前验证

- 核对原生产目录 1,235 个普通文件及目录内符号链接，候选只有上述三个文件的内容变化。
- 所有补丁源文件、结果文件和 Pyodide 库 SHA-256 校验通过。
- 三文件语法检查通过；补丁检查、应用与重复检查通过。
- 候选保留原文件权限和逐路径属主。以 `originmind-chat` 实际服务账户运行 **67 项测试，67 通过、0 失败**，详见 `evidence/server-acceptance-67.log`。
- 67 项包含 22 章隔离保存生命周期、普通学生顺序与项目选课、提交丢回执并刷新后的幂等重试、样例取消/自定义输入、练习区去重、限额提示，以及 15 项实际 Pyodide 课程运行和 3 项运行环境下载故障。
- 生产课程 SQLite 在线一致性备份并通过 quick_check；备份保持仅管理员可读。
- 持有既有发布锁后，再次检查活动版本及全部原文件哈希；原子切换 `chat-current`，重启课程服务。本地课程入口返回 200，服务 active。

## 发布后验证

- 两个 HTTPS 入口及 app.js、进度模块、runner.html、runner.js、点评提示模块共 12 项读取通过。资源内容与候选相符；官网既有路径改写、HTML 的既有 orientation-entry 注入在比对中明确规范化。
- 桌面浏览器：Python 速度—时间—距离练习实际运行成功，输出 `{"distance_m": 2.0}`，公开检查 **13/13 通过**；随后恢复原编辑内容，没有保存到账号或提交新作业。
- 桌面浏览器：使用键盘切换至零秒样例并取消，选择恢复“默认样例”，实际输入仍为 4 秒，二者一致。
- 桌面浏览器：ROS 2 与机器人基础的“方法与实践”和配套任务单只显示一份，编辑器保持可用。
- 新手村历史仍显示“作业已保存，AI 点评已完成。正式验收由教师确认。”；项目六既有记录仍显示“作业已保存，等待 AI 点评。无需重复提交。”，未重新提交或触发点评。
- Python iframe 保持 `sandbox="allow-scripts"`，未新增 `allow-same-origin`。
- 与发布前数据库备份逐行比对：98 条提交、37 条草稿、14 条新手直通运行记录、5 条巡检运行记录及 1 条既有访问授权均保持不变。无新增生产测试提交，无数据库迁移，未修改教师验收。

普通学生解锁和丢回执后的重复提交由生产副本中的真实 SQLite 服务与实际界面函数测试验证；本轮没有在真实学生账户中伪造提交或解锁记录来替代测试。

## 尚未关闭的验收项

真实手机/移动视口与软键盘、真实浏览器受控弱网与断网恢复仍未完成；受控 VM 下载故障不等于这些验收。普通学生完整浏览器流程、真实 AI 点评质量及项目六/割草待点评记录仍需后续核验。本轮没有重跑全部真实 Git、ROS2 或实体机器人项目。

本次发布关闭的是四项定向软件缺陷，**不代表全部课程已经完成全场景实际操作验收**。

## 回退

本次不涉及数据库迁移。必要时先取得发布锁并核对当前版本，将 `/opt/omindos-deploy/chat-current` 原子恢复到 `/opt/omindos-deploy/releases/chat-learning-runtime-feedback-20261012-v1`，再重启 `originmind-chat`，核对服务和两个 HTTPS 入口。

课程备份：`/opt/omindos-deploy/backups/learning-full-acceptance-20261012-before.sqlite`。常规代码回退不还原数据库，以保留发布后可能产生的新提交。
