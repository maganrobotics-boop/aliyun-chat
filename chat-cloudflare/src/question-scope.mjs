const INTERNAL_QUESTION_PATTERN = /(?:我们|我司|本公司|公司内部|内部|本项目|项目|OriginMind|ARTS\s*Robotics|OA|团队|实验室|成员|员工|负责人|客户|供应商|合同|报价|预算|订单|交付|进度|排期|会议|纪要|审批|制度|流程|权限|账号|资料|文档|文件|数据|实验|测试|样机|设备|机器人|机械臂|底盘|代码|仓库|BOM|图纸|故障|复位|参数|配置|部署|服务器|密钥|密码|产品|(?<!光)合作(?!用)|公开成果|二次开发|聊天记录|系统提示词|私人|手机号|身份证|其他用户|图片|照片|图像|原图|配图)/iu;
const ORGANIZATION_QUESTION_PATTERN = /(?:我们|我司|本公司|公司内部|内部|本项目|项目|OriginMind|ARTS\s*Robotics|OA|团队|实验室|成员|员工|负责人|客户|供应商)/iu;
const OPERATIONAL_QUESTION_PATTERN = /(?:合同|报价|预算|订单|交付|进度|排期|会议|纪要|审批|制度|权限|账号|资料|文档|文件|数据|实验|测试|样机|设备|底盘|代码|仓库|BOM|图纸|故障|复位|参数|配置|部署|服务器|密钥|密码)/iu;
const GENERAL_LEARNING_PATTERN = /(?:小白|新手|初学|入门|如何学习|怎么学习|学习路线|学习路径|从零开始|什么是(?:机器人|机械臂)|(?:机器人|机械臂)是什么|(?:解释|介绍).{0,6}(?:机器人|机械臂)|(?:机器人|机械臂).{0,14}(?:基础知识|教程|科普|常见|传感器|如何定位|有什么区别|基本流程|运动学|视觉))/iu;
const CLEAR_GENERAL_KNOWLEDGE_PATTERN = /(?:天气|气温|温度|降雨|下雨|台风|空气质量|几点|星期几|今天几号|日期|时区|汇率|换算|翻译|计算|沸点|熔点|首都|人口|面积|元素符号|化学式|小白|新手|初学|入门|如何学习|怎么学习|学习路线|学习路径|从零开始|什么是(?:机器人|机械臂)|(?:机器人|机械臂)是什么|(?:机器人|机械臂).{0,8}(?:基础知识|教程|科普)|weather|temperature|forecast|rain|time\s+is\s+it|time\s+in|date|time\s*zone|exchange\s+rate|convert|translate|calculate|boiling\s+point|melting\s+point|capital\s+of|population\s+of|area\s+of)/iu;
const GENERAL_PROGRAMMING_LANGUAGE_PATTERN = /\b(?:python|javascript|typescript)\b/iu;
const GENERAL_PROGRAMMING_CONCEPT_PATTERN = /(?:\b(?:list|tuple|dict|set|str|int|float|bool|array|object|string|number|boolean|map)\b|列表|元组|字典|集合|字符串|布尔|基本类型)/iu;
const GENERAL_PROGRAMMING_EXPLANATION_PATTERN = /(?:解释|讲解|介绍|说明|比较|区别|差异|什么是|是什么|用法|如何使用|怎么使用|(?:给出?|提供|举).{0,8}(?:代码示例|示例代码)|\b(?:explain|define|compare|difference|example)\b)/iu;
const PRIVATE_PROGRAMMING_CONTEXT_PATTERN = /(?:公司|组织|私有|私密|保密|个人|我的|我提交|我上传|本地|磁盘|路径|日志|附件|上传|提交|这(?:段|份|个)|那(?:段|份|个)|下面|如下|上述|真实|实际|查看|读取|检索|查找|搜索|查阅|分析|排查|诊断|审查|评审|审核|凭证|令牌|\b(?:our|ours|my|mine|company|organizations?|teams?|members?|internal|private|confidential|repository|repositories|repos?|files?|documents?|datasets?|production|servers?|configs?|configurations?|credentials?|passwords?|secrets?|tokens?)\b|api[\s_-]*key)/iu;

function isClearGeneralProgrammingQuestion(question) {
  if (!GENERAL_PROGRAMMING_LANGUAGE_PATTERN.test(question)
    || !GENERAL_PROGRAMMING_CONCEPT_PATTERN.test(question)
    || !GENERAL_PROGRAMMING_EXPLANATION_PATTERN.test(question)
    || PRIVATE_PROGRAMMING_CONTEXT_PATTERN.test(question)) return false;
  // Only the educational phrase is exempt: all other internal/operational
  // words, including any remaining "代码", still require knowledge evidence.
  const teachingText = question
    .replace(/(?:代码示例|示例代码)/gu, '示例')
    .replace(/((?:附上?|给出?|提供)(?:一(?:个|段))?(?:简短|自包含|示例)?的?)代码块/gu, '$1示例');
  return !INTERNAL_QUESTION_PATTERN.test(teachingText);
}

/** Conservative boundary: organization-specific and operational questions must
 * be grounded. Only clearly ordinary questions may use model general knowledge. */
export function questionRequiresKnowledgeEvidence(question) {
  const normalized = String(question || '').normalize('NFKC');
  if (GENERAL_PROGRAMMING_LANGUAGE_PATTERN.test(normalized) && PRIVATE_PROGRAMMING_CONTEXT_PATTERN.test(normalized)) return true;
  if (isClearGeneralProgrammingQuestion(normalized)) return false;
  if (GENERAL_LEARNING_PATTERN.test(normalized) && !ORGANIZATION_QUESTION_PATTERN.test(normalized) && !OPERATIONAL_QUESTION_PATTERN.test(normalized)) return false;
  return INTERNAL_QUESTION_PATTERN.test(normalized);
}

export function questionRequestsKnowledgeImages(question) {
  const value = String(question || '').normalize('NFKC').trim();
  return /(?:图片|照片|图像|原图|相片|配图|看图|展示.{0,6}图)/u.test(value);
}

export function questionAllowsGeneralKnowledge(question) {
  if (questionIsSimpleConversation(question)) return true;
  const normalized = String(question || '').normalize('NFKC').trim();
  if (questionRequiresKnowledgeEvidence(normalized)) return false;
  return /\p{Script=Han}.*\p{Script=Han}/u.test(normalized)
    || /\b(?:what|why|how|when|where|who|which|explain|define|calculate|compare|is|are|can|does|do)\b/iu.test(normalized);
}

/** When retrieval produced candidates, bypass them only for unmistakably
 * ordinary questions. This prevents weak semantic matches (for example a
 * campus document for a weather question) from overriding common knowledge,
 * without taking real knowledge-base questions away from grounded answering. */
export function questionPrefersGeneralKnowledge(question) {
  if (questionIsSimpleConversation(question)) return true;
  const normalized = String(question || '').normalize('NFKC').trim();
  return questionAllowsGeneralKnowledge(normalized)
    && (CLEAR_GENERAL_KNOWLEDGE_PATTERN.test(normalized) || isClearGeneralProgrammingQuestion(normalized));
}

/** Only bounded greetings and fixed echo checks bypass document retrieval. */
export function questionIsSimpleConversation(question) {
  const value = String(question || '').normalize('NFKC').trim();
  return /^(?:你好|您好|嗨|早上好|下午好|晚上好|谢谢|感谢|好的|收到|hello|hi|thanks|thank you)[呀啊哦!！。,.，?？\s]*$/iu.test(value)
    || /^(?:系统验收测试[，,:：]\s*)?请?(?:只|仅)回复[：:]\s*(?:测试收到|收到|你好|OK)[。.!！\s]*$/iu.test(value);
}
