"use strict";

// Retire the old course entry without changing onboarding routes.
if (["/newbie-village", "/newbie-village/", "/newbie-village.html"].includes(window.location.pathname)
    && window.location.hash === "#courses") {
  window.location.replace("/learning");
}

const directionLabels = Object.freeze({
  undecided: "待选择",
  perception: "感知",
  navigation: "导航",
  control: "控制",
  mechanics: "机械",
  ai: "AI",
});

const statusLabels = Object.freeze({
  not_started: "未开始",
  in_progress: "进行中",
  completed: "已记录完成",
});

function nextTaskLabel(tasks) {
  if (!tasks.length) return "暂无任务";
  const pending = tasks.filter((task) => task.status !== "completed");
  if (!pending.length) return "全部完成";
  return pending.find((task) => task.unlocked)?.title || "等待解锁";
}

const LOCAL_GUEST_KEY = "originmind-newbie-guest-v1";
const GUEST_EMAIL = "guest@originmind.local";
const COURSE_LESSONS = Object.freeze(Object.fromEntries(
  ["registration", "toolkit", "git-basics", "python-basics", "ros2-simulation", "mini-project", "graduation"].map((id) => {
    const base = id === "python-basics" ? "/assets/newbie-python-v5" : `/assets/newbie-course-v5/${id}`;
    return [id, Object.freeze({ url: `${base}/index.html`, zip: `${base}/${id === "python-basics" ? "python-log-lab" : "lesson"}.zip` })];
  }),
));
const LOCAL_AGREEMENT = Object.freeze({
  version: "2026-09-25-v2",
  title: "OriginMind × ARTS Robotics 新手村保密协议",
  effectiveDate: "2026-09-25",
  introduction: "为保护实验室成员、合作方和项目资料，在进入新手村并接触学习任务前，请阅读并同意以下保密约定。",
  privacyNotice: "免登录访问模式下，签署记录暂存在本机浏览器；正式加入项目或领取权限时，实验室可要求补充实名信息并归档到 OA。",
  clauses: [
    {
      title: "一、保密信息范围",
      text: "保密信息包括通过新手村、实验室成员或项目协作接触到的未公开代码、数据、模型、设计、文档、实验记录、账号信息、会议内容，以及其他已标注或依其性质应当保密的信息。",
    },
    {
      title: "二、使用与保护义务",
      text: "保密信息仅可用于获准的新手村学习和实验室任务；未经书面许可，不得向无关人员披露、复制到非授权平台、公开发布或用于其他目的。应妥善保管账号和资料，发现误传、泄露或异常访问时应立即报告。",
    },
    {
      title: "三、不属于保密信息的情形",
      text: "能够证明在接收前已合法知悉、并非因违反本协议而公开、从有权披露的第三方合法取得、独立开发形成，或已取得实验室书面公开许可的信息，不受本协议限制。",
    },
    {
      title: "四、保密期限与资料处理",
      text: "保密义务自签署时起生效，持续至相关信息依法公开或实验室书面解除保密要求。任务结束、退出项目或收到要求时，应停止使用并按要求归还或删除相关资料。",
    },
    {
      title: "五、违规处理",
      text: "违反本协议可能导致新手村或项目权限暂停、任务资格取消，并应按适用规则和法律承担相应责任。涉及第三方权益或安全事件时，应配合采取补救措施。",
    },
  ],
});
const LOCAL_TASKS = Object.freeze([
  {
    "id": "registration",
    "index": 1,
    "title": "入村登记",
    "stage": "身份与方向",
    "summary": "用虚构示例和个人模板，把兴趣变成一周可执行计划。",
    "goal": "写清当前基础、可投入时间、具体成果与证据；能解释任务取舍。",
    "steps": [
      "在线查看示例、个人计划模板和提交单；尚未安装 Python 可先按人工清单填写。",
      "阅读 4 小时示例，核对任务总量和证据。",
      "填写自己的计划，把 8 小时版本缩减为 4 小时版本并解释取舍。",
      "对照信息、时间、目标、调整四项标准；可选运行 check_profile.py。",
      "保存两版计划和复盘，返回本关记录证据。"
    ],
    "examples": [
      "结构检查不验证身份，也不自动分配项目。",
      "“完成日志分析并解释 10 m 路程”比“学会 Python”更便于验收。",
      "公开课程阅读无需先签协议；个人计划不应包含证件或账号密码。"
    ],
    "taPrompts": [
      "教学虚构示例：每周可用4小时，原8小时计划为环境安装2小时、Git练习2小时、Python日志分析4小时。目标是本周交付可复现的日志分析。请提示哪些任务可缩小或推迟，以及如何保留可验收证据；建议不要冒充我的实际计划。",
      "教学虚构示例：目标A是‘学会Python’，目标B是‘运行日志分析并解释为什么路程10m、位移0m，保留命令和输出’。请判断哪一个有可观察结果，说明理由，不额外添加教材没有的格式要求。"
    ],
    "deliverables": [
      "个人计划及每周时长",
      "8 小时到 4 小时的调整前后对照",
      "验收清单与取舍说明、一个需要帮助的问题"
    ]
  },
  {
    "id": "toolkit",
    "index": 2,
    "title": "装备铺",
    "stage": "开发环境",
    "summary": "运行并修改 hello.py，用检查程序核对 Python、Git 和学习目录。",
    "goal": "在自己的电脑运行程序，能定位一次语法错误并记录可复现环境。",
    "steps": [
      "在线查看 hello.py、环境检查和提交单；准备 Python、Git、编辑器。",
      "运行示例，核对问候语和 4 小时输出。",
      "建立 code/data/evidence/notes，修改昵称和小时数；先预测再运行。",
      "检查环境 PASS；制造并修复一次 SyntaxError，记录行号和原因。",
      "提交修改代码、输出、环境报告与排错说明。"
    ],
    "examples": [
      "本关无需先装 ROS2；手机可阅读，运行在电脑完成。",
      "版本号因电脑而异，验收核对工具可用性而非相同截图。",
      "环境检查不会自动安装软件，也不代表后续课程完成。"
    ],
    "taPrompts": [
      "教学虚构示例：我在/home/learner/lab目录执行python hello.py，终端报can't open file '/home/learner/lab/hello.py': [Errno 2] No such file or directory；实际文件在/home/learner/lab/code/hello.py。请先判断是路径、语法还是解释器问题，提示下一步检查，不假定是权限或缺包。",
      "教学虚构示例：根目录保留原hello.py，我已把code/hello.py的NAME保存为小明、HOURS保存为2.5，但在根目录执行python hello.py仍显示学习者和4小时。请提示我应先检查哪个运行路径。"
    ],
    "deliverables": [
      "修改后的 code/hello.py、预测与实际输出",
      "环境报告与四目录说明",
      "一次错误定位和修复；操作系统与工具版本"
    ]
  },
  {
    "id": "git-basics",
    "index": 3,
    "title": "Git 训练场",
    "stage": "协作基础",
    "summary": "先观察可运行的提交示例，再独立完成三次内容提交和分支合并。",
    "goal": "用可读历史说明每一次修改，区分工作区、暂存区和提交记录。",
    "steps": [
      "在线查看 README 模板、示例生成器、仓库检查和提交单。",
      "运行 make_demo.py，观察 3 次内容提交和 1 次合并；示例不作为个人作业。",
      "新建个人仓库，分三次补充目标、方向和复盘，再合并 practice。",
      "用 check_repo.py 检查历史与工作区；另做 improvement 分支变化练习。",
      "提交 README、图形日志、差异与复盘。"
    ],
    "examples": [
      "仅需本地 Git，不要求公开仓库。",
      "本题用 merge --no-ff 保留合并证据；哈希无需与示例一致。",
      "add 不等于 commit，commit 不等于 push。"
    ],
    "taPrompts": [
      "教学虚构示例：在my-repo内修改README.md后执行git add README.md，接着再次修改并保存同一文件但未add。git status --short输出MM README.md。请解释两列M分别对应哪一部分，并提示如何分别查看两份差异，不执行提交或丢弃改动。",
      "教学虚构示例：当前分支main，执行git merge --no-ff practice后显示Merge made by the 'ort' strategy，git status --short无输出。仅凭这些信息能否确认提交内容正确？还应怎样检查practice已进入main历史及具体差异？"
    ],
    "deliverables": [
      "至少三次实际内容提交和合并记录",
      "README、最终哈希与干净工作区结果",
      "自主分支改动前后对照与至少约 100 字复盘"
    ]
  },
  {
    id: "python-basics",
    index: 4,
    title: "Python 训练场",
    stage: "编程基础",
    summary: "用模拟巡检日志计算路程、速率和电量变化；含完整教程、数据、代码模板与自检。",
    goal: "在 60–90 分钟内完成一次可复现的日志分析，能区分路程和位移，定位可疑区间并解释结果。",
    steps: [
      "打开完整实训，在线查看本课材料；仅需 Python 3，无第三方依赖。",
      "运行 analyze.py 和参考自检，核对 21 个采样点、10 m 路程、0.5 m/s 平均速率。",
      "学习相邻点距离、时间间隔和电量百分点，完成 exercise.py 的三个 TODO。",
      "运行 python check_work.py 检查自己的实现，再分析 position_jump.csv 中的 1–2 s 位置跳变。",
      "构造一份静止、斜线或非等间隔数据，先手算再运行，填写提交单。",
    ],
    examples: [
      "本课数据均为教学模拟，不是真实实验记录。完整教材含命令、标准输出和报错排查。",
      "正方形路径回到起点，位移为 0 m，累计路程仍为 10 m；电量从 90% 到 85% 是下降 5 个百分点。",
      "运行参考程序不等于完成个人练习；本机标记和十四项自检也不等于教师审核通过。",
    ],
    taPrompts: [
      "课程标准日志回到起点，位移为0m而路程为10m。请用相邻位置距离和起终点距离解释差别，不把数据说成真机实测。",
      "教学模拟三点：time为0、1、4秒，x为0、1、2米，y均0。我把两段速率直接平均得到约0.667m/s，标准为0.5m/s。请提示我检查哪一步，并说明为什么这个例子能看出错误。",
      "课程position_jump.csv的1–2s分段显示10m/s。请区分日志中已知数值和故障原因猜测，并提示还需哪些证据；不能直接断定机器人真实速度或故障。",
    ],
    deliverables: ["独立完成的 exercise.py、运行命令和十四项自检输出", "正常与异常日志的分析结果；标准指标误差不超过 0.001", "一份自建数据及手算值与运行值对照", "填写 submission.md，解释四个问题并记录复盘与助教帮助"],
  },
  {
    "id": "ros2-simulation",
    "index": 5,
    "title": "ROS2 仿真场",
    "stage": "机器人基础",
    "summary": "控制 turtlesim 走圆并记录 pose，改半径后对照理论与实录。",
    "goal": "理解发布、订阅和状态反馈，完成可复现的 ROS2 圆形轨迹实验。",
    "steps": [
      "在线查看参数、发布订阅程序、离线轨迹程序与检查器；准备 Ubuntu 24.04 + Jazzy。",
      "先做离线理论预检，再在独立命名空间启动 turtlesim，核对节点和话题。",
      "运行 run_ros.py 保存真实 pose；把线速度从 1 改到 0.5 后重跑。",
      "对照半径、时长、路程、闭合误差和轨迹外接框；再做反向转圈实验。",
      "提交真实 CSV、截图、参数、代码解释与误差复盘。"
    ],
    "examples": [
      "原始圆理论半径 1、路程约 6.283；半速圆半径 0.5、路程约 3.142。",
      "坐标使用 turtlesim 仿真单位，不当作真实米制测量。",
      "离线轨迹预检不等于真实 ROS2 实验；环境未就绪时保留进行中。"
    ],
    "taPrompts": [
      "教学虚构示例：Ubuntu24.04+Jazzy；终端A已source并设ROS_DOMAIN_ID=42，以/newbie_lab命名空间启动turtlesim；终端B已source但ROS_DOMAIN_ID=7，ros2 node list --no-daemon --spin-time 3为空。请提示最先核对什么，说明domain与namespace的区别；42仅本例分组编号，不作固定验收条件。",
      "本关原LINEAR=1.0、ANGULAR=1.0，将LINEAR改为0.5而角速度和一圈时长不变。请解释半径、周期和理论路程如何变化，明确这是turtlesim仿真单位。"
    ],
    "deliverables": [
      "修改前后真实 CSV 与轨迹检查输出",
      "节点/话题、海龟轨迹截图或视频",
      "motion.py 修改、四处发布订阅代码解释与自主实验",
      "理论/实际对照、误差分析或未完成阻塞"
    ]
  },
  {
    "id": "mini-project",
    "index": 6,
    "title": "任务大厅",
    "stage": "巡检路线项目",
    "summary": "在栅格地图上实现最短路径，检验可达、绕行和无解。",
    "goal": "把需求写成项目卡，用代码、测试和变化地图交付可复现结果。",
    "steps": [
      "在线查看地图、参考搜索器、练习模板、六项自检与项目卡。",
      "运行参考程序：课程地图 10 步，隔断地图无解。",
      "独立完成 BFS 的三个 TODO，说明队列和 parents 的作用。",
      "运行六项个人自检；构造中心障碍绕行与整列封路的地图，先预测再验证。",
      "提交代码、地图、项目卡、结果与适用边界。"
    ],
    "examples": [
      "只允许四邻域、每步代价 1；坐标为 [行, 列]。",
      "最短路径不唯一，合法且达到最短步数即可。",
      "不处理机器人尺寸或运动控制，不能直接部署到真机。"
    ],
    "taPrompts": [
      "教学虚构BFS状态：3×3地图grid=['...','.#.','...']，坐标[行,列]从0开始；起点[1,0]、终点[1,2]，当前队列仅[[1,0]]，已访问只有[1,0]。邻居按上、下、左、右检查并在入队时标记。请只提示下一次出队格子、合法新入队格子及新队列，不代写完整函数。",
      "本题只允许四邻域移动，每步代价1。为什么BFS能保证最少步数？如果每格代价不同，还能直接保证总代价最小吗？请区分当前任务和拓展讨论。"
    ],
    "deliverables": [
      "项目卡、个人 exercise.py 与六项个人自检",
      "课程地图 10 步和隔断地图无解结果",
      "两份变化地图、预测/实际对照",
      "队列变化解释、复盘和真机应用缺口"
    ]
  },
  {
    "id": "graduation",
    "index": 7,
    "title": "出村考核",
    "stage": "证据交付",
    "summary": "按清单整理六关真实成果，检查文件并生成可复现证据包。",
    "goal": "让另一个人能看懂改动、找到证据、复现结果，并知道下一阶段计划。",
    "steps": [
      "在线查看虚构样例、个人 manifest 模板、检查打包程序和提交单。",
      "运行样例检查，理解命令、预期、实际、改动、解释和文件的对应关系。",
      "用自己的六关证据填写清单；未完成的关卡如实保留进行中。",
      "检查并打包；做一次文件缺失与恢复实验，核对版本和文件哈希。",
      "提交证据包、一页反思、下一阶段计划与 3 分钟演示。"
    ],
    "examples": [
      "示例标为 DEMO_ONLY，不能作为个人成果。",
      "结构检查只检查字段和文件，不能代替教师内容验收。",
      "查看打包程序不会自动上传；本机标记不授予项目或真机权限。"
    ],
    "taPrompts": [
      "教学虚构清单片段：manifest.json位于my-evidence；Python项files=['python/exercise.py','python/result.txt']；目录清单只有python/exercise.py。ROS2项status='completed'，actual='仅运行simulate.py生成离线CSV'。请仅据这些信息指出明确缺失和状态不符；这是片段，不推断其他四关，也不要补造文件、签名或真实实验。",
      "教学虚构3分钟演示草案：30秒说目标、90秒对比代码修改前后输出、60秒说明一次文件缺失及恢复和下一步。请按本关演示要求指出是否覆盖必要内容，将额外改进明确写成建议，不声称我已完成演示。"
    ],
    "deliverables": [
      "六关真实证据清单与版本化证据包",
      "完整性检查及文件缺失/恢复记录",
      "一页反思、下一步计划和演示提纲",
      "参考代码与助教帮助说明"
    ]
  },
]);

const state = {
  dashboard: null,
  localGuest: false,
  currentTaskId: "",
  activeView: "learning",
};

const elements = {
  loggedOut: document.querySelector(".logged-out"),
  agreementGate: document.querySelector(".agreement-gate"),
  agreementForm: document.querySelector(".agreement-form"),
  agreementStatus: document.querySelector(".agreement-status"),
  agreementReview: document.querySelector(".agreement-review"),
  agreementNotice: document.querySelector(".agreement-notice"),
  agreementNoticeText: document.querySelector(".agreement-notice-text"),
  agreementOpen: document.querySelector(".agreement-open"),
  dashboard: document.querySelector(".dashboard"),
  tasksView: document.querySelector(".tasks-view"),
  profileView: document.querySelector(".profile-view"),
  taskGrid: document.querySelector(".task-grid"),
  userChip: document.querySelector(".user-chip"),
  logout: document.querySelector(".logout-trigger"),
  loginDialog: document.querySelector(".login-dialog"),
  loginForm: document.querySelector(".login-form"),
  email: document.querySelector(".email-input"),
  code: document.querySelector(".code-input"),
  codeButton: document.querySelector(".code-button"),
  loginStatus: document.querySelector(".login-status"),
  profileForm: document.querySelector(".profile-form"),
  profileStatus: document.querySelector(".profile-form .form-status"),
  syncStatus: document.querySelector(".sync-status"),
  taskDialog: document.querySelector(".task-dialog"),
  taskEvidence: document.querySelector(".task-evidence"),
  taskStatus: document.querySelector(".task-status"),
  toast: document.querySelector(".toast"),
};
let toastTimer;

function readLocalGuest() {
  try {
    return JSON.parse(localStorage.getItem(LOCAL_GUEST_KEY) || "{}");
  } catch {
    return {};
  }
}

function writeLocalGuest(value) {
  try {
    localStorage.setItem(LOCAL_GUEST_KEY, JSON.stringify(value));
    return true;
  } catch {
    showToast("浏览器无法保存，请允许网站存储后重试。当前记录未保存。");
    return false;
  }
}

function localDashboard() {
  const saved = readLocalGuest();
  const now = Date.now();
  const agreementAccepted = Boolean(saved.agreement?.approved);
  const progressByTask = new Map(Object.entries(saved.tasks || {}));
  const tasks = LOCAL_TASKS.map((task) => {
    const progress = progressByTask.get(task.id) || {};
    const status = progress.status || "not_started";
    const result = {
      ...task,
      status,
      evidence: progress.evidence || "",
      updatedAt: progress.updatedAt || null,
      unlocked: true,
    };
    return result;
  });
  const profile = {
    displayName: saved.profile?.displayName || "访客学生",
    grade: saved.profile?.grade || "",
    major: saved.profile?.major || "",
    direction: saved.profile?.direction || "undecided",
    bio: saved.profile?.bio || "",
    updatedAt: saved.profile?.updatedAt || now,
  };
  return {
    user: {
      email: GUEST_EMAIL,
      role: "guest",
      roleLabel: "免登录访客",
    },
    agreement: {
      ...LOCAL_AGREEMENT,
      accepted: agreementAccepted,
      approved: agreementAccepted,
      reviewStatus: agreementAccepted ? "approved" : "unsigned",
      signerName: saved.agreement?.signerName || "",
      acceptedAt: saved.agreement?.acceptedAt || null,
      reviewNote: saved.agreement?.reviewNote || "",
    },
    profile,
    tasks,
    progress: {
      completed: tasks.filter((task) => task.status === "completed").length,
      total: LOCAL_TASKS.length,
    },
  };
}

function enterLocalGuestMode(message) {
  state.localGuest = true;
  state.dashboard = localDashboard();
  setProfileStatus("");
  setSyncStatus("");
  renderDashboard();
  if (message) showToast(message);
}

async function requestJson(path, options = {}) {
  const response = await fetch(path, {
    credentials: "same-origin",
    headers: {
      accept: "application/json",
      ...(options.body ? { "content-type": "application/json" } : {}),
      ...(options.headers || {}),
    },
    ...options,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(payload.error || "服务暂时不可用，请稍后重试。");
    error.status = response.status;
    throw error;
  }
  return payload;
}

function showToast(message) {
  elements.toast.textContent = message;
  elements.toast.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => elements.toast.classList.remove("show"), 2200);
}

function setLoginStatus(message, error = false) {
  elements.loginStatus.textContent = message || "";
  elements.loginStatus.style.color = error ? "#b42318" : "#68707c";
}

function setProfileStatus(message, error = false) {
  elements.profileStatus.textContent = message || "";
  elements.profileStatus.style.color = error ? "#b42318" : "#68707c";
}

function setSyncStatus(message, error = false) {
  elements.syncStatus.textContent = message || "";
  elements.syncStatus.style.color = error ? "#b42318" : "#68707c";
}

function setTaskStatus(message, error = false) {
  elements.taskStatus.textContent = message || "";
  elements.taskStatus.style.color = error ? "#b42318" : "#68707c";
}

const WORKSPACE_VIEWS = Object.freeze(["learning", "tutor", "progress", "profile", "courses", "practice", "submissions", "resources"]);
const WORKSPACE_HASH_ALIASES = Object.freeze({ learning: "courses", tasks: "courses", passes: "progress", my: "profile" });

function workspaceViewFromHash(hash) {
  const key = String(hash || "").replace(/^#/, "");
  return WORKSPACE_HASH_ALIASES[key] || (WORKSPACE_VIEWS.includes(key) ? key : "courses");
}

function workspaceButton(label, action) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "secondary";
  button.textContent = label;
  button.addEventListener("click", action);
  return button;
}

function workspaceLink(label, href, download = false) {
  const anchor = document.createElement("a");
  anchor.textContent = label;
  anchor.href = href;
  // Course resources are read online.
  return anchor;
}

function workspaceCard(task, text) {
  const card = document.createElement("article");
  card.className = "workspace-card";
  const stage = document.createElement("div");
  stage.className = "eyebrow";
  stage.textContent = `第 ${task.index} 关 · ${task.stage}`;
  const heading = document.createElement("h2");
  heading.textContent = task.title;
  const description = document.createElement("p");
  description.textContent = text;
  const actions = document.createElement("div");
  actions.className = "workspace-actions";
  card.append(stage, heading, description, actions);
  return { card, actions };
}

function renderWorkspaceTutor() {
  const select = document.querySelector(".workspace-tutor-course");
  const task = state.dashboard?.tasks.find((item) => item.id === select.value);
  if (!task) return;
  document.querySelector(".workspace-tutor-link").href = `/?ta=1&course=${encodeURIComponent(task.id)}`;
  const prompts = (task.taPrompts || []).map((prompt, hint) => {
    const { card, actions } = workspaceCard(task, prompt);
    card.querySelector("h2").textContent = `问题 ${hint + 1}`;
    actions.append(workspaceLink("带着这个问题问助教", `/?ta=1&course=${encodeURIComponent(task.id)}&hint=${hint}`));
    return card;
  });
  document.querySelector(".workspace-tutor-prompts").replaceChildren(...prompts);
}

function renderWorkspaceViews(data) {
  const tasks = data.tasks || [];
  const nextTask = tasks.find((task) => task.status === "in_progress") || tasks.find((task) => task.status !== "completed");
  document.querySelector(".workspace-total").textContent = String(tasks.length);
  document.querySelector(".workspace-completed").textContent = String(tasks.filter((task) => task.status === "completed").length);
  document.querySelector(".workspace-in-progress").textContent = String(tasks.filter((task) => task.status === "in_progress").length);
  document.querySelector(".workspace-next-title").textContent = nextTask?.title || "回看学习成果";
  document.querySelector(".workspace-next-note").textContent = nextTask
    ? "公开课程随时可学；正式提交遵循账号准入和前置任务要求。"
    : "全部关卡已有完成记录，可继续检查证据和复盘。";
  const modeNote = state.localGuest
    ? "当前为访客学习。进度仅保存在本机浏览器；本机完成标记不等于正式提交或审核通过。"
    : "当前显示此账号保存的学习记录。完成标记不代表自动获得项目、真机或内部资料权限。";
  document.querySelector(".workspace-mode-note").textContent = modeNote;
  document.querySelector(".workspace-progress-note").textContent = modeNote;
  document.querySelector(".workspace-submission-note").textContent = state.localGuest
    ? "可以先在任务表单保存本机证据。正式提交需登录，并完成协议归档和前置任务。"
    : "正式提交仍需协议归档与前置任务。本页不会自动审批或改变已有审核结果。";
  document.querySelector(".workspace-account-note").textContent = state.localGuest
    ? "访客资料保存在当前浏览器。登录后可查看账号学习记录，并按原有流程同步本机进度。"
    : `已登录：${data.user.email}。学习资料保存在 Chat 系统，协议状态以服务器记录为准。`;
  document.querySelector(".workspace-login").hidden = !state.localGuest;
  document.querySelector(".workspace-sync").hidden = state.localGuest;
  document.querySelector(".workspace-logout").hidden = state.localGuest;

  const select = document.querySelector(".workspace-tutor-course");
  const selected = select.value || nextTask?.id;
  select.replaceChildren(...tasks.map((task) => {
    const option = document.createElement("option");
    option.value = task.id;
    option.textContent = `第 ${task.index} 关 · ${task.title}`;
    return option;
  }));
  if (tasks.some((task) => task.id === selected)) select.value = selected;
  renderWorkspaceTutor();

  document.querySelector(".workspace-practice-grid").replaceChildren(...tasks.map((task) => {
    const { card, actions } = workspaceCard(task, task.goal || task.summary);
    const lesson = COURSE_LESSONS[task.id];
    if (lesson) {
      actions.append(workspaceLink("打开实训步骤", lesson.url));
      actions.append(workspaceLink("在线查看材料", lesson.url.replace("index.html", "materials.html")));
    }
    actions.append(workspaceButton("查看任务与验收要求", () => openTask(task.id)));
    return card;
  }));
  document.querySelector(".workspace-submission-grid").replaceChildren(...tasks.map((task) => {
    const evidence = task.evidence ? `已保存证据：${task.evidence}` : "尚无保存的证据。完成实训后，记录代码、结果与复盘。";
    const { card, actions } = workspaceCard(task, evidence);
    const status = document.createElement("span");
    status.className = `status ${statusClass(task.status)}`;
    status.textContent = (state.localGuest ? "本机 · " : "账号记录 · ") + (statusLabels[task.status] || "待核对");
    card.querySelector("h2").after(status);
    actions.append(workspaceButton(task.evidence ? "查看或补充证据" : "填写任务证据", () => openTask(task.id)));
    return card;
  }));
  document.querySelector(".workspace-resource-grid").replaceChildren(...tasks.flatMap((task) => {
    const lesson = COURSE_LESSONS[task.id];
    if (!lesson) return [];
    const { card, actions } = workspaceCard(task, task.summary);
    actions.append(workspaceLink("阅读教程", lesson.url), workspaceLink("在线查看材料", lesson.url.replace("index.html", "materials.html")));
    return [card];
  }));
  document.querySelector(".workspace-progress-list").replaceChildren(...tasks.map((task) => {
    const row = document.createElement("li");
    row.className = "workspace-progress-item";
    const index = document.createElement("span");
    index.className = "task-index";
    index.textContent = String(task.index);
    const content = document.createElement("div");
    const title = document.createElement("h2");
    title.textContent = task.title;
    const status = document.createElement("span");
    status.className = `status ${statusClass(task.status)}`;
    status.textContent = statusLabels[task.status] || "待核对";
    title.append(status);
    const detail = document.createElement("p");
    const savedAt = task.updatedAt && Number.isFinite(new Date(task.updatedAt).getTime()) ? formatTime(task.updatedAt) : "";
    detail.textContent = `${task.evidence ? "已保存证据" : "尚无保存证据"}${savedAt ? ` · ${savedAt}` : ""}`;
    content.append(title, detail);
    row.append(index, content, workspaceButton("查看记录", () => openTask(task.id)));
    return row;
  }));
}

function routeWorkspaceHash(focus = false) {
  if (!state.dashboard) return;
  const requestedTask = state.dashboard.tasks.find((task) => location.hash === `#${task.id}`);
  const view = requestedTask ? "courses" : workspaceViewFromHash(location.hash);
  if (!requestedTask && elements.taskDialog.open) elements.taskDialog.close();
  switchView(view, true, focus);
  if (requestedTask && !elements.taskDialog.open) openTask(requestedTask.id);
  if (location.hash === "#passes") requestAnimationFrame(() => document.getElementById("passes")?.scrollIntoView({ block: "start" }));
}

function switchView(view, preserveHash = false, focus = false) {
  if (view === "tutor") { location.assign("/?ta=1"); return; }
  state.activeView = WORKSPACE_HASH_ALIASES[view] || (WORKSPACE_VIEWS.includes(view) ? view : "courses");
  // Navigation never clears task evidence, signs an agreement, or writes progress.
  if (state.dashboard) {
    elements.dashboard.hidden = false;
    elements.agreementGate.hidden = true;
  }
  document.querySelectorAll("[data-workspace-view]").forEach((panel) => {
    panel.hidden = panel.dataset.workspaceView !== state.activeView;
  });
  document.querySelectorAll(".workspace-nav-button").forEach((button) => {
    const active = button.dataset.view === state.activeView;
    button.classList.toggle("active", active);
    button.disabled = false;
    if (active) button.setAttribute("aria-current", "page");
    else button.removeAttribute("aria-current");
  });
  const nextHash = `#${state.activeView}`;
  if (!preserveHash && location.hash !== nextHash) history.pushState(null, "", nextHash);
  if (focus) requestAnimationFrame(() => {
    const panel = document.querySelector(`[data-workspace-view="${state.activeView}"]`);
    panel?.querySelector("h1")?.focus({ preventScroll: true });
    panel?.scrollIntoView({ block: "start", behavior: "auto" });
  });
}

function statusClass(status) {
  return status === "in_progress" ? "in-progress" : status === "completed" ? "completed" : "";
}

function createTaskCard(task) {
  const article = document.createElement("article");
  article.className = `task-card${task.unlocked ? "" : " locked"}`;
  const top = document.createElement("div");
  top.className = "task-top";
  const index = document.createElement("span");
  index.className = "task-index";
  index.textContent = String(task.index);
  const status = document.createElement("span");
  status.className = `status ${statusClass(task.status)}`;
  status.textContent = task.unlocked ? statusLabels[task.status] : "正式提交待解锁";
  top.append(index, status);
  const title = document.createElement("h3");
  title.textContent = task.title;
  const stage = document.createElement("span");
  stage.className = "task-stage";
  stage.textContent = task.stage;
  const summary = document.createElement("p");
  summary.textContent = task.summary;
  const open = document.createElement("button");
  open.className = "secondary task-open";
  open.type = "button";
  open.textContent = "查看课程与任务";
  open.addEventListener("click", () => openTask(task.id));
  article.append(top, title, stage, summary, open);
  if (COURSE_LESSONS[task.id]) {
    const lesson = document.createElement("a");
    lesson.href = COURSE_LESSONS[task.id].url;
    lesson.className = "lesson-link";
    lesson.textContent = "在线教程与材料";
    article.append(lesson);
    const tutor = document.createElement("a");
    tutor.href = `/?ta=1&course=${encodeURIComponent(task.id)}`;
    tutor.className = "lesson-link";
    tutor.textContent = "问本关助教";
    article.append(tutor);
  }
  return article;
}

function fillProfile(profile) {
  for (const name of ["displayName", "grade", "major", "direction", "bio"]) {
    const field = elements.profileForm.elements.namedItem(name);
    if (field) field.value = profile[name] || (name === "direction" ? "undecided" : "");
  }
}

function formatTime(value) {
  if (!value) return "";
  return new Intl.DateTimeFormat("zh-CN", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Shanghai",
  }).format(new Date(value));
}

function renderAgreement() {
  const data = state.dashboard;
  const agreement = data?.agreement;
  if (!agreement) return;
  elements.loggedOut.hidden = true;
  elements.dashboard.hidden = true;
  elements.agreementGate.hidden = false;
  elements.userChip.hidden = false;
  elements.logout.hidden = false;
  document.querySelectorAll(".login-trigger").forEach((button) => { button.hidden = true; });
  document.querySelectorAll(".nav-button").forEach((button) => { button.disabled = true; });
  elements.userChip.textContent = `${data.user.roleLabel} · ${data.user.email}`;
  document.querySelector(".agreement-version").textContent = `版本 ${agreement.version}`;
  document.querySelector(".agreement-effective").textContent = `生效日期 ${agreement.effectiveDate}`;
  document.querySelector(".agreement-email").textContent = `签署账号 ${data.user.email}`;
  document.querySelector(".agreement-introduction").textContent = agreement.introduction;
  document.querySelector(".privacy-notice").textContent = agreement.privacyNotice;
  document.querySelector(".agreement-clauses").replaceChildren(...agreement.clauses.map((clause) => {
    const section = document.createElement("section");
    section.className = "agreement-clause";
    const title = document.createElement("h2");
    title.textContent = clause.title;
    const text = document.createElement("p");
    text.textContent = clause.text;
    section.append(title, text);
    return section;
  }));
  const pending = agreement.reviewStatus === "pending";
  const rejected = agreement.reviewStatus === "rejected";
  elements.agreementForm.hidden = pending;
  elements.agreementReview.hidden = !pending && !rejected;
  elements.agreementReview.className = `agreement-review${pending ? " pending" : rejected ? " rejected" : ""}`;
  if (pending || rejected) {
    elements.agreementReview.querySelector("h2").textContent = pending ? "签署记录正在自动归档" : "本次签署未完成归档";
    elements.agreementReview.querySelector(".review-summary").textContent =
      `签署人：${agreement.signerName} · 签署时间：${formatTime(agreement.acceptedAt)}`;
    elements.agreementReview.querySelector(".review-note").textContent = rejected
      ? `审核说明：${agreement.reviewNote || "请核对签署信息后重新提交。"}`
      : "公开课程可继续学习。处理完成后请刷新核对协议状态，再保存个人主页或正式提交任务。";
  }
  if (rejected) {
    const signer = elements.agreementForm.elements.namedItem("signerName");
    if (signer && !signer.value) signer.value = agreement.signerName;
  }
}

function renderDashboard() {
  const data = state.dashboard;
  if (!data) return;
  // Public course content is independent of account and agreement status.
  data.profile ||= state.localGuest ? localDashboard().profile : {
    displayName: "", grade: "", major: "", direction: "undecided", bio: "",
  };
  data.tasks = LOCAL_TASKS.map((course) => {
    const progress = (data.tasks || []).find((task) => task.id === course.id);
    return { ...course, status: progress?.status || "not_started", unlocked: Boolean(progress?.unlocked),
      evidence: progress?.evidence || "", updatedAt: progress?.updatedAt || null };
  });
  elements.loggedOut.hidden = true;
  elements.agreementGate.hidden = true;
  elements.dashboard.hidden = false;
  elements.agreementNotice.hidden = state.localGuest || Boolean(data.agreement?.approved);
  elements.agreementOpen.disabled = !data.agreement;
  const reviewStatus = data.agreement?.reviewStatus;
  elements.agreementOpen.textContent = reviewStatus === "pending" || reviewStatus === "rejected"
    ? "查看协议状态" : "查看协议";
  elements.agreementNoticeText.textContent = !data.agreement
    ? "协议状态尚未载入。保存个人主页或正式提交前，请刷新核对协议状态；公开课程仍可学习。"
    : reviewStatus === "pending"
      ? "签署记录正在处理，个人主页保存和正式提交暂未开放。可查看协议状态，并继续学习公开课程。"
      : reviewStatus === "rejected"
        ? "本次签署尚未通过，个人主页保存和正式提交暂未开放。请查看协议处理结果；公开课程仍可学习。"
        : "你已登录。公开课程可继续学习；保存个人主页或正式提交任务前，请本人阅读并签署协议，完成归档。";
  elements.syncStatus.hidden = state.localGuest;
  elements.userChip.hidden = false;
  elements.logout.hidden = state.localGuest;
  document.querySelectorAll(".login-trigger").forEach((button) => { button.hidden = !state.localGuest; });
  document.querySelector(".sync-progress").hidden = state.localGuest;
  document.querySelector(".storage-note").textContent = state.localGuest
    ? "学习进度仅保存在当前浏览器。换设备或清除浏览器数据后无法找回；正式提交需登录。"
    : "已登录。个人主页保存和进度同步需先完成协议归档；正式提交还需满足前置任务要求。";
  document.querySelectorAll(".nav-button").forEach((button) => { button.disabled = false; });
  elements.userChip.textContent = `${data.user.roleLabel} · ${data.user.email}`;

  document.querySelector(".progress-number").textContent = String(data.progress.completed);
  document.querySelector(".progress-total").textContent = String(data.progress.total);
  document.querySelector(".progress-bar").style.width = `${data.progress.total ? data.progress.completed / data.progress.total * 100 : 0}%`;
  document.querySelector(".metric-role").textContent = data.user.roleLabel;
  document.querySelector(".metric-direction").textContent = directionLabels[data.profile.direction] || "待选择";
  document.querySelector(".metric-next").textContent = !state.localGuest && !data.agreement?.approved
    ? "提交前先完成协议归档" : nextTaskLabel(data.tasks);

  elements.taskGrid.replaceChildren(...data.tasks.map(createTaskCard));
  renderWorkspaceViews(data);
  fillProfile(data.profile);
  const displayName = data.profile.displayName || data.user.email.split("@", 1)[0];
  document.querySelector(".profile-name").textContent = displayName;
  document.querySelector(".profile-email").textContent = data.user.email;
  document.querySelector(".profile-role").textContent = data.user.roleLabel;
  document.querySelector(".profile-progress").textContent = `已完成 ${data.progress.completed}/${data.progress.total}`;
  document.querySelector(".avatar").textContent = displayName.slice(0, 1).toUpperCase() || "新";
  routeWorkspaceHash();
}

function renderLoggedOut() {
  state.dashboard = null;
  elements.loggedOut.hidden = false;
  elements.agreementGate.hidden = true;
  elements.dashboard.hidden = true;
  elements.userChip.hidden = true;
  elements.logout.hidden = true;
  document.querySelectorAll(".login-trigger").forEach((button) => { button.hidden = false; });
  document.querySelectorAll(".nav-button").forEach((button) => { button.disabled = true; });
}

async function loadDashboard({ strict = false } = {}) {
  try {
    state.dashboard = await requestJson("/api/newbie/dashboard", { cache: "no-store" });
    state.localGuest = false;
    renderDashboard();
    return true;
  } catch (error) {
    if (strict) throw error;
    enterLocalGuestMode(error.status === 401 || error.status === 404
      ? "已开启免登录访问"
      : "接口暂不可用，已进入免登录模式");
    return false;
  }
}

let VILLAGE_EMAIL_LOGIN_AVAILABLE = false;
let villageLoginCheckId = 0;
const VILLAGE_EMAIL_LOGIN_UNAVAILABLE = '邮件服务尚未配置完整，暂时无法发送新验证码；已收到的有效验证码仍可验证。公开课程和本机进度可继续使用。';
async function openLogin() {
  const checkId = ++villageLoginCheckId;
  elements.taskDialog.close();
  VILLAGE_EMAIL_LOGIN_AVAILABLE = false;
  elements.codeButton.disabled = true;
  const verifyButton = document.querySelector(".verify-button");
  const loginDescription = elements.loginDialog.querySelector(".modal-head p");
  verifyButton.disabled = false;
  loginDescription.textContent = "正在检查新验证码发送服务；已收到的有效验证码仍可验证…";
  setLoginStatus("正在检查新验证码发送服务；已收到的有效验证码仍可验证…");
  elements.loginDialog.show();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  try {
    const status = await requestJson("/api/visitor/status", { cache: "no-store", signal: controller.signal });
    if (checkId !== villageLoginCheckId || !elements.loginDialog.open) return;
    VILLAGE_EMAIL_LOGIN_AVAILABLE = status.emailLoginConfigured === true;
    const message = VILLAGE_EMAIL_LOGIN_AVAILABLE
      ? "使用校内邮箱接收六位验证码，验证后可同步学习进度。"
      : VILLAGE_EMAIL_LOGIN_UNAVAILABLE;
    loginDescription.textContent = message;
    setLoginStatus(message);
  } catch {
    if (checkId !== villageLoginCheckId || !elements.loginDialog.open) return;
    VILLAGE_EMAIL_LOGIN_AVAILABLE = false;
    loginDescription.textContent = VILLAGE_EMAIL_LOGIN_UNAVAILABLE;
    setLoginStatus("暂时无法检查邮件发送服务。已收到的有效验证码仍可验证；稍后可重新打开以检查发信状态。", true);
  } finally {
    clearTimeout(timeout);
  }
  elements.codeButton.disabled = !VILLAGE_EMAIL_LOGIN_AVAILABLE;
  // Code verification does not depend on outbound email configuration.
}

async function requestCode() {
  if (!VILLAGE_EMAIL_LOGIN_AVAILABLE) { setLoginStatus(VILLAGE_EMAIL_LOGIN_UNAVAILABLE); return; }
  const email = elements.email.value.trim();
  elements.codeButton.disabled = true;
  setLoginStatus("正在发送验证码…");
  try {
    const result = await requestJson("/api/visitor/request-code", {
      method: "POST",
      body: JSON.stringify({ email }),
    });
    setLoginStatus(result.devCode ? `预览验证码：${result.devCode}` : "验证码已发送，请检查邮箱。");
    elements.code.focus();
  } catch (error) {
    setLoginStatus(error.message, true);
  } finally {
    elements.codeButton.disabled = !VILLAGE_EMAIL_LOGIN_AVAILABLE;
  }
}

async function verifyCode(event) {
  event.preventDefault();
  const button = document.querySelector(".verify-button");
  let authenticated = false;
  button.disabled = true;
  setLoginStatus("正在登录…");
  try {
    const result = await requestJson("/api/visitor/verify-code", {
      method: "POST",
      body: JSON.stringify({
        email: elements.email.value.trim(),
        code: elements.code.value.trim(),
      }),
    });
    if (result.signedIn !== true) throw new Error("验证码验证未完成，请重新获取验证码。");
    authenticated = true;
    await loadDashboard({ strict: true });
    elements.loginDialog.close();
    elements.loginForm.reset();
    showToast("登录成功，可同步本机进度");
  } catch (error) {
    if (!authenticated && error.status === 404) {
      setLoginStatus("登录服务暂不可用。你可以继续免登录学习，本机进度会保留；请稍后重试或联系管理员。", true);
    } else if (authenticated && error.status === 401) {
      setLoginStatus("登录状态未建立或已失效，请重试；本机学习进度仍保留。", true);
    } else if (authenticated) {
      setLoginStatus("账号验证已通过，但学习进度载入失败。请重试；本机学习进度仍保留。", true);
    } else {
      setLoginStatus(error.message || "网络连接异常，请稍后重试。", true);
    }
  } finally {
    button.disabled = false;
  }
}

async function saveProfile(event) {
  event.preventDefault();
  const submit = elements.profileForm.querySelector('button[type="submit"]');
  submit.disabled = true;
  setProfileStatus("正在保存…");
  const form = new FormData(elements.profileForm);
  const profile = {
    displayName: String(form.get("displayName") || ""),
    grade: String(form.get("grade") || ""),
    major: String(form.get("major") || ""),
    direction: String(form.get("direction") || "undecided"),
    bio: String(form.get("bio") || ""),
  };
  let saved = false;
  try {
    if (state.localGuest) {
      const local = readLocalGuest();
      if (!writeLocalGuest({ ...local, profile })) throw new Error("浏览器无法保存，请允许网站存储后重试。");
      state.dashboard = localDashboard();
    } else {
      state.dashboard = await requestJson("/api/newbie/profile", { method: "PATCH", body: JSON.stringify(profile) });
    }
    saved = true;
    renderDashboard();
    setProfileStatus(state.localGuest ? "已保存到本机，尚未同步到账号。" : "已保存到账号。");
    showToast("个人主页已更新");
  } catch (error) {
    setProfileStatus(saved
      ? "已收到保存结果，但页面刷新失败。请刷新页面核对。"
      : `保存失败：${error.message || "服务暂时不可用，请稍后重试。"}`, true);
  } finally {
    submit.disabled = false;
  }
}

async function signAgreement(event) {
  event.preventDefault();
  if (state.localGuest) return openLogin();
  const submit = elements.agreementForm.querySelector('button[type="submit"]');
  const signerName = String(new FormData(elements.agreementForm).get("signerName") || "").trim();
  submit.disabled = true;
  elements.agreementStatus.textContent = "正在自动归档…";
  try {
    state.dashboard = await requestJson("/api/newbie/agreement", {
      method: "POST",
      body: JSON.stringify({
        agreementVersion: state.dashboard.agreement.version,
        signerName,
        accepted: true,
      }),
    });
  } catch (error) {
    elements.agreementStatus.textContent = error.message;
    submit.disabled = false;
    return;
  }
  try {
    if (state.dashboard.agreement?.approved) {
      renderDashboard();
      showToast("协议已归档，可保存个人主页和记录任务。");
    } else {
      renderAgreement();
      const reviewStatus = state.dashboard.agreement?.reviewStatus;
      const message = reviewStatus === "pending"
        ? "签署已提交，当前状态：待处理。归档完成后才能保存个人主页或正式提交任务。"
        : reviewStatus === "rejected"
          ? "签署尚未通过，请查看处理说明后再操作。"
          : "签署尚未完成归档，请刷新核对协议状态。";
      elements.agreementStatus.textContent = message;
      if (reviewStatus === "pending") {
        elements.agreementReview.querySelector("h2").textContent = "签署记录待处理";
        elements.agreementReview.querySelector(".review-note").textContent = message;
      }
      showToast(message);
    }
  } catch {
    const message = "已收到签署响应，但页面刷新失败。请刷新核对协议状态，避免重复签署。";
    elements.agreementStatus.textContent = message;
    showToast(message);
  } finally {
    submit.disabled = false;
  }
}

function openTask(id) {
  const task = state.dashboard?.tasks.find((candidate) => candidate.id === id);
  if (!task) return;
  state.currentTaskId = id;
  document.querySelector(".task-stage-dialog").textContent = `第 ${task.index} 关 · ${task.stage}`;
  document.querySelector(".task-title-dialog").textContent = task.title;
  document.querySelector(".task-summary-dialog").textContent = task.summary;
  document.querySelector(".task-goal").textContent = task.goal;
  const lesson = COURSE_LESSONS[task.id];
  document.querySelector(".task-materials").hidden = !lesson;
  if (lesson) {
    document.querySelector(".task-lesson-link").href = lesson.url;
    document.querySelector(".task-download-link").href = lesson.url.replace("index.html", "materials.html");
    document.querySelector(".task-ta-link").href = `/?ta=1&course=${encodeURIComponent(task.id)}`;
  }
  const fillList = (selector, items = []) => {
    const list = document.querySelector(selector);
    list.replaceChildren(...items.map((item) => {
      const li = document.createElement("li");
      li.textContent = item;
      return li;
    }));
  };
  fillList(".task-steps", task.steps);
  fillList(".task-examples", task.examples);
  document.querySelector(".task-ta-prompts").replaceChildren(...(task.taPrompts || []).map((prompt, hint) => {
    const li = document.createElement("li");
    const link = document.createElement("a");
    link.href = `/?ta=1&course=${encodeURIComponent(task.id)}&hint=${hint}`;
    link.textContent = prompt;
    li.append(link);
    return li;
  }));
  fillList(".task-deliverables", task.deliverables);
  document.querySelectorAll(".task-extra-section").forEach((section) => {
    const list = section.querySelector("ul");
    section.hidden = !list || list.children.length === 0;
  });
  const evidenceHints = [
    `当前任务：${task.title}`,
    "建议填写：完成了什么、证据链接/截图说明、遇到的问题、下一步计划。",
  ];
  elements.taskEvidence.placeholder = evidenceHints.join("\n");
  elements.taskEvidence.value = task.evidence || "";
  document.querySelector(".task-start").hidden = task.status !== "not_started";
  document.querySelector(".task-complete").textContent = state.localGuest ? "标记学完（本机）" : "正式提交";
  document.querySelector(".task-submit").hidden = !state.localGuest;
  setTaskStatus(task.status === "completed" ? "已记录完成；是否通过以教师验收为准。你仍可更新证据和复盘。" : "");
  elements.taskDialog.show();
}

async function updateTask(status) {
  const task = state.dashboard?.tasks.find((candidate) => candidate.id === state.currentTaskId);
  if (!task) return;
  if (!state.localGuest && !state.dashboard.agreement?.approved) {
    elements.taskDialog.close();
    renderAgreement();
    return;
  }
  const buttons = elements.taskDialog.querySelectorAll("button");
  buttons.forEach((button) => { button.disabled = true; });
  setTaskStatus(status === "completed" ? "正在保存完成记录…" : "正在开始任务…");
  try {
    if (state.localGuest) throw new Error("LOCAL_GUEST");
    state.dashboard = await requestJson(`/api/newbie/tasks/${encodeURIComponent(task.id)}`, {
      method: "POST",
      body: JSON.stringify({ status, evidence: elements.taskEvidence.value.trim() }),
    });
  } catch (error) {
    if (!state.localGuest) {
      setTaskStatus(error.message, true);
      buttons.forEach((button) => { button.disabled = false; });
      return;
    }
    const saved = readLocalGuest();
    if (!writeLocalGuest({
      ...saved,
      tasks: {
        ...(saved.tasks || {}),
        [task.id]: {
          status,
          evidence: elements.taskEvidence.value.trim(),
          updatedAt: Date.now(),
        },
      },
    })) {
      setTaskStatus("未保存，请允许浏览器存储后重试。", true);
      buttons.forEach((button) => { button.disabled = false; });
      return;
    }
    state.localGuest = true;
    state.dashboard = localDashboard();
    if (error.message !== "LOCAL_GUEST") console.info("Falling back to local guest task save.", error);
  }
  {
    renderDashboard();
    elements.taskDialog.close();
    showToast(state.localGuest ? "学习记录已保存到本机，尚未正式提交" : "任务记录已保存到账号");
    buttons.forEach((button) => { button.disabled = false; });
  }
}

async function logout() {
  elements.logout.disabled = true;
  try {
    if (!state.localGuest) await requestJson("/api/visitor/logout", { method: "POST", body: "{}" });
  } catch {
    elements.logout.disabled = false;
    showToast("退出失败，请重试");
    return;
  }
  elements.logout.disabled = false;
  enterLocalGuestMode("已退出账号，本机学习进度已保留");
}

async function syncProgress() {
  if (state.localGuest) return openLogin();
  if (!state.dashboard.agreement?.approved) return renderAgreement();
  const button = document.querySelector(".sync-progress");
  button.disabled = true;
  let synced = 0;
  let skipped = 0;
  setSyncStatus("正在同步本机任务记录…");
  try {
    const saved = readLocalGuest();
    for (const course of LOCAL_TASKS) {
      const local = saved.tasks?.[course.id];
      const remote = state.dashboard.tasks.find((task) => task.id === course.id);
      if (!local) continue;
      if (remote?.status === "completed" || remote?.evidence || !remote?.unlocked) {
        skipped += 1;
        continue;
      }
      state.dashboard = await requestJson(`/api/newbie/tasks/${encodeURIComponent(course.id)}`, {
        method: "POST", body: JSON.stringify({ status: local.status, evidence: local.evidence || "" }),
      });
      synced += 1;
    }
    renderDashboard();
    const message = synced === 0 && skipped === 0
      ? "本机没有可同步的任务记录，本次上传 0 条。"
      : `本次已同步 ${synced} 条，跳过 ${skipped} 条（账号已有记录或尚未解锁）。本机记录仍保留。`;
    setSyncStatus(message);
    showToast(synced ? `已同步 ${synced} 条任务记录` : "本次上传 0 条任务记录");
  } catch (error) {
    setSyncStatus(`本次已同步 ${synced} 条；后续同步未完成：${error.message || "请求失败"}。本机记录仍保留。`, true);
    showToast(`已同步 ${synced} 条，其余未完成，请查看提示`);
  } finally {
    button.disabled = false;
  }
}

document.querySelectorAll(".login-trigger").forEach((button) => button.addEventListener("click", openLogin));
document.querySelector(".login-close").addEventListener("click", () => elements.loginDialog.close());
elements.codeButton.addEventListener("click", () => void requestCode());
elements.loginForm.addEventListener("submit", (event) => void verifyCode(event));
elements.profileForm.addEventListener("submit", (event) => void saveProfile(event));
elements.agreementForm.addEventListener("submit", (event) => void signAgreement(event));
elements.agreementOpen.addEventListener("click", renderAgreement);
elements.logout.addEventListener("click", () => void logout());
document.querySelectorAll(".workspace-nav-button").forEach((button) => button.addEventListener("click", () => switchView(button.dataset.view, false, true)));
document.querySelector(".task-close").addEventListener("click", () => elements.taskDialog.close());
document.querySelector(".task-start").addEventListener("click", () => void updateTask("in_progress"));
document.querySelector(".task-complete").addEventListener("click", () => void updateTask("completed"));
document.querySelector(".task-submit").addEventListener("click", openLogin);
document.querySelector(".sync-progress").addEventListener("click", () => void syncProgress());
document.querySelector(".agreement-back").addEventListener("click", renderDashboard);
document.querySelectorAll(".start-learning").forEach((button) => button.addEventListener("click", () => enterLocalGuestMode()));
window.addEventListener("hashchange", () => routeWorkspaceHash(true));
window.addEventListener("popstate", () => routeWorkspaceHash(true));
document.querySelectorAll("[data-open-view]").forEach((button) => button.addEventListener("click", () => switchView(button.dataset.openView, false, true)));
document.querySelector(".workspace-tutor-course").addEventListener("change", renderWorkspaceTutor);
document.querySelector(".workspace-continue").addEventListener("click", () => {
  const tasks = state.dashboard?.tasks || [];
  const next = tasks.find((task) => task.status === "in_progress") || tasks.find((task) => task.status !== "completed");
  if (next) openTask(next.id);
  else switchView("progress", false, true);
});
document.querySelector(".workspace-login").addEventListener("click", openLogin);
document.querySelector(".workspace-sync").addEventListener("click", () => document.querySelector(".sync-progress").click());
document.querySelector(".workspace-logout").addEventListener("click", () => elements.logout.click());
document.querySelector(".workspace-agreement").addEventListener("click", () => state.localGuest ? openLogin() : renderAgreement());
document.querySelector(".workspace-passes-slot").append(document.getElementById("passes"));

void loadDashboard();
