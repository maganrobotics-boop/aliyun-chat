import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { buildGroundedChatMessages } from '../chat-cloudflare/src/grounded-prompt.mjs';

const read = name => readFile(new URL(`../${name}`, import.meta.url), 'utf8');

test('public chat identifies AI 学姐 and historical examples contain complete answers', async () => {
  const [html, script] = await Promise.all([
    read('chat-cloudflare/frontend/index.html'),
    read('chat-cloudflare/frontend/app.js'),
  ]);
  assert.match(html, /AI 学姐 · ARTS Robotics/u);
  assert.match(script, /class="lab-name">AI 学姐</u);
  assert.match(script, /实验室围绕机器人自主移动与智能操作开展研究/u);
  assert.doesNotMatch(script, /我会从已审核的实验室公开知识中检索研究方向/u);
  assert.doesNotMatch(script, /接入公开知识库后，我会/u);
});

test('OA consistently identifies AI 学长', async () => {
  const [page, panel, context, directory] = await Promise.all([
    read('app/page.tsx'),
    read('components/knowledge/oa-chat-panel.tsx'),
    read('components/knowledge/oa-conversation-context.tsx'),
    read('components/ai-member-directory.tsx'),
  ]);
  for (const source of [page, panel, context, directory]) assert.match(source, /AI 学长/u);
  assert.match(panel, /涉及入组与项目申请时，只依据已审核制度回答/u);
  assert.match(panel, /placeholder="向 AI 学长提问"/u);
});

test('grounded answers cannot invent admission requirements', () => {
  const messages = buildGroundedChatMessages({
    question: '加入实验室必须会 ROS 2 吗？',
    documents: [{ title: '项目介绍', body: '欢迎学生了解机器人项目。', updatedAt: '2026-10-12', origin: 'oa', assets: [] }],
  });
  const prompt = messages[0].content;
  assert.match(prompt, /涉及加入实验室、项目报名或入组时/u);
  assert.match(prompt, /不得把 ROS 2、课程成绩、编程基础、材料清单、测试、工时、面试或推荐信自行说成强制条件/u);
  assert.match(prompt, /目前知识库没有找到足够依据/u);
});
