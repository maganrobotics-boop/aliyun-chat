# 课程运行恢复与提交状态修复

当前线上课程使用 `chat-student-project-release-20261011-v6` 及其此前的课程补丁链。仓库主分支并不包含完整线上课程源码，因此本次只提供基于实际运行文件的定向补丁。**不要用旧仓库检出目录覆盖线上，也不要通过合并主分支触发整站自动部署。**

## 修复行为

- 新手村及进阶课程共用的 Python 运行器：在初始化前完整下载并检查固定版本的标准库和 WASM 文件，避免 Pyodide 吞掉下载错误后出现 `No module named encodings` 或持续等待。初始化失败最多换一个 Worker、重新读取缓存恢复一次，每次上限 45 秒。
- 执行学生代码后不自动重跑。停止、离开页面、过期 Worker 回调不会触发恢复。两个课程界面的代码执行限制仍为 10 秒；100 秒的父级兜底只覆盖最多两次环境初始化。
- 新手村和进阶课程的历史、点评成功、等待、失败和登录失效提示均明确区分“作业已保存”和“AI 点评状态”。显示提交编号，并说明无需重复提交；正式验收仍由教师确认。
- 每小时 12 次点评额度用完时，服务器返回已保存的原提交、`review_rate_limited`、剩余秒数以及 `Retry-After`。刷新历史仍可看到状态；额度恢复后重试同一提交即可。每小时 40 次提交额度用完则明确显示“本次尚未提交”。

不修改配额、账号权限、NDA、教师验收、学生数据或数据库结构。沙箱继续为不带 `allow-same-origin` 的 iframe，CSP 和运行资源域保持不变。

## 应用与验证

在当前发布目录的**隔离副本**上应用：

```sh
python3 patches/learning-runtime-feedback-20261012/apply.py /path/to/copied-current-release --check
python3 patches/learning-runtime-feedback-20261012/apply.py /path/to/copied-current-release
node --test patches/learning-runtime-feedback-20261012/tests/*.test.mjs
LEARNING_CANDIDATE_ROOT=/path/to/copied-current-release node --test patches/learning-runtime-feedback-20261012/integration/*.test.mjs
cd /path/to/copied-current-release
node --check chat-cloudflare/public/learning/runner.js
node --check chat-cloudflare/public/learning/app.js
node --check chat-cloudflare/public/learning/advanced-workspace.mjs
node --check aliyun/learning/service-core.mjs
node --test tests/learning-service.test.mjs
```

要求 Node.js 22.13 或更高版本。补丁脚本在写入前核对全部源文件与运行文件 SHA-256；不一致时停止，不能跳过校验。重复应用无副作用。脚本拒绝修改当前活动发布目录，不包含重启或切换线上版本的操作。`changes.diff` 供审查，`manifest.json` 和 `modules/` 是实际应用内容。

## 本次验证与限制

- 12 项运行器生命周期及状态文案单元测试通过。
- 3 项真实内存 SQLite 服务集成测试通过：点评限额、刷新与下一小时恢复；提交限额不误报成功；点评服务失败后保留提交并重试。
- 1 项真实 Pyodide WASM/标准库测试通过：加载 `encodings`、`math`、`json` 并执行 Python，代码异常保持执行阶段且只运行一次。使用 VM 模拟 Worker 的 Web API，并非浏览器/CSP 验证。
- 当前发布版本原有的 6 项课程服务回归通过，覆盖身份、NDA、来源限制、草稿版本、提交幂等、归属隔离及沙箱响应头。
- 源码语法检查通过。实际浏览器无法访问本地隔离预览（连接被拒绝），因此本次未完成浏览器端界面、真实 CSP、手机或弱网回归；没有将这些项目记为通过。

**尚未部署。** 上线前需在获准的可访问测试环境补做正常运行、加载中停止、断网后恢复、无限循环 10 秒终止，以及两个课程界面的保存成功/点评限额/刷新历史验证。部署应基于当时当前发布目录重新核对哈希，保留旧 symlink 目标并用原版本回退；本补丁没有数据库迁移。发布需获得明确授权。
