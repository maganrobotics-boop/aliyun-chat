import { NEWBIE_COURSES } from "./newbie-course-data.mjs";

// Public-course facts verified against the deployed v5 assets on 2026-09-26.
// Keep every complete course document below grounded-prompt.mjs's 2200-character cap.
const COURSE_FACTS = Object.freeze({
  "registration": [
    "本关无需编程基础。零基础可先填planning-sheet.md，不必编辑JSON。check_profile.py 为可选检查，只导入 Python 标准库 json、math、sys、pathlib，无 pandas 等第三方依赖；没有 Python 时可按人工清单完成。",
    "验收只有以下四类：信息真实且无待填写；任务可执行且总时长不超可用时间；目标含任务、输出和判断标准；能解释8小时缩为4小时的取舍。没有必须加粗、必须用因果句等格式条件。",
    "示例为虚构学生每周4小时：环境和Git共2小时、Python2小时。缩减个人计划时需减少任务或推迟部分目标，保留两个版本并解释，不是只把时长数字改小。",
    "profile.json 的 week_plan 每项有 task、hours、evidence；goal 是可观察结果；skills 可写零基础；help_needed 是当前障碍。check_profile.py 仅检查字段和时间，不能判定目标合理、实名认证、注册或项目录取。"
  ],
  "toolkit": [
    "本套练习采用 Python 3.10 或以上，除ROS2关外只用标准库。check_environment.py 明确将低于3.10记为错误；不能改说3.8合格。本关无需先装ROS2。",
    "在学习根目录建立code、data、evidence、notes四目录，修改并保存code/hello.py，从根目录执行 python code/hello.py，再执行 python check_environment.py .。未加code/的 python hello.py 会运行根目录原文件，不能据此判断修改无效。",
    "标准原始输出为：你好，学习者！本周计划学习 4 小时。修改NAME和HOURS后先预测再运行；另做HOURS=2.5和删引号产生SyntaxError再修复的练习。",
    "环境PASS需当前Python/Git可用、四目录存在、code/hello.py存在、errors为空。保存报告重定向到evidence/environment.json后终端无显示是正常现象。",
    "排错术语：SyntaxError指语法；can't open file/No such file or directory先查当前目录、路径和保存位置；PermissionError指访问权限；ModuleNotFoundError指导入模块不可用。它们不是同一错误，不能见到权限错误就建议安装包。优先核对完整命令、实际报错、解释器和文件路径。"
  ],
  "git-basics": [
    "在材料目录内新建my-repo，检查脚本留在材料目录，不放进my-repo。仅在新的本地练习仓库进行，不要求注册GitHub或公开个人资料。作者配置只设当前仓库，不改全局。自动demo-repo是教学示例，不能作为个人作业。",
    "工作区、暂存区、提交记录不同；add不等于commit，commit不等于push。git status --short的第一列相对HEAD表示暂存区，第二列相对暂存区表示工作区；例如MM README.md表示同时有暂存和未暂存改动。",
    "个人主练习至少3次真实内容提交和1次合并提交；当前分支main；practice保留且已包含在main历史中；使用merge --no-ff保留合并节点；git status --short无未提交项。不得空提交凑数或用reset --hard清除不明改动。",
    "README四节齐全，无待填写；合并复盘至少约100字；另做improvement分支变化并合并。check_repo.py退出码0仍需人工阅读。记录README、图形日志、干净工作区、完整哈希、差异和变化任务，不要求上传整个.git。"
  ],
  "python-basics": [
    "仅用Python标准库，CSV全部为教学模拟数据。正常motion_log.csv：21点、20s、10m路程、平均/最大分段速率均0.5m/s、位移0m、电量下降5个百分点、可疑区间0。",
    "总路程是相邻位置欧氏距离之和，位移是起终点之差。平均速率=总路程/总时长，非等间隔时不能直接平均分段速率。说明差异可用教学示例t=0,1,4秒、x=0,1,2米、y均0：总路程2米/4秒=0.5m/s；分段速率简单平均(1+1/3)/2约0.667m/s是错误算法。若题中另给t=[0,0.5,2,3]秒、x=[0,1,1,3]米、y均0，则分段路程1、0、2米，总路程3米/3秒=1m/s，不能误写2/3；分段速率简单平均4/3也不等于平均速率。",
    "position_jump.csv为11m、3s、平均约3.667m/s、最大10m/s；唯一可疑区间1–2s，电量降0.75个百分点。教学阈值严格大于1.5m/s；不能只凭跳变断言真机速度、电池异常或具体故障原因。",
    "当前v5路径的Python教材为日志分析实训V3。完成exercise.py三个TODO，个人验收运行不加--reference的python check_work.py，需14项通过，不能沿用旧版8项。标准七项指标误差≤0.001；还要自建数据、先手算后运行，解释提交单四问并注明助教帮助。参考自检不算自己的验收。"
  ],
  "ros2-simulation": [
    "环境为Ubuntu24.04+ROS2 Jazzy、系统python3、turtlesim；各终端source /opt/ros/jazzy/setup.bash。ROS_DOMAIN_ID=42只是教材示例，多人同网由教师分组分配，三个终端用同组编号；命名空间不是网络隔离，不在连接真机的网络练习。本课只用/newbie_lab海龟仿真。",
    "节点/newbie_lab/turtlesim；命令话题/newbie_lab/turtle1/cmd_vel类型geometry_msgs/msg/Twist；反馈话题/newbie_lab/turtle1/pose类型turtlesim/msg/Pose。/parameter_events是话题，不是节点。ros2 node list列发现的节点及其命名空间，不同namespace本身不会使默认node list为空；domain不同会影响发现。",
    "教材用ros2 --help检查CLI可用，不用ros2 --version读取发行版；发行版环境可检查ROS_DISTRO。本关节点检查命令为ros2 node list --no-daemon --spin-time 3；话题检查为ros2 topic list -t --no-daemon --spin-time 3。首次发现要等待，节点列表与话题列表不可混淆。",
    "半径=|v/ω|，周期=2π/|ω|。LINEAR从1.0改0.5且ANGULAR=1.0时半径1变0.5、周期约6.283s不变、路程约6.283变3.142，单位为仿真单位，不是真实米。",
    "实录容差：时长6.0–7.2s；路程与理论差≤0.5；闭合误差≤0.35；外接框宽高与直径差各≤0.35。不要为通过而放宽阈值。simulate.py生成SYNTHETIC_ONLY，只是离线理论；未完成真实ROS2仿真必须保留进行中。",
    "run_ros.py等pose和命令订阅者，10秒未就绪报错，结束发零速度。每次新实验重启干净海龟，输出另取文件名。提交两份真实CSV、节点/话题、截图、代码解释、理论实际对照和反向转圈实验，不能拿离线数据充当实录。"
  ],
  "mini-project": [
    "地图为教学栅格，坐标[行,列]从0开始，行向下列向右；点机器人只能上下左右，每步代价1，不可斜走。BFS保证最少步数的前提是本题等步长代价，不能推广成任意代价最优。",
    "主地图5×7，起点[0,0]终点[4,6]，最短10步且可不唯一。隔断图应reachable=false、steps=null、path=null；算法返回None。3×3中心障碍、起点[1,0]终点[1,2]应4步；封整列后无解。",
    "队列先进先出，合法且未访问的格在入队时记录parents；找到终点后回溯并反转。具体下一轮队列依赖地图、当前队列、已访问集合和邻居顺序，没有这些数据不能声称唯一结果。",
    "完成个人exercise.py三个TODO和不带--reference的六项自检；另交两份变化地图、预测实际对照、项目卡、代码和100–200字复盘。自检通过还需解释，不能直接用于真机导航：未处理机器人外形、动态障碍、定位误差、控制。"
  ],
  "graduation": [
    "sample/manifest.json的is_demo=true，仅是虚构结构；DEMO_ONLY不能作为个人作业。个人my-evidence/manifest.json的is_demo=false，前六关逐项记录id/status/command/expected/actual/change/explanation/files，并有reflection、next_goal、ai_help。",
    "files路径相对于manifest所在目录；每关至少1个非空证据文件，但仍须满足对应关卡实际要求。结构检查只查字段/路径/文件存在性，不自动批改内容或证明本人运行，SHA256也不能证明身份、真实实验或内容正确。",
    "只有真实达到该关验收才写completed；ROS2只有离线理论预检应保持in_progress，不能改状态或用示例掩盖未完成。未提供清单与实际文件列表时，无法确认具体缺失文件。",
    "audit_evidence.py打包不覆盖同名文件，修改后用v2等新名；检查一次文件改名导致缺失，再恢复并记录。提交证据包、检查结果、一页反思、下一步计划；3分钟演示为30秒目标、90秒改动、60秒失败与下一步。下载程序不会自动上传，本机记录不等于教师验收。",
    "实际文件名为manifest.json与audit_evidence.py；打包程序生成SHA256SUMS.txt。教材没有要求manifest签名、固定的command.txt/expected.txt/actual.txt/diff.patch四文件或recovery_log.txt。证据内容须完整，但不能把助教自定文件名说成强制规范。共享链接应由导师使用获授权账号核对，不把非公开资料改公开。"
  ]
});

// Course selection chooses only public curriculum. It grants no permissions
// and never promotes student-supplied text into the reference document.
export function newbieCourseDocument(messages = []) {
  for (const message of messages.slice(-20).reverse()) {
    if (message?.role !== "user") continue;
    const match = String(message.content || "").match(/^我正在学习新手村第 ([1-7]) 关：([^。\n]{1,40})。/u);
    if (!match) continue;
    const entry = Object.entries(NEWBIE_COURSES).find(([, course]) => course.index === Number(match[1]) && course.title === match[2]);
    if (!entry) continue;
    const [id, course] = entry;
    return {
      id: `course:${id}`,
      title: `新手村第 ${course.index} 关：${course.title}`,
      body: [
        "以下课程事实已对照本部署公开教材与检查程序核对；技术版本、依赖、命令、标准输出和验收以本关资料为准。",
        "讲解边界：区分教材要求与额外建议；建议不自动成为验收条件。资料没写的版本、依赖、文件内容或学生运行结果不能猜测。缺少实际命令、完整报错、地图、清单等关键输入时先说明缺少什么；教学虚构示例不可当作学生成果。",
        "本关核对要点：", ...COURSE_FACTS[id],
        `本关目标：${course.goal}`, "学习步骤：", ...course.steps,
        "验收与提交要求：", ...course.deliverables,
        "可补充明确标为建议的一般原理和排错方法，但不能增加教材未规定的格式或通过条件。公开阅读和下载无需登录。助教不能代替学生运行、签署、正式提交或教师验收；不能宣称已检查未提供的文件或图片。"
      ].join("\n"),
      url: "", updatedAt: "2026-09-25", origin: "site_public",
      category: "公开课程", published: 1,
    };
  }
  return null;
}
