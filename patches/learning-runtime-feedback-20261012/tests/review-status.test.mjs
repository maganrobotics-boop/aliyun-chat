import test from 'node:test';
import assert from 'node:assert/strict';
import {reviewStatus,reviewRequestError} from '../modules/chat-cloudflare/public/learning/review-status.mjs';
test('quota feedback preserves saved receipt and explains the retry window',()=>{
  const error=reviewRequestError({error:'limited',code:'review_rate_limited',saved:true,retryAfter:61},429,null);
  assert.equal(error.saved,true);assert.match(reviewStatus(error),/作业已保存，无需重复提交/);assert.match(reviewStatus(error),/约 2 分钟后/);assert.doesNotMatch(reviewStatus(error),/草稿/);
});
test('history after reopening still shows quota without making a review request',()=>{
  assert.match(reviewStatus({reviewState:'pending',saved:true,retryAfter:30}),/约 1 分钟后可重试点评/);
});
test('pending, processing, model failure and expired login all preserve the save state',()=>{
  for(const state of [{reviewState:'pending'},{reviewState:'reviewing'},{reviewState:'failed'},{status:503,message:'offline'},{status:401}])assert.match(reviewStatus(state),/^作业已保存/);
  assert.match(reviewStatus({status:401}),/重新登录/);
  assert.match(reviewStatus({reviewState:'done'}),/正式验收由教师确认/);
});
test('Retry-After header works when an older backend omits the JSON field',()=>{
  assert.match(reviewStatus(reviewRequestError({error:'limited'},429,'120')),/约 2 分钟后/);
  assert.doesNotMatch(reviewStatus({status:429,retryAfter:'invalid'}),/NaN/);
});
