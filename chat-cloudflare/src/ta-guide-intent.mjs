// A static introduction is appropriate only for a complete, explicit navigation
// question. A mention of the TA or village inside a lesson question is not one.
export function shouldUseStaticTaGuide(question) {
  if (typeof question !== 'string') return false;
  const text = question.normalize('NFKC').trim()
    .replace(/[。.!?]+$/u, '').trim()
    .replace(/^(?:请问|请|麻烦你|麻烦)\s*/u, '');
  if (!text || text.length > 100) return false;
  return [
    /^(?:机器人(?:项目)?)?新手村(?:是什么|是做什么的|是干什么的|怎么用|如何使用|怎么进入|如何进入|入口在哪(?:里)?|怎么开始|如何开始|有哪些入门步骤|的入门流程是什么)$/u,
    /^(?:什么是|介绍(?:一下)?|说明(?:一下)?|怎么进入|如何进入|怎样进入|怎么打开|如何打开)(?:机器人(?:项目)?)?新手村$/u,
    /^(?:(?:实验室\s*)?(?:AI\s*)?助教|实验室大模型)(?:是什么|是做什么的|是干什么的|怎么用|如何使用|入口在哪(?:里)?|在哪里|在哪)$/iu,
    /^(?:怎么使用|如何使用|怎么找到|如何找到|介绍(?:一下)?)(?:(?:实验室\s*)?(?:AI\s*)?助教|实验室大模型)$/iu,
  ].some(pattern => pattern.test(text));
}
