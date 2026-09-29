import { decryptSecret } from './crypto.mjs';
import { aliyunEndpoint } from './knowledge.mjs';
import { completeModelAnswer } from './answer-completion.mjs';
import { answerMode } from './answer-mode.mjs';
import { buildGeneralChatMessages, buildGroundedChatMessages } from './grounded-prompt.mjs';
import { readSse, privateAnswerStream, checkStreamAbort } from '../../lib/oa-native-stream.mjs';

/** Never use reasoning_content, tool calls, or private analysis as response text. */
export function withoutReasoning(text) {
  return text.replace(/<(?:think|analysis|reasoning)\b[^>]*>[\s\S]*?<\/(?:think|analysis|reasoning)>/giu, '')
    .replace(/<(?:think|analysis|reasoning)\b[^>]*>[\s\S]*$/giu, '');
}

/** Use the existing final-content validator for every completed preview prefix. */
export function createValidatedPreview(validate, emit) {
  let shown = '';
  return {
    reset() { shown = ''; emit({ type: 'reset' }); },
    update(raw) {
      const body = withoutReasoning(raw);
      // A boundary avoids leaking an unfinished URL, email, citation, or tag.
      const boundaries = [...body.matchAll(/[。！？!?\n](?:[\]］】0-9０-９,，\s]*)/gu)];
      const last = boundaries.at(-1);
      if (!last) return;
      const candidate = body.slice(0, last.index + last[0].length);
      if (/<[^>]*$/u.test(candidate)) return;
      const visible = validate(candidate);
      if (typeof visible !== 'string' || !visible || visible.length > 12000) return;
      if (!visible.startsWith(shown)) { shown = ''; emit({ type: 'reset' }); }
      const delta = visible.slice(shown.length);
      if (delta) { emit({ type: 'delta', delta }); shown = visible; }
    },
  };
}

/** Real provider SSE, bounded and cancellable; no full-response slicing/timers. */
export async function bailianContentStream({ response, signal, onContent }) {
  let answer = '', finishReason = null, done = false;
  await readSse(response, data => {
    if (data === '[DONE]') { if (done) throw new Error('MODEL_STREAM_DUPLICATE_DONE'); done = true; return; }
    if (done) throw new Error('MODEL_STREAM_AFTER_DONE');
    const event = JSON.parse(data);
    if (!event || event.error || !Array.isArray(event.choices)) throw new Error('MODEL_STREAM_PROTOCOL');
    if (!event.choices.length) return; // Provider usage footer.
    if (event.choices.length !== 1) throw new Error('MODEL_STREAM_CHOICES');
    const choice = event.choices[0];
    if (choice.index !== undefined && choice.index !== 0) throw new Error('MODEL_STREAM_CHOICES');
    if (choice.delta?.tool_calls || choice.delta?.function_call || choice.delta?.refusal) throw new Error('MODEL_STREAM_NOT_CONTENT');
    const delta = choice.delta?.content;
    if (finishReason !== null && (delta || choice.finish_reason)) throw new Error('MODEL_STREAM_AFTER_FINISH');
    if (delta !== undefined && delta !== null) {
      if (typeof delta !== 'string' || !delta.isWellFormed() || answer.length + delta.length > 18000) throw new Error('MODEL_STREAM_LIMIT');
      answer += delta;
      if (delta) onContent(answer);
    }
    if (choice.finish_reason !== undefined && choice.finish_reason !== null) {
      if (finishReason !== null || !['stop', 'length'].includes(choice.finish_reason)) throw new Error('MODEL_STREAM_FINISH');
      finishReason = choice.finish_reason;
    }
  }, { signal });
  if (!done || !finishReason || !answer.trim()) throw new Error('MODEL_STREAM_INTERRUPTED');
  return { text: withoutReasoning(answer), finishReason };
}

/** Called only AFTER existing HMAC auth, exact payload validation and nonce claim. */
export function streamPrivateOaAnswer(context, engine, config, payload, active) {
  return privateAnswerStream(async (emit, signal) => {
    if (active.provider !== 'bailian') throw new Error('MODEL_STREAM_PROVIDER_UNAVAILABLE');
    const general = payload.answerType === 'general';
    const validate = text => general ? engine.visibleGeneralAnswer(text) : engine.visibleAiAnswer(text, payload.documents.length);
    const messages = general
      ? buildGeneralChatMessages({ question: payload.question, messages: [...payload.history, { role: 'user', content: payload.question }] })
      : buildGroundedChatMessages({ documents: payload.documents, history: [], question: payload.question, messages: [...payload.history, { role: 'user', content: payload.question }], scope: 'internal' });
    const endpoint = `${aliyunEndpoint(config.baseUrl)}/chat/completions`;
    const apiKey = await decryptSecret(config.encryptedKey, context.env.APP_ENCRYPTION_KEY);
    const selectedMode = answerMode(payload.question);
    const deadline = Date.now() + (selectedMode === 'deep' ? 75000 : 45000);
    const preview = createValidatedPreview(validate, emit);
    for (let attempt = 0; attempt < 2; attempt++) {
      checkStreamAbort(signal);
      if (attempt) preview.reset();
      emit({ type: 'status', phase: attempt ? 'retrying' : 'generating' });
      await engine.globalBudget(context);
      const attemptMessages = attempt ? messages.map(message => message.role === 'system' ? {
        ...message, content: `${message.content}\n上一次回答未通过完整性或资料引用校验。请重新独立作答，保留原有资料和安全规则；只输出完整正文及有效资料编号，不输出参考资料列表、网址、联系方式或HTML。`,
      } : message) : messages;
      let prior = '';
      const answer = await completeModelAnswer(attemptMessages, 2400, async nextMessages => {
        checkStreamAbort(signal);
        const remaining = deadline - Date.now();
        if (remaining <= 0) throw new Error('MODEL_STREAM_TIMEOUT');
        const upstreamSignal = AbortSignal.any([signal, AbortSignal.timeout(remaining)]);
        const response = await context.runtime.fetch(endpoint, {
          method: 'POST', headers: { Authorization: `Bearer ${apiKey}`, 'content-type': 'application/json', accept: 'text/event-stream' },
          body: JSON.stringify({ model: config.model, messages: nextMessages, temperature: 0.25, max_tokens: 2400, enable_thinking: false, stream: true }),
          redirect: 'manual', cache: 'no-store', credentials: 'omit', signal: upstreamSignal,
        });
        const result = await bailianContentStream({ response, signal: upstreamSignal, onContent: text => preview.update(prior + text) });
        prior += result.text;
        return result;
      }, async () => { checkStreamAbort(signal); emit({ type: 'status', phase: 'continuing' }); await engine.globalBudget(context); });
      checkStreamAbort(signal);
      if (answer.includes('本次回答尚未完整生成')) throw new Error('MODEL_STREAM_INCOMPLETE');
      emit({ type: 'status', phase: 'validating' });
      const visible = validate(withoutReasoning(answer));
      if (typeof visible === 'string' && visible.trim() && visible.length <= 12000 && visible.isWellFormed()) {
        emit({ type: 'final', data: { received: true, answer: visible, mode: general ? 'general' : 'ai', provider: 'bailian', answerMode: selectedMode } });
        return;
      }
    }
    throw new Error('MODEL_STREAM_VALIDATION_FAILED');
  }, context.request.signal);
}
