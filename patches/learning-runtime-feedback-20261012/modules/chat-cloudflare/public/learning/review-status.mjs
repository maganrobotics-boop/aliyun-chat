// Copyright (c) 2026 OriginMind. All rights reserved.
// Use only after a server-confirmed submission, never for a failed save.
export function reviewStatus(result={}) {
  if (result.reviewState==='done') return '作业已保存，AI 点评已完成。正式验收由教师确认。';
  if (result.reviewState==='reviewing') return '作业已保存，AI 正在点评。可稍后刷新点评，无需重复提交。';
  const seconds=Number(result.retryAfter);
  if (result.code==='review_rate_limited'||result.status===429||seconds>0) {
    const wait=Number.isFinite(seconds)&&seconds>0?'约 '+Math.ceil(seconds/60)+' 分钟后':'稍后';
    return '作业已保存，无需重复提交。本小时 AI 点评次数已用完，'+wait+'可重试点评。';
  }
  if (result.status===401) return '作业已保存，登录状态已失效。重新登录后可重试点评，无需重复提交。';
  if (result.error||result.message||result.reviewState==='failed') return '作业已保存，AI 点评暂未完成。请稍后重试点评，无需重复提交。';
  return '作业已保存，等待 AI 点评。无需重复提交。';
}
export function reviewRequestError(result,status,retryAfterHeader) {
  return Object.assign(new Error(result.error||'操作未完成'),{
    status, code:result.code, retryAfter:result.retryAfter??Number(retryAfterHeader||0), saved:result.saved===true,
  });
}
