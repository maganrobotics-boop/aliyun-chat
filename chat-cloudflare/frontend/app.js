"use strict";
import { readCourseAttachment, composeCourseMessage, confirmAttachment, recentRequestMessages } from "/assets/course-fixes-20260926b/course-chat-support.js";
let omRequestPending = false;

const KATEX_ASSET = "__KATEX_ASSET__";
let answerMathEngine = null;
let answerMathLoading = null;
let answerMathAttempts = 0;
let answerMathImportVersion = 0;
const MAX_ANSWER_MATH_ATTEMPTS = 3;

function loadAnswerMathEngine() {
  if (!KATEX_ASSET || answerMathEngine || answerMathLoading || answerMathAttempts >= MAX_ANSWER_MATH_ATTEMPTS) return;
  answerMathAttempts += 1;
  const separator = KATEX_ASSET.includes("?") ? "&" : "?";
  answerMathLoading = import(`${KATEX_ASSET}${separator}math-load=${answerMathImportVersion++}`)
    .then((module) => {
      answerMathEngine = module.default || module;
      answerMathLoading = null;
      rerenderFallbackMath();
    })
    .catch(() => {
      answerMathEngine = null;
      answerMathLoading = null;
      if (answerMathAttempts < MAX_ANSWER_MATH_ATTEMPTS) window.setTimeout(loadAnswerMathEngine, 0);
    });
}
loadAnswerMathEngine();

const STORAGE_KEY = "originmind-public-preview-conversations-v1";
// Durable history stores completed answers as content: userFacingAnswer(payload.answer).
const DEFAULT_PUBLIC_API_BASE = "";
const PUBLIC_API_BASE = typeof window.PUBLIC_API_BASE === "string" && window.PUBLIC_API_BASE.trim()
  ? window.PUBLIC_API_BASE.replace(/\/+$/u, "")
  : DEFAULT_PUBLIC_API_BASE;
const DEFAULT_SUGGESTIONS = [
  "实验室现有的机器人平台包括哪些？",
  "介绍实验室当前的主要研究方向",
  "实验室有哪些代表性成果与应用？",
  "如何与实验室开展科研合作？",
];
const HISTORY_ITEMS = [
  ["overview", "实验室主要研究什么？"],
  ["robots", "现有机器人平台"],
  ["cooperation", "科研合作方式"],
];
const MODE_COPY = {
  text: ["想了解实验室的什么？", "从已审核的实验室公开知识中检索并回答", "输入想了解的实验室问题", "文本模型"],
  voice: ["想了解实验室的什么？", "从已审核的实验室公开知识中检索并回答", "说出想了解的实验室问题", "语音模型"],
  vision: ["想了解实验室的什么？", "从已审核的实验室公开知识中检索并回答", "上传图片或描述需要识别的内容", "视觉模型"],
};

function apiUrl(path) {
  return `${PUBLIC_API_BASE}${path}`;
}

const icons = {
  chat: '<svg viewBox="0 0 24 24" fill="none"><path d="M5 5h14v11H9l-4 3V5z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/></svg>',
  plus: '<svg viewBox="0 0 24 24" fill="none"><path d="M12 5v14M5 12h14" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
  text: '<svg viewBox="0 0 24 24" fill="none"><path d="M5 5h14v11H9l-4 3V5z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><path d="M9 9h6M9 12h4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>',
  voice: '<svg viewBox="0 0 24 24" fill="none"><rect x="9" y="3" width="6" height="11" rx="3" stroke="currentColor" stroke-width="1.7"/><path d="M6.5 11.5a5.5 5.5 0 0011 0M12 17v4M9 21h6" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>',
  vision: '<svg viewBox="0 0 24 24" fill="none"><rect x="4" y="5" width="16" height="14" rx="2" stroke="currentColor" stroke-width="1.5"/><path d="m7 16 3.5-4 2.6 3 1.7-2 2.2 3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><circle cx="9" cy="9" r="1" fill="currentColor"/></svg>',
  file: '<svg viewBox="0 0 24 24" fill="none"><path d="M6 3h9l4 4v14H6a2 2 0 01-2-2V5a2 2 0 012-2z" stroke="currentColor" stroke-width="1.5"/><path d="M15 3v5h5M8 12h8M8 16h6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>',
  chart: '<svg viewBox="0 0 24 24" fill="none"><path d="M4 19V9m5 10V5m5 14v-7m5 7V3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>',
  pen: '<svg viewBox="0 0 24 24" fill="none"><path d="m4 17 10-10 3 3L7 20H4v-3zM13 8l3 3m2-7 2 2" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  paperclip: '<svg viewBox="0 0 24 24" fill="none"><path d="M8.5 12.5l5.8-5.8a3 3 0 114.2 4.2l-7.9 7.9a5 5 0 11-7.1-7.1l8.2-8.2" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>',
  send: '<svg viewBox="0 0 24 24" fill="none"><path d="M12 18V6m0 0-4 4m4-4 4 4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  cube: '<svg viewBox="0 0 24 24" fill="none"><path d="M12 3l7 4v10l-7 4-7-4V7l7-4z" stroke="currentColor" stroke-width="1.5"/><path d="m9 12 2 2 4-5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  gear: '<svg viewBox="0 0 24 24" fill="none"><path d="M12 3l7.5 4.5v9L12 21l-7.5-4.5v-9L12 3z" stroke="currentColor" stroke-width="1.5"/><circle cx="12" cy="12" r="3" stroke="currentColor" stroke-width="1.5"/></svg>',
  chevron: '<svg viewBox="0 0 24 24" fill="none"><path d="m14 8-4 4 4 4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  login: '<svg viewBox="0 0 24 24" fill="none"><path d="M10 7V5a2 2 0 012-2h6v18h-6a2 2 0 01-2-2v-2" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><path d="M3 12h11m0 0-3-3m3 3-3 3" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  x: '<svg viewBox="0 0 24 24" fill="none"><path d="m7 7 10 10M17 7 7 17" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>',
  link: '<svg viewBox="0 0 24 24" fill="none"><path d="M10 13a5 5 0 0 0 7 0l2-2a5 5 0 0 0-7-7l-1 1" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/><path d="M14 11a5 5 0 0 0-7 0l-2 2a5 5 0 0 0 7 7l1-1" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>',
  share: '<svg viewBox="0 0 24 24" fill="none"><path d="M12 16V4m0 0-4 4m4-4 4 4M5 14v5h14v-5" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>',
};

function cleanPublicChatText(value) {
  return String(value || "").trim();
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/gu, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
}

function element(tag, options = {}, children = []) {
  const node = document.createElement(tag);
  if (options.className) node.className = options.className;
  if (options.text !== undefined) node.textContent = options.text;
  for (const [name, value] of Object.entries(options.attributes || {})) node.setAttribute(name, value);
  node.append(...children);
  return node;
}

function textButton(text, className) {
  const button = element("button", { className, text });
  button.type = "button";
  return button;
}

function icon(name) {
  const wrapper = document.createElement("span");
  wrapper.innerHTML = icons[name] || "";
  return wrapper.firstElementChild || document.createElement("span");
}

/* OriginMind safe Markdown renderer v1; Marked 17.0.5 (MIT), license in markdown-LICENSE.md. */
const omSafeMarkdown = (() => {
const module = { exports: {} }; const exports = module.exports;
/**
 * marked v17.0.5 - a markdown parser
 * Copyright (c) 2018-2026, MarkedJS. (MIT License)
 * Copyright (c) 2011-2018, Christopher Jeffrey. (MIT License)
 * https://github.com/markedjs/marked
 */

/**
 * DO NOT EDIT THIS FILE
 * The code in this file is generated from files in ./src/
 */
(function(g,f){if(typeof exports=="object"&&typeof module<"u"){module.exports=f()}else if("function"==typeof define && define.amd){define("marked",f)}else {g["marked"]=f()}}(typeof globalThis < "u" ? globalThis : typeof self < "u" ? self : this,function(){var exports={};var __exports=exports;var module={exports};
"use strict";var G=Object.defineProperty;var Re=Object.getOwnPropertyDescriptor;var Te=Object.getOwnPropertyNames;var Oe=Object.prototype.hasOwnProperty;var we=(l,e)=>{for(var t in e)G(l,t,{get:e[t],enumerable:!0})},ye=(l,e,t,n)=>{if(e&&typeof e=="object"||typeof e=="function")for(let r of Te(e))!Oe.call(l,r)&&r!==t&&G(l,r,{get:()=>e[r],enumerable:!(n=Re(e,r))||n.enumerable});return l};var Pe=l=>ye(G({},"__esModule",{value:!0}),l);var xt={};we(xt,{Hooks:()=>P,Lexer:()=>x,Marked:()=>A,Parser:()=>b,Renderer:()=>y,TextRenderer:()=>S,Tokenizer:()=>w,defaults:()=>R,getDefaults:()=>_,lexer:()=>mt,marked:()=>g,options:()=>pt,parse:()=>gt,parseInline:()=>dt,parser:()=>ft,setOptions:()=>ct,use:()=>ht,walkTokens:()=>kt});module.exports=Pe(xt);function _(){return{async:!1,breaks:!1,extensions:null,gfm:!0,hooks:null,pedantic:!1,renderer:null,silent:!1,tokenizer:null,walkTokens:null}}var R=_();function N(l){R=l}var L={exec:()=>null};function k(l,e=""){let t=typeof l=="string"?l:l.source,n={replace:(r,i)=>{let s=typeof i=="string"?i:i.source;return s=s.replace(m.caret,"$1"),t=t.replace(r,s),n},getRegex:()=>new RegExp(t,e)};return n}var Se=(()=>{try{return!!new RegExp("(?<=1)(?<!1)")}catch{return!1}})(),m={codeRemoveIndent:/^(?: {1,4}| {0,3}\t)/gm,outputLinkReplace:/\\([\[\]])/g,indentCodeCompensation:/^(\s+)(?:```)/,beginningSpace:/^\s+/,endingHash:/#$/,startingSpaceChar:/^ /,endingSpaceChar:/ $/,nonSpaceChar:/[^ ]/,newLineCharGlobal:/\n/g,tabCharGlobal:/\t/g,multipleSpaceGlobal:/\s+/g,blankLine:/^[ \t]*$/,doubleBlankLine:/\n[ \t]*\n[ \t]*$/,blockquoteStart:/^ {0,3}>/,blockquoteSetextReplace:/\n {0,3}((?:=+|-+) *)(?=\n|$)/g,blockquoteSetextReplace2:/^ {0,3}>[ \t]?/gm,listReplaceNesting:/^ {1,4}(?=( {4})*[^ ])/g,listIsTask:/^\[[ xX]\] +\S/,listReplaceTask:/^\[[ xX]\] +/,listTaskCheckbox:/\[[ xX]\]/,anyLine:/\n.*\n/,hrefBrackets:/^<(.*)>$/,tableDelimiter:/[:|]/,tableAlignChars:/^\||\| *$/g,tableRowBlankLine:/\n[ \t]*$/,tableAlignRight:/^ *-+: *$/,tableAlignCenter:/^ *:-+: *$/,tableAlignLeft:/^ *:-+ *$/,startATag:/^<a /i,endATag:/^<\/a>/i,startPreScriptTag:/^<(pre|code|kbd|script)(\s|>)/i,endPreScriptTag:/^<\/(pre|code|kbd|script)(\s|>)/i,startAngleBracket:/^</,endAngleBracket:/>$/,pedanticHrefTitle:/^([^'"]*[^\s])\s+(['"])(.*)\2/,unicodeAlphaNumeric:/[\p{L}\p{N}]/u,escapeTest:/[&<>"']/,escapeReplace:/[&<>"']/g,escapeTestNoEncode:/[<>"']|&(?!(#\d{1,7}|#[Xx][a-fA-F0-9]{1,6}|\w+);)/,escapeReplaceNoEncode:/[<>"']|&(?!(#\d{1,7}|#[Xx][a-fA-F0-9]{1,6}|\w+);)/g,caret:/(^|[^\[])\^/g,percentDecode:/%25/g,findPipe:/\|/g,splitPipe:/ \|/,slashPipe:/\\\|/g,carriageReturn:/\r\n|\r/g,spaceLine:/^ +$/gm,notSpaceStart:/^\S*/,endingNewline:/\n$/,listItemRegex:l=>new RegExp(`^( {0,3}${l})((?:[	 ][^\\n]*)?(?:\\n|$))`),nextBulletRegex:l=>new RegExp(`^ {0,${Math.min(3,l-1)}}(?:[*+-]|\\d{1,9}[.)])((?:[ 	][^\\n]*)?(?:\\n|$))`),hrRegex:l=>new RegExp(`^ {0,${Math.min(3,l-1)}}((?:- *){3,}|(?:_ *){3,}|(?:\\* *){3,})(?:\\n+|$)`),fencesBeginRegex:l=>new RegExp(`^ {0,${Math.min(3,l-1)}}(?:\`\`\`|~~~)`),headingBeginRegex:l=>new RegExp(`^ {0,${Math.min(3,l-1)}}#`),htmlBeginRegex:l=>new RegExp(`^ {0,${Math.min(3,l-1)}}<(?:[a-z].*>|!--)`,"i"),blockquoteBeginRegex:l=>new RegExp(`^ {0,${Math.min(3,l-1)}}>`)},$e=/^(?:[ \t]*(?:\n|$))+/,_e=/^((?: {4}| {0,3}\t)[^\n]+(?:\n(?:[ \t]*(?:\n|$))*)?)+/,Le=/^ {0,3}(`{3,}(?=[^`\n]*(?:\n|$))|~{3,})([^\n]*)(?:\n|$)(?:|([\s\S]*?)(?:\n|$))(?: {0,3}\1[~`]* *(?=\n|$)|$)/,B=/^ {0,3}((?:-[\t ]*){3,}|(?:_[ \t]*){3,}|(?:\*[ \t]*){3,})(?:\n+|$)/,Me=/^ {0,3}(#{1,6})(?=\s|$)(.*)(?:\n+|$)/,j=/ {0,3}(?:[*+-]|\d{1,9}[.)])/,ie=/^(?!bull |blockCode|fences|blockquote|heading|html|table)((?:.|\n(?!\s*?\n|bull |blockCode|fences|blockquote|heading|html|table))+?)\n {0,3}(=+|-+) *(?:\n+|$)/,oe=k(ie).replace(/bull/g,j).replace(/blockCode/g,/(?: {4}| {0,3}\t)/).replace(/fences/g,/ {0,3}(?:`{3,}|~{3,})/).replace(/blockquote/g,/ {0,3}>/).replace(/heading/g,/ {0,3}#{1,6}/).replace(/html/g,/ {0,3}<[^\n>]+>\n/).replace(/\|table/g,"").getRegex(),ze=k(ie).replace(/bull/g,j).replace(/blockCode/g,/(?: {4}| {0,3}\t)/).replace(/fences/g,/ {0,3}(?:`{3,}|~{3,})/).replace(/blockquote/g,/ {0,3}>/).replace(/heading/g,/ {0,3}#{1,6}/).replace(/html/g,/ {0,3}<[^\n>]+>\n/).replace(/table/g,/ {0,3}\|?(?:[:\- ]*\|)+[\:\- ]*\n/).getRegex(),F=/^([^\n]+(?:\n(?!hr|heading|lheading|blockquote|fences|list|html|table| +\n)[^\n]+)*)/,Ee=/^[^\n]+/,U=/(?!\s*\])(?:\\[\s\S]|[^\[\]\\])+/,Ie=k(/^ {0,3}\[(label)\]: *(?:\n[ \t]*)?([^<\s][^\s]*|<.*?>)(?:(?: +(?:\n[ \t]*)?| *\n[ \t]*)(title))? *(?:\n+|$)/).replace("label",U).replace("title",/(?:"(?:\\"?|[^"\\])*"|'[^'\n]*(?:\n[^'\n]+)*\n?'|\([^()]*\))/).getRegex(),Ae=k(/^(bull)([ \t][^\n]+?)?(?:\n|$)/).replace(/bull/g,j).getRegex(),v="address|article|aside|base|basefont|blockquote|body|caption|center|col|colgroup|dd|details|dialog|dir|div|dl|dt|fieldset|figcaption|figure|footer|form|frame|frameset|h[1-6]|head|header|hr|html|iframe|legend|li|link|main|menu|menuitem|meta|nav|noframes|ol|optgroup|option|p|param|search|section|summary|table|tbody|td|tfoot|th|thead|title|tr|track|ul",K=/<!--(?:-?>|[\s\S]*?(?:-->|$))/,Ce=k("^ {0,3}(?:<(script|pre|style|textarea)[\\s>][\\s\\S]*?(?:</\\1>[^\\n]*\\n+|$)|comment[^\\n]*(\\n+|$)|<\\?[\\s\\S]*?(?:\\?>\\n*|$)|<![A-Z][\\s\\S]*?(?:>\\n*|$)|<!\\[CDATA\\[[\\s\\S]*?(?:\\]\\]>\\n*|$)|</?(tag)(?: +|\\n|/?>)[\\s\\S]*?(?:(?:\\n[ 	]*)+\\n|$)|<(?!script|pre|style|textarea)([a-z][\\w-]*)(?:attribute)*? */?>(?=[ \\t]*(?:\\n|$))[\\s\\S]*?(?:(?:\\n[ 	]*)+\\n|$)|</(?!script|pre|style|textarea)[a-z][\\w-]*\\s*>(?=[ \\t]*(?:\\n|$))[\\s\\S]*?(?:(?:\\n[ 	]*)+\\n|$))","i").replace("comment",K).replace("tag",v).replace("attribute",/ +[a-zA-Z:_][\w.:-]*(?: *= *"[^"\n]*"| *= *'[^'\n]*'| *= *[^\s"'=<>`]+)?/).getRegex(),ae=k(F).replace("hr",B).replace("heading"," {0,3}#{1,6}(?:\\s|$)").replace("|lheading","").replace("|table","").replace("blockquote"," {0,3}>").replace("fences"," {0,3}(?:`{3,}(?=[^`\\n]*\\n)|~{3,})[^\\n]*\\n").replace("list"," {0,3}(?:[*+-]|1[.)])[ \\t]").replace("html","</?(?:tag)(?: +|\\n|/?>)|<(?:script|pre|style|textarea|!--)").replace("tag",v).getRegex(),Be=k(/^( {0,3}> ?(paragraph|[^\n]*)(?:\n|$))+/).replace("paragraph",ae).getRegex(),W={blockquote:Be,code:_e,def:Ie,fences:Le,heading:Me,hr:B,html:Ce,lheading:oe,list:Ae,newline:$e,paragraph:ae,table:L,text:Ee},re=k("^ *([^\\n ].*)\\n {0,3}((?:\\| *)?:?-+:? *(?:\\| *:?-+:? *)*(?:\\| *)?)(?:\\n((?:(?! *\\n|hr|heading|blockquote|code|fences|list|html).*(?:\\n|$))*)\\n*|$)").replace("hr",B).replace("heading"," {0,3}#{1,6}(?:\\s|$)").replace("blockquote"," {0,3}>").replace("code","(?: {4}| {0,3}	)[^\\n]").replace("fences"," {0,3}(?:`{3,}(?=[^`\\n]*\\n)|~{3,})[^\\n]*\\n").replace("list"," {0,3}(?:[*+-]|1[.)])[ \\t]").replace("html","</?(?:tag)(?: +|\\n|/?>)|<(?:script|pre|style|textarea|!--)").replace("tag",v).getRegex(),De={...W,lheading:ze,table:re,paragraph:k(F).replace("hr",B).replace("heading"," {0,3}#{1,6}(?:\\s|$)").replace("|lheading","").replace("table",re).replace("blockquote"," {0,3}>").replace("fences"," {0,3}(?:`{3,}(?=[^`\\n]*\\n)|~{3,})[^\\n]*\\n").replace("list"," {0,3}(?:[*+-]|1[.)])[ \\t]").replace("html","</?(?:tag)(?: +|\\n|/?>)|<(?:script|pre|style|textarea|!--)").replace("tag",v).getRegex()},qe={...W,html:k(`^ *(?:comment *(?:\\n|\\s*$)|<(tag)[\\s\\S]+?</\\1> *(?:\\n{2,}|\\s*$)|<tag(?:"[^"]*"|'[^']*'|\\s[^'"/>\\s]*)*?/?> *(?:\\n{2,}|\\s*$))`).replace("comment",K).replace(/tag/g,"(?!(?:a|em|strong|small|s|cite|q|dfn|abbr|data|time|code|var|samp|kbd|sub|sup|i|b|u|mark|ruby|rt|rp|bdi|bdo|span|br|wbr|ins|del|img)\\b)\\w+(?!:|[^\\w\\s@]*@)\\b").getRegex(),def:/^ *\[([^\]]+)\]: *<?([^\s>]+)>?(?: +(["(][^\n]+[")]))? *(?:\n+|$)/,heading:/^(#{1,6})(.*)(?:\n+|$)/,fences:L,lheading:/^(.+?)\n {0,3}(=+|-+) *(?:\n+|$)/,paragraph:k(F).replace("hr",B).replace("heading",` *#{1,6} *[^
]`).replace("lheading",oe).replace("|table","").replace("blockquote"," {0,3}>").replace("|fences","").replace("|list","").replace("|html","").replace("|tag","").getRegex()},ve=/^\\([!"#$%&'()*+,\-./:;<=>?@\[\]\\^_`{|}~])/,He=/^(`+)([^`]|[^`][\s\S]*?[^`])\1(?!`)/,le=/^( {2,}|\\)\n(?!\s*$)/,Ze=/^(`+|[^`])(?:(?= {2,}\n)|[\s\S]*?(?:(?=[\\<!\[`*_]|\b_|$)|[^ ](?= {2,}\n)))/,z=/[\p{P}\p{S}]/u,H=/[\s\p{P}\p{S}]/u,X=/[^\s\p{P}\p{S}]/u,Ge=k(/^((?![*_])punctSpace)/,"u").replace(/punctSpace/g,H).getRegex(),ue=/(?!~)[\p{P}\p{S}]/u,Ne=/(?!~)[\s\p{P}\p{S}]/u,Qe=/(?:[^\s\p{P}\p{S}]|~)/u,je=k(/link|precode-code|html/,"g").replace("link",/\[(?:[^\[\]`]|(?<a>`+)[^`]+\k<a>(?!`))*?\]\((?:\\[\s\S]|[^\\\(\)]|\((?:\\[\s\S]|[^\\\(\)])*\))*\)/).replace("precode-",Se?"(?<!`)()":"(^^|[^`])").replace("code",/(?<b>`+)[^`]+\k<b>(?!`)/).replace("html",/<(?! )[^<>]*?>/).getRegex(),pe=/^(?:\*+(?:((?!\*)punct)|([^\s*]))?)|^_+(?:((?!_)punct)|([^\s_]))?/,Fe=k(pe,"u").replace(/punct/g,z).getRegex(),Ue=k(pe,"u").replace(/punct/g,ue).getRegex(),ce="^[^_*]*?__[^_*]*?\\*[^_*]*?(?=__)|[^*]+(?=[^*])|(?!\\*)punct(\\*+)(?=[\\s]|$)|notPunctSpace(\\*+)(?!\\*)(?=punctSpace|$)|(?!\\*)punctSpace(\\*+)(?=notPunctSpace)|[\\s](\\*+)(?!\\*)(?=punct)|(?!\\*)punct(\\*+)(?!\\*)(?=punct)|notPunctSpace(\\*+)(?=notPunctSpace)",Ke=k(ce,"gu").replace(/notPunctSpace/g,X).replace(/punctSpace/g,H).replace(/punct/g,z).getRegex(),We=k(ce,"gu").replace(/notPunctSpace/g,Qe).replace(/punctSpace/g,Ne).replace(/punct/g,ue).getRegex(),Xe=k("^[^_*]*?\\*\\*[^_*]*?_[^_*]*?(?=\\*\\*)|[^_]+(?=[^_])|(?!_)punct(_+)(?=[\\s]|$)|notPunctSpace(_+)(?!_)(?=punctSpace|$)|(?!_)punctSpace(_+)(?=notPunctSpace)|[\\s](_+)(?!_)(?=punct)|(?!_)punct(_+)(?!_)(?=punct)","gu").replace(/notPunctSpace/g,X).replace(/punctSpace/g,H).replace(/punct/g,z).getRegex(),Je=k(/^~~?(?:((?!~)punct)|[^\s~])/,"u").replace(/punct/g,z).getRegex(),Ve="^[^~]+(?=[^~])|(?!~)punct(~~?)(?=[\\s]|$)|notPunctSpace(~~?)(?!~)(?=punctSpace|$)|(?!~)punctSpace(~~?)(?=notPunctSpace)|[\\s](~~?)(?!~)(?=punct)|(?!~)punct(~~?)(?!~)(?=punct)|notPunctSpace(~~?)(?=notPunctSpace)",Ye=k(Ve,"gu").replace(/notPunctSpace/g,X).replace(/punctSpace/g,H).replace(/punct/g,z).getRegex(),et=k(/\\(punct)/,"gu").replace(/punct/g,z).getRegex(),tt=k(/^<(scheme:[^\s\x00-\x1f<>]*|email)>/).replace("scheme",/[a-zA-Z][a-zA-Z0-9+.-]{1,31}/).replace("email",/[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+(@)[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+(?![-_])/).getRegex(),nt=k(K).replace("(?:-->|$)","-->").getRegex(),rt=k("^comment|^</[a-zA-Z][\\w:-]*\\s*>|^<[a-zA-Z][\\w-]*(?:attribute)*?\\s*/?>|^<\\?[\\s\\S]*?\\?>|^<![a-zA-Z]+\\s[\\s\\S]*?>|^<!\\[CDATA\\[[\\s\\S]*?\\]\\]>").replace("comment",nt).replace("attribute",/\s+[a-zA-Z:_][\w.:-]*(?:\s*=\s*"[^"]*"|\s*=\s*'[^']*'|\s*=\s*[^\s"'=<>`]+)?/).getRegex(),q=/(?:\[(?:\\[\s\S]|[^\[\]\\])*\]|\\[\s\S]|`+(?!`)[^`]*?`+(?!`)|``+(?=\])|[^\[\]\\`])*?/,st=k(/^!?\[(label)\]\(\s*(href)(?:(?:[ \t]+(?:\n[ \t]*)?|\n[ \t]*)(title))?\s*\)/).replace("label",q).replace("href",/<(?:\\.|[^\n<>\\])+>|[^ \t\n\x00-\x1f]*/).replace("title",/"(?:\\"?|[^"\\])*"|'(?:\\'?|[^'\\])*'|\((?:\\\)?|[^)\\])*\)/).getRegex(),he=k(/^!?\[(label)\]\[(ref)\]/).replace("label",q).replace("ref",U).getRegex(),ke=k(/^!?\[(ref)\](?:\[\])?/).replace("ref",U).getRegex(),it=k("reflink|nolink(?!\\()","g").replace("reflink",he).replace("nolink",ke).getRegex(),se=/[hH][tT][tT][pP][sS]?|[fF][tT][pP]/,J={_backpedal:L,anyPunctuation:et,autolink:tt,blockSkip:je,br:le,code:He,del:L,delLDelim:L,delRDelim:L,emStrongLDelim:Fe,emStrongRDelimAst:Ke,emStrongRDelimUnd:Xe,escape:ve,link:st,nolink:ke,punctuation:Ge,reflink:he,reflinkSearch:it,tag:rt,text:Ze,url:L},ot={...J,link:k(/^!?\[(label)\]\((.*?)\)/).replace("label",q).getRegex(),reflink:k(/^!?\[(label)\]\s*\[([^\]]*)\]/).replace("label",q).getRegex()},Q={...J,emStrongRDelimAst:We,emStrongLDelim:Ue,delLDelim:Je,delRDelim:Ye,url:k(/^((?:protocol):\/\/|www\.)(?:[a-zA-Z0-9\-]+\.?)+[^\s<]*|^email/).replace("protocol",se).replace("email",/[A-Za-z0-9._+-]+(@)[a-zA-Z0-9-_]+(?:\.[a-zA-Z0-9-_]*[a-zA-Z0-9])+(?![-_])/).getRegex(),_backpedal:/(?:[^?!.,:;*_'"~()&]+|\([^)]*\)|&(?![a-zA-Z0-9]+;$)|[?!.,:;*_'"~)]+(?!$))+/,del:/^(~~?)(?=[^\s~])((?:\\[\s\S]|[^\\])*?(?:\\[\s\S]|[^\s~\\]))\1(?=[^~]|$)/,text:k(/^([`~]+|[^`~])(?:(?= {2,}\n)|(?=[a-zA-Z0-9.!#$%&'*+\/=?_`{\|}~-]+@)|[\s\S]*?(?:(?=[\\<!\[`*~_]|\b_|protocol:\/\/|www\.|$)|[^ ](?= {2,}\n)|[^a-zA-Z0-9.!#$%&'*+\/=?_`{\|}~-](?=[a-zA-Z0-9.!#$%&'*+\/=?_`{\|}~-]+@)))/).replace("protocol",se).getRegex()},at={...Q,br:k(le).replace("{2,}","*").getRegex(),text:k(Q.text).replace("\\b_","\\b_| {2,}\\n").replace(/\{2,\}/g,"*").getRegex()},D={normal:W,gfm:De,pedantic:qe},E={normal:J,gfm:Q,breaks:at,pedantic:ot};var lt={"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"},de=l=>lt[l];function O(l,e){if(e){if(m.escapeTest.test(l))return l.replace(m.escapeReplace,de)}else if(m.escapeTestNoEncode.test(l))return l.replace(m.escapeReplaceNoEncode,de);return l}function V(l){try{l=encodeURI(l).replace(m.percentDecode,"%")}catch{return null}return l}function Y(l,e){let t=l.replace(m.findPipe,(i,s,a)=>{let o=!1,u=s;for(;--u>=0&&a[u]==="\\";)o=!o;return o?"|":" |"}),n=t.split(m.splitPipe),r=0;if(n[0].trim()||n.shift(),n.length>0&&!n.at(-1)?.trim()&&n.pop(),e)if(n.length>e)n.splice(e);else for(;n.length<e;)n.push("");for(;r<n.length;r++)n[r]=n[r].trim().replace(m.slashPipe,"|");return n}function I(l,e,t){let n=l.length;if(n===0)return"";let r=0;for(;r<n;){let i=l.charAt(n-r-1);if(i===e&&!t)r++;else if(i!==e&&t)r++;else break}return l.slice(0,n-r)}function ge(l,e){if(l.indexOf(e[1])===-1)return-1;let t=0;for(let n=0;n<l.length;n++)if(l[n]==="\\")n++;else if(l[n]===e[0])t++;else if(l[n]===e[1]&&(t--,t<0))return n;return t>0?-2:-1}function fe(l,e=0){let t=e,n="";for(let r of l)if(r==="	"){let i=4-t%4;n+=" ".repeat(i),t+=i}else n+=r,t++;return n}function me(l,e,t,n,r){let i=e.href,s=e.title||null,a=l[1].replace(r.other.outputLinkReplace,"$1");n.state.inLink=!0;let o={type:l[0].charAt(0)==="!"?"image":"link",raw:t,href:i,title:s,text:a,tokens:n.inlineTokens(a)};return n.state.inLink=!1,o}function ut(l,e,t){let n=l.match(t.other.indentCodeCompensation);if(n===null)return e;let r=n[1];return e.split(`
`).map(i=>{let s=i.match(t.other.beginningSpace);if(s===null)return i;let[a]=s;return a.length>=r.length?i.slice(r.length):i}).join(`
`)}var w=class{options;rules;lexer;constructor(e){this.options=e||R}space(e){let t=this.rules.block.newline.exec(e);if(t&&t[0].length>0)return{type:"space",raw:t[0]}}code(e){let t=this.rules.block.code.exec(e);if(t){let n=t[0].replace(this.rules.other.codeRemoveIndent,"");return{type:"code",raw:t[0],codeBlockStyle:"indented",text:this.options.pedantic?n:I(n,`
`)}}}fences(e){let t=this.rules.block.fences.exec(e);if(t){let n=t[0],r=ut(n,t[3]||"",this.rules);return{type:"code",raw:n,lang:t[2]?t[2].trim().replace(this.rules.inline.anyPunctuation,"$1"):t[2],text:r}}}heading(e){let t=this.rules.block.heading.exec(e);if(t){let n=t[2].trim();if(this.rules.other.endingHash.test(n)){let r=I(n,"#");(this.options.pedantic||!r||this.rules.other.endingSpaceChar.test(r))&&(n=r.trim())}return{type:"heading",raw:t[0],depth:t[1].length,text:n,tokens:this.lexer.inline(n)}}}hr(e){let t=this.rules.block.hr.exec(e);if(t)return{type:"hr",raw:I(t[0],`
`)}}blockquote(e){let t=this.rules.block.blockquote.exec(e);if(t){let n=I(t[0],`
`).split(`
`),r="",i="",s=[];for(;n.length>0;){let a=!1,o=[],u;for(u=0;u<n.length;u++)if(this.rules.other.blockquoteStart.test(n[u]))o.push(n[u]),a=!0;else if(!a)o.push(n[u]);else break;n=n.slice(u);let p=o.join(`
`),c=p.replace(this.rules.other.blockquoteSetextReplace,`
    $1`).replace(this.rules.other.blockquoteSetextReplace2,"");r=r?`${r}
${p}`:p,i=i?`${i}
${c}`:c;let d=this.lexer.state.top;if(this.lexer.state.top=!0,this.lexer.blockTokens(c,s,!0),this.lexer.state.top=d,n.length===0)break;let h=s.at(-1);if(h?.type==="code")break;if(h?.type==="blockquote"){let T=h,f=T.raw+`
`+n.join(`
`),$=this.blockquote(f);s[s.length-1]=$,r=r.substring(0,r.length-T.raw.length)+$.raw,i=i.substring(0,i.length-T.text.length)+$.text;break}else if(h?.type==="list"){let T=h,f=T.raw+`
`+n.join(`
`),$=this.list(f);s[s.length-1]=$,r=r.substring(0,r.length-h.raw.length)+$.raw,i=i.substring(0,i.length-T.raw.length)+$.raw,n=f.substring(s.at(-1).raw.length).split(`
`);continue}}return{type:"blockquote",raw:r,tokens:s,text:i}}}list(e){let t=this.rules.block.list.exec(e);if(t){let n=t[1].trim(),r=n.length>1,i={type:"list",raw:"",ordered:r,start:r?+n.slice(0,-1):"",loose:!1,items:[]};n=r?`\\d{1,9}\\${n.slice(-1)}`:`\\${n}`,this.options.pedantic&&(n=r?n:"[*+-]");let s=this.rules.other.listItemRegex(n),a=!1;for(;e;){let u=!1,p="",c="";if(!(t=s.exec(e))||this.rules.block.hr.test(e))break;p=t[0],e=e.substring(p.length);let d=fe(t[2].split(`
`,1)[0],t[1].length),h=e.split(`
`,1)[0],T=!d.trim(),f=0;if(this.options.pedantic?(f=2,c=d.trimStart()):T?f=t[1].length+1:(f=d.search(this.rules.other.nonSpaceChar),f=f>4?1:f,c=d.slice(f),f+=t[1].length),T&&this.rules.other.blankLine.test(h)&&(p+=h+`
`,e=e.substring(h.length+1),u=!0),!u){let $=this.rules.other.nextBulletRegex(f),ee=this.rules.other.hrRegex(f),te=this.rules.other.fencesBeginRegex(f),ne=this.rules.other.headingBeginRegex(f),xe=this.rules.other.htmlBeginRegex(f),be=this.rules.other.blockquoteBeginRegex(f);for(;e;){let Z=e.split(`
`,1)[0],C;if(h=Z,this.options.pedantic?(h=h.replace(this.rules.other.listReplaceNesting,"  "),C=h):C=h.replace(this.rules.other.tabCharGlobal,"    "),te.test(h)||ne.test(h)||xe.test(h)||be.test(h)||$.test(h)||ee.test(h))break;if(C.search(this.rules.other.nonSpaceChar)>=f||!h.trim())c+=`
`+C.slice(f);else{if(T||d.replace(this.rules.other.tabCharGlobal,"    ").search(this.rules.other.nonSpaceChar)>=4||te.test(d)||ne.test(d)||ee.test(d))break;c+=`
`+h}T=!h.trim(),p+=Z+`
`,e=e.substring(Z.length+1),d=C.slice(f)}}i.loose||(a?i.loose=!0:this.rules.other.doubleBlankLine.test(p)&&(a=!0)),i.items.push({type:"list_item",raw:p,task:!!this.options.gfm&&this.rules.other.listIsTask.test(c),loose:!1,text:c,tokens:[]}),i.raw+=p}let o=i.items.at(-1);if(o)o.raw=o.raw.trimEnd(),o.text=o.text.trimEnd();else return;i.raw=i.raw.trimEnd();for(let u of i.items){if(this.lexer.state.top=!1,u.tokens=this.lexer.blockTokens(u.text,[]),u.task){if(u.text=u.text.replace(this.rules.other.listReplaceTask,""),u.tokens[0]?.type==="text"||u.tokens[0]?.type==="paragraph"){u.tokens[0].raw=u.tokens[0].raw.replace(this.rules.other.listReplaceTask,""),u.tokens[0].text=u.tokens[0].text.replace(this.rules.other.listReplaceTask,"");for(let c=this.lexer.inlineQueue.length-1;c>=0;c--)if(this.rules.other.listIsTask.test(this.lexer.inlineQueue[c].src)){this.lexer.inlineQueue[c].src=this.lexer.inlineQueue[c].src.replace(this.rules.other.listReplaceTask,"");break}}let p=this.rules.other.listTaskCheckbox.exec(u.raw);if(p){let c={type:"checkbox",raw:p[0]+" ",checked:p[0]!=="[ ]"};u.checked=c.checked,i.loose?u.tokens[0]&&["paragraph","text"].includes(u.tokens[0].type)&&"tokens"in u.tokens[0]&&u.tokens[0].tokens?(u.tokens[0].raw=c.raw+u.tokens[0].raw,u.tokens[0].text=c.raw+u.tokens[0].text,u.tokens[0].tokens.unshift(c)):u.tokens.unshift({type:"paragraph",raw:c.raw,text:c.raw,tokens:[c]}):u.tokens.unshift(c)}}if(!i.loose){let p=u.tokens.filter(d=>d.type==="space"),c=p.length>0&&p.some(d=>this.rules.other.anyLine.test(d.raw));i.loose=c}}if(i.loose)for(let u of i.items){u.loose=!0;for(let p of u.tokens)p.type==="text"&&(p.type="paragraph")}return i}}html(e){let t=this.rules.block.html.exec(e);if(t)return{type:"html",block:!0,raw:t[0],pre:t[1]==="pre"||t[1]==="script"||t[1]==="style",text:t[0]}}def(e){let t=this.rules.block.def.exec(e);if(t){let n=t[1].toLowerCase().replace(this.rules.other.multipleSpaceGlobal," "),r=t[2]?t[2].replace(this.rules.other.hrefBrackets,"$1").replace(this.rules.inline.anyPunctuation,"$1"):"",i=t[3]?t[3].substring(1,t[3].length-1).replace(this.rules.inline.anyPunctuation,"$1"):t[3];return{type:"def",tag:n,raw:t[0],href:r,title:i}}}table(e){let t=this.rules.block.table.exec(e);if(!t||!this.rules.other.tableDelimiter.test(t[2]))return;let n=Y(t[1]),r=t[2].replace(this.rules.other.tableAlignChars,"").split("|"),i=t[3]?.trim()?t[3].replace(this.rules.other.tableRowBlankLine,"").split(`
`):[],s={type:"table",raw:t[0],header:[],align:[],rows:[]};if(n.length===r.length){for(let a of r)this.rules.other.tableAlignRight.test(a)?s.align.push("right"):this.rules.other.tableAlignCenter.test(a)?s.align.push("center"):this.rules.other.tableAlignLeft.test(a)?s.align.push("left"):s.align.push(null);for(let a=0;a<n.length;a++)s.header.push({text:n[a],tokens:this.lexer.inline(n[a]),header:!0,align:s.align[a]});for(let a of i)s.rows.push(Y(a,s.header.length).map((o,u)=>({text:o,tokens:this.lexer.inline(o),header:!1,align:s.align[u]})));return s}}lheading(e){let t=this.rules.block.lheading.exec(e);if(t){let n=t[1].trim();return{type:"heading",raw:t[0],depth:t[2].charAt(0)==="="?1:2,text:n,tokens:this.lexer.inline(n)}}}paragraph(e){let t=this.rules.block.paragraph.exec(e);if(t){let n=t[1].charAt(t[1].length-1)===`
`?t[1].slice(0,-1):t[1];return{type:"paragraph",raw:t[0],text:n,tokens:this.lexer.inline(n)}}}text(e){let t=this.rules.block.text.exec(e);if(t)return{type:"text",raw:t[0],text:t[0],tokens:this.lexer.inline(t[0])}}escape(e){let t=this.rules.inline.escape.exec(e);if(t)return{type:"escape",raw:t[0],text:t[1]}}tag(e){let t=this.rules.inline.tag.exec(e);if(t)return!this.lexer.state.inLink&&this.rules.other.startATag.test(t[0])?this.lexer.state.inLink=!0:this.lexer.state.inLink&&this.rules.other.endATag.test(t[0])&&(this.lexer.state.inLink=!1),!this.lexer.state.inRawBlock&&this.rules.other.startPreScriptTag.test(t[0])?this.lexer.state.inRawBlock=!0:this.lexer.state.inRawBlock&&this.rules.other.endPreScriptTag.test(t[0])&&(this.lexer.state.inRawBlock=!1),{type:"html",raw:t[0],inLink:this.lexer.state.inLink,inRawBlock:this.lexer.state.inRawBlock,block:!1,text:t[0]}}link(e){let t=this.rules.inline.link.exec(e);if(t){let n=t[2].trim();if(!this.options.pedantic&&this.rules.other.startAngleBracket.test(n)){if(!this.rules.other.endAngleBracket.test(n))return;let s=I(n.slice(0,-1),"\\");if((n.length-s.length)%2===0)return}else{let s=ge(t[2],"()");if(s===-2)return;if(s>-1){let o=(t[0].indexOf("!")===0?5:4)+t[1].length+s;t[2]=t[2].substring(0,s),t[0]=t[0].substring(0,o).trim(),t[3]=""}}let r=t[2],i="";if(this.options.pedantic){let s=this.rules.other.pedanticHrefTitle.exec(r);s&&(r=s[1],i=s[3])}else i=t[3]?t[3].slice(1,-1):"";return r=r.trim(),this.rules.other.startAngleBracket.test(r)&&(this.options.pedantic&&!this.rules.other.endAngleBracket.test(n)?r=r.slice(1):r=r.slice(1,-1)),me(t,{href:r&&r.replace(this.rules.inline.anyPunctuation,"$1"),title:i&&i.replace(this.rules.inline.anyPunctuation,"$1")},t[0],this.lexer,this.rules)}}reflink(e,t){let n;if((n=this.rules.inline.reflink.exec(e))||(n=this.rules.inline.nolink.exec(e))){let r=(n[2]||n[1]).replace(this.rules.other.multipleSpaceGlobal," "),i=t[r.toLowerCase()];if(!i){let s=n[0].charAt(0);return{type:"text",raw:s,text:s}}return me(n,i,n[0],this.lexer,this.rules)}}emStrong(e,t,n=""){let r=this.rules.inline.emStrongLDelim.exec(e);if(!r||!r[1]&&!r[2]&&!r[3]&&!r[4]||r[4]&&n.match(this.rules.other.unicodeAlphaNumeric))return;if(!(r[1]||r[3]||"")||!n||this.rules.inline.punctuation.exec(n)){let s=[...r[0]].length-1,a,o,u=s,p=0,c=r[0][0]==="*"?this.rules.inline.emStrongRDelimAst:this.rules.inline.emStrongRDelimUnd;for(c.lastIndex=0,t=t.slice(-1*e.length+s);(r=c.exec(t))!=null;){if(a=r[1]||r[2]||r[3]||r[4]||r[5]||r[6],!a)continue;if(o=[...a].length,r[3]||r[4]){u+=o;continue}else if((r[5]||r[6])&&s%3&&!((s+o)%3)){p+=o;continue}if(u-=o,u>0)continue;o=Math.min(o,o+u+p);let d=[...r[0]][0].length,h=e.slice(0,s+r.index+d+o);if(Math.min(s,o)%2){let f=h.slice(1,-1);return{type:"em",raw:h,text:f,tokens:this.lexer.inlineTokens(f)}}let T=h.slice(2,-2);return{type:"strong",raw:h,text:T,tokens:this.lexer.inlineTokens(T)}}}}codespan(e){let t=this.rules.inline.code.exec(e);if(t){let n=t[2].replace(this.rules.other.newLineCharGlobal," "),r=this.rules.other.nonSpaceChar.test(n),i=this.rules.other.startingSpaceChar.test(n)&&this.rules.other.endingSpaceChar.test(n);return r&&i&&(n=n.substring(1,n.length-1)),{type:"codespan",raw:t[0],text:n}}}br(e){let t=this.rules.inline.br.exec(e);if(t)return{type:"br",raw:t[0]}}del(e,t,n=""){let r=this.rules.inline.delLDelim.exec(e);if(!r)return;if(!(r[1]||"")||!n||this.rules.inline.punctuation.exec(n)){let s=[...r[0]].length-1,a,o,u=s,p=this.rules.inline.delRDelim;for(p.lastIndex=0,t=t.slice(-1*e.length+s);(r=p.exec(t))!=null;){if(a=r[1]||r[2]||r[3]||r[4]||r[5]||r[6],!a||(o=[...a].length,o!==s))continue;if(r[3]||r[4]){u+=o;continue}if(u-=o,u>0)continue;o=Math.min(o,o+u);let c=[...r[0]][0].length,d=e.slice(0,s+r.index+c+o),h=d.slice(s,-s);return{type:"del",raw:d,text:h,tokens:this.lexer.inlineTokens(h)}}}}autolink(e){let t=this.rules.inline.autolink.exec(e);if(t){let n,r;return t[2]==="@"?(n=t[1],r="mailto:"+n):(n=t[1],r=n),{type:"link",raw:t[0],text:n,href:r,tokens:[{type:"text",raw:n,text:n}]}}}url(e){let t;if(t=this.rules.inline.url.exec(e)){let n,r;if(t[2]==="@")n=t[0],r="mailto:"+n;else{let i;do i=t[0],t[0]=this.rules.inline._backpedal.exec(t[0])?.[0]??"";while(i!==t[0]);n=t[0],t[1]==="www."?r="http://"+t[0]:r=t[0]}return{type:"link",raw:t[0],text:n,href:r,tokens:[{type:"text",raw:n,text:n}]}}}inlineText(e){let t=this.rules.inline.text.exec(e);if(t){let n=this.lexer.state.inRawBlock;return{type:"text",raw:t[0],text:t[0],escaped:n}}}};var x=class l{tokens;options;state;inlineQueue;tokenizer;constructor(e){this.tokens=[],this.tokens.links=Object.create(null),this.options=e||R,this.options.tokenizer=this.options.tokenizer||new w,this.tokenizer=this.options.tokenizer,this.tokenizer.options=this.options,this.tokenizer.lexer=this,this.inlineQueue=[],this.state={inLink:!1,inRawBlock:!1,top:!0};let t={other:m,block:D.normal,inline:E.normal};this.options.pedantic?(t.block=D.pedantic,t.inline=E.pedantic):this.options.gfm&&(t.block=D.gfm,this.options.breaks?t.inline=E.breaks:t.inline=E.gfm),this.tokenizer.rules=t}static get rules(){return{block:D,inline:E}}static lex(e,t){return new l(t).lex(e)}static lexInline(e,t){return new l(t).inlineTokens(e)}lex(e){e=e.replace(m.carriageReturn,`
`),this.blockTokens(e,this.tokens);for(let t=0;t<this.inlineQueue.length;t++){let n=this.inlineQueue[t];this.inlineTokens(n.src,n.tokens)}return this.inlineQueue=[],this.tokens}blockTokens(e,t=[],n=!1){for(this.tokenizer.lexer=this,this.options.pedantic&&(e=e.replace(m.tabCharGlobal,"    ").replace(m.spaceLine,""));e;){let r;if(this.options.extensions?.block?.some(s=>(r=s.call({lexer:this},e,t))?(e=e.substring(r.raw.length),t.push(r),!0):!1))continue;if(r=this.tokenizer.space(e)){e=e.substring(r.raw.length);let s=t.at(-1);r.raw.length===1&&s!==void 0?s.raw+=`
`:t.push(r);continue}if(r=this.tokenizer.code(e)){e=e.substring(r.raw.length);let s=t.at(-1);s?.type==="paragraph"||s?.type==="text"?(s.raw+=(s.raw.endsWith(`
`)?"":`
`)+r.raw,s.text+=`
`+r.text,this.inlineQueue.at(-1).src=s.text):t.push(r);continue}if(r=this.tokenizer.fences(e)){e=e.substring(r.raw.length),t.push(r);continue}if(r=this.tokenizer.heading(e)){e=e.substring(r.raw.length),t.push(r);continue}if(r=this.tokenizer.hr(e)){e=e.substring(r.raw.length),t.push(r);continue}if(r=this.tokenizer.blockquote(e)){e=e.substring(r.raw.length),t.push(r);continue}if(r=this.tokenizer.list(e)){e=e.substring(r.raw.length),t.push(r);continue}if(r=this.tokenizer.html(e)){e=e.substring(r.raw.length),t.push(r);continue}if(r=this.tokenizer.def(e)){e=e.substring(r.raw.length);let s=t.at(-1);s?.type==="paragraph"||s?.type==="text"?(s.raw+=(s.raw.endsWith(`
`)?"":`
`)+r.raw,s.text+=`
`+r.raw,this.inlineQueue.at(-1).src=s.text):this.tokens.links[r.tag]||(this.tokens.links[r.tag]={href:r.href,title:r.title},t.push(r));continue}if(r=this.tokenizer.table(e)){e=e.substring(r.raw.length),t.push(r);continue}if(r=this.tokenizer.lheading(e)){e=e.substring(r.raw.length),t.push(r);continue}let i=e;if(this.options.extensions?.startBlock){let s=1/0,a=e.slice(1),o;this.options.extensions.startBlock.forEach(u=>{o=u.call({lexer:this},a),typeof o=="number"&&o>=0&&(s=Math.min(s,o))}),s<1/0&&s>=0&&(i=e.substring(0,s+1))}if(this.state.top&&(r=this.tokenizer.paragraph(i))){let s=t.at(-1);n&&s?.type==="paragraph"?(s.raw+=(s.raw.endsWith(`
`)?"":`
`)+r.raw,s.text+=`
`+r.text,this.inlineQueue.pop(),this.inlineQueue.at(-1).src=s.text):t.push(r),n=i.length!==e.length,e=e.substring(r.raw.length);continue}if(r=this.tokenizer.text(e)){e=e.substring(r.raw.length);let s=t.at(-1);s?.type==="text"?(s.raw+=(s.raw.endsWith(`
`)?"":`
`)+r.raw,s.text+=`
`+r.text,this.inlineQueue.pop(),this.inlineQueue.at(-1).src=s.text):t.push(r);continue}if(e){let s="Infinite loop on byte: "+e.charCodeAt(0);if(this.options.silent){console.error(s);break}else throw new Error(s)}}return this.state.top=!0,t}inline(e,t=[]){return this.inlineQueue.push({src:e,tokens:t}),t}inlineTokens(e,t=[]){this.tokenizer.lexer=this;let n=e,r=null;if(this.tokens.links){let o=Object.keys(this.tokens.links);if(o.length>0)for(;(r=this.tokenizer.rules.inline.reflinkSearch.exec(n))!=null;)o.includes(r[0].slice(r[0].lastIndexOf("[")+1,-1))&&(n=n.slice(0,r.index)+"["+"a".repeat(r[0].length-2)+"]"+n.slice(this.tokenizer.rules.inline.reflinkSearch.lastIndex))}for(;(r=this.tokenizer.rules.inline.anyPunctuation.exec(n))!=null;)n=n.slice(0,r.index)+"++"+n.slice(this.tokenizer.rules.inline.anyPunctuation.lastIndex);let i;for(;(r=this.tokenizer.rules.inline.blockSkip.exec(n))!=null;)i=r[2]?r[2].length:0,n=n.slice(0,r.index+i)+"["+"a".repeat(r[0].length-i-2)+"]"+n.slice(this.tokenizer.rules.inline.blockSkip.lastIndex);n=this.options.hooks?.emStrongMask?.call({lexer:this},n)??n;let s=!1,a="";for(;e;){s||(a=""),s=!1;let o;if(this.options.extensions?.inline?.some(p=>(o=p.call({lexer:this},e,t))?(e=e.substring(o.raw.length),t.push(o),!0):!1))continue;if(o=this.tokenizer.escape(e)){e=e.substring(o.raw.length),t.push(o);continue}if(o=this.tokenizer.tag(e)){e=e.substring(o.raw.length),t.push(o);continue}if(o=this.tokenizer.link(e)){e=e.substring(o.raw.length),t.push(o);continue}if(o=this.tokenizer.reflink(e,this.tokens.links)){e=e.substring(o.raw.length);let p=t.at(-1);o.type==="text"&&p?.type==="text"?(p.raw+=o.raw,p.text+=o.text):t.push(o);continue}if(o=this.tokenizer.emStrong(e,n,a)){e=e.substring(o.raw.length),t.push(o);continue}if(o=this.tokenizer.codespan(e)){e=e.substring(o.raw.length),t.push(o);continue}if(o=this.tokenizer.br(e)){e=e.substring(o.raw.length),t.push(o);continue}if(o=this.tokenizer.del(e,n,a)){e=e.substring(o.raw.length),t.push(o);continue}if(o=this.tokenizer.autolink(e)){e=e.substring(o.raw.length),t.push(o);continue}if(!this.state.inLink&&(o=this.tokenizer.url(e))){e=e.substring(o.raw.length),t.push(o);continue}let u=e;if(this.options.extensions?.startInline){let p=1/0,c=e.slice(1),d;this.options.extensions.startInline.forEach(h=>{d=h.call({lexer:this},c),typeof d=="number"&&d>=0&&(p=Math.min(p,d))}),p<1/0&&p>=0&&(u=e.substring(0,p+1))}if(o=this.tokenizer.inlineText(u)){e=e.substring(o.raw.length),o.raw.slice(-1)!=="_"&&(a=o.raw.slice(-1)),s=!0;let p=t.at(-1);p?.type==="text"?(p.raw+=o.raw,p.text+=o.text):t.push(o);continue}if(e){let p="Infinite loop on byte: "+e.charCodeAt(0);if(this.options.silent){console.error(p);break}else throw new Error(p)}}return t}};var y=class{options;parser;constructor(e){this.options=e||R}space(e){return""}code({text:e,lang:t,escaped:n}){let r=(t||"").match(m.notSpaceStart)?.[0],i=e.replace(m.endingNewline,"")+`
`;return r?'<pre><code class="language-'+O(r)+'">'+(n?i:O(i,!0))+`</code></pre>
`:"<pre><code>"+(n?i:O(i,!0))+`</code></pre>
`}blockquote({tokens:e}){return`<blockquote>
${this.parser.parse(e)}</blockquote>
`}html({text:e}){return e}def(e){return""}heading({tokens:e,depth:t}){return`<h${t}>${this.parser.parseInline(e)}</h${t}>
`}hr(e){return`<hr>
`}list(e){let t=e.ordered,n=e.start,r="";for(let a=0;a<e.items.length;a++){let o=e.items[a];r+=this.listitem(o)}let i=t?"ol":"ul",s=t&&n!==1?' start="'+n+'"':"";return"<"+i+s+`>
`+r+"</"+i+`>
`}listitem(e){return`<li>${this.parser.parse(e.tokens)}</li>
`}checkbox({checked:e}){return"<input "+(e?'checked="" ':"")+'disabled="" type="checkbox"> '}paragraph({tokens:e}){return`<p>${this.parser.parseInline(e)}</p>
`}table(e){let t="",n="";for(let i=0;i<e.header.length;i++)n+=this.tablecell(e.header[i]);t+=this.tablerow({text:n});let r="";for(let i=0;i<e.rows.length;i++){let s=e.rows[i];n="";for(let a=0;a<s.length;a++)n+=this.tablecell(s[a]);r+=this.tablerow({text:n})}return r&&(r=`<tbody>${r}</tbody>`),`<table>
<thead>
`+t+`</thead>
`+r+`</table>
`}tablerow({text:e}){return`<tr>
${e}</tr>
`}tablecell(e){let t=this.parser.parseInline(e.tokens),n=e.header?"th":"td";return(e.align?`<${n} align="${e.align}">`:`<${n}>`)+t+`</${n}>
`}strong({tokens:e}){return`<strong>${this.parser.parseInline(e)}</strong>`}em({tokens:e}){return`<em>${this.parser.parseInline(e)}</em>`}codespan({text:e}){return`<code>${O(e,!0)}</code>`}br(e){return"<br>"}del({tokens:e}){return`<del>${this.parser.parseInline(e)}</del>`}link({href:e,title:t,tokens:n}){let r=this.parser.parseInline(n),i=V(e);if(i===null)return r;e=i;let s='<a href="'+e+'"';return t&&(s+=' title="'+O(t)+'"'),s+=">"+r+"</a>",s}image({href:e,title:t,text:n,tokens:r}){r&&(n=this.parser.parseInline(r,this.parser.textRenderer));let i=V(e);if(i===null)return O(n);e=i;let s=`<img src="${e}" alt="${O(n)}"`;return t&&(s+=` title="${O(t)}"`),s+=">",s}text(e){return"tokens"in e&&e.tokens?this.parser.parseInline(e.tokens):"escaped"in e&&e.escaped?e.text:O(e.text)}};var S=class{strong({text:e}){return e}em({text:e}){return e}codespan({text:e}){return e}del({text:e}){return e}html({text:e}){return e}text({text:e}){return e}link({text:e}){return""+e}image({text:e}){return""+e}br(){return""}checkbox({raw:e}){return e}};var b=class l{options;renderer;textRenderer;constructor(e){this.options=e||R,this.options.renderer=this.options.renderer||new y,this.renderer=this.options.renderer,this.renderer.options=this.options,this.renderer.parser=this,this.textRenderer=new S}static parse(e,t){return new l(t).parse(e)}static parseInline(e,t){return new l(t).parseInline(e)}parse(e){this.renderer.parser=this;let t="";for(let n=0;n<e.length;n++){let r=e[n];if(this.options.extensions?.renderers?.[r.type]){let s=r,a=this.options.extensions.renderers[s.type].call({parser:this},s);if(a!==!1||!["space","hr","heading","code","table","blockquote","list","html","def","paragraph","text"].includes(s.type)){t+=a||"";continue}}let i=r;switch(i.type){case"space":{t+=this.renderer.space(i);break}case"hr":{t+=this.renderer.hr(i);break}case"heading":{t+=this.renderer.heading(i);break}case"code":{t+=this.renderer.code(i);break}case"table":{t+=this.renderer.table(i);break}case"blockquote":{t+=this.renderer.blockquote(i);break}case"list":{t+=this.renderer.list(i);break}case"checkbox":{t+=this.renderer.checkbox(i);break}case"html":{t+=this.renderer.html(i);break}case"def":{t+=this.renderer.def(i);break}case"paragraph":{t+=this.renderer.paragraph(i);break}case"text":{t+=this.renderer.text(i);break}default:{let s='Token with "'+i.type+'" type was not found.';if(this.options.silent)return console.error(s),"";throw new Error(s)}}}return t}parseInline(e,t=this.renderer){this.renderer.parser=this;let n="";for(let r=0;r<e.length;r++){let i=e[r];if(this.options.extensions?.renderers?.[i.type]){let a=this.options.extensions.renderers[i.type].call({parser:this},i);if(a!==!1||!["escape","html","link","image","strong","em","codespan","br","del","text"].includes(i.type)){n+=a||"";continue}}let s=i;switch(s.type){case"escape":{n+=t.text(s);break}case"html":{n+=t.html(s);break}case"link":{n+=t.link(s);break}case"image":{n+=t.image(s);break}case"checkbox":{n+=t.checkbox(s);break}case"strong":{n+=t.strong(s);break}case"em":{n+=t.em(s);break}case"codespan":{n+=t.codespan(s);break}case"br":{n+=t.br(s);break}case"del":{n+=t.del(s);break}case"text":{n+=t.text(s);break}default:{let a='Token with "'+s.type+'" type was not found.';if(this.options.silent)return console.error(a),"";throw new Error(a)}}}return n}};var P=class{options;block;constructor(e){this.options=e||R}static passThroughHooks=new Set(["preprocess","postprocess","processAllTokens","emStrongMask"]);static passThroughHooksRespectAsync=new Set(["preprocess","postprocess","processAllTokens"]);preprocess(e){return e}postprocess(e){return e}processAllTokens(e){return e}emStrongMask(e){return e}provideLexer(){return this.block?x.lex:x.lexInline}provideParser(){return this.block?b.parse:b.parseInline}};var A=class{defaults=_();options=this.setOptions;parse=this.parseMarkdown(!0);parseInline=this.parseMarkdown(!1);Parser=b;Renderer=y;TextRenderer=S;Lexer=x;Tokenizer=w;Hooks=P;constructor(...e){this.use(...e)}walkTokens(e,t){let n=[];for(let r of e)switch(n=n.concat(t.call(this,r)),r.type){case"table":{let i=r;for(let s of i.header)n=n.concat(this.walkTokens(s.tokens,t));for(let s of i.rows)for(let a of s)n=n.concat(this.walkTokens(a.tokens,t));break}case"list":{let i=r;n=n.concat(this.walkTokens(i.items,t));break}default:{let i=r;this.defaults.extensions?.childTokens?.[i.type]?this.defaults.extensions.childTokens[i.type].forEach(s=>{let a=i[s].flat(1/0);n=n.concat(this.walkTokens(a,t))}):i.tokens&&(n=n.concat(this.walkTokens(i.tokens,t)))}}return n}use(...e){let t=this.defaults.extensions||{renderers:{},childTokens:{}};return e.forEach(n=>{let r={...n};if(r.async=this.defaults.async||r.async||!1,n.extensions&&(n.extensions.forEach(i=>{if(!i.name)throw new Error("extension name required");if("renderer"in i){let s=t.renderers[i.name];s?t.renderers[i.name]=function(...a){let o=i.renderer.apply(this,a);return o===!1&&(o=s.apply(this,a)),o}:t.renderers[i.name]=i.renderer}if("tokenizer"in i){if(!i.level||i.level!=="block"&&i.level!=="inline")throw new Error("extension level must be 'block' or 'inline'");let s=t[i.level];s?s.unshift(i.tokenizer):t[i.level]=[i.tokenizer],i.start&&(i.level==="block"?t.startBlock?t.startBlock.push(i.start):t.startBlock=[i.start]:i.level==="inline"&&(t.startInline?t.startInline.push(i.start):t.startInline=[i.start]))}"childTokens"in i&&i.childTokens&&(t.childTokens[i.name]=i.childTokens)}),r.extensions=t),n.renderer){let i=this.defaults.renderer||new y(this.defaults);for(let s in n.renderer){if(!(s in i))throw new Error(`renderer '${s}' does not exist`);if(["options","parser"].includes(s))continue;let a=s,o=n.renderer[a],u=i[a];i[a]=(...p)=>{let c=o.apply(i,p);return c===!1&&(c=u.apply(i,p)),c||""}}r.renderer=i}if(n.tokenizer){let i=this.defaults.tokenizer||new w(this.defaults);for(let s in n.tokenizer){if(!(s in i))throw new Error(`tokenizer '${s}' does not exist`);if(["options","rules","lexer"].includes(s))continue;let a=s,o=n.tokenizer[a],u=i[a];i[a]=(...p)=>{let c=o.apply(i,p);return c===!1&&(c=u.apply(i,p)),c}}r.tokenizer=i}if(n.hooks){let i=this.defaults.hooks||new P;for(let s in n.hooks){if(!(s in i))throw new Error(`hook '${s}' does not exist`);if(["options","block"].includes(s))continue;let a=s,o=n.hooks[a],u=i[a];P.passThroughHooks.has(s)?i[a]=p=>{if(this.defaults.async&&P.passThroughHooksRespectAsync.has(s))return(async()=>{let d=await o.call(i,p);return u.call(i,d)})();let c=o.call(i,p);return u.call(i,c)}:i[a]=(...p)=>{if(this.defaults.async)return(async()=>{let d=await o.apply(i,p);return d===!1&&(d=await u.apply(i,p)),d})();let c=o.apply(i,p);return c===!1&&(c=u.apply(i,p)),c}}r.hooks=i}if(n.walkTokens){let i=this.defaults.walkTokens,s=n.walkTokens;r.walkTokens=function(a){let o=[];return o.push(s.call(this,a)),i&&(o=o.concat(i.call(this,a))),o}}this.defaults={...this.defaults,...r}}),this}setOptions(e){return this.defaults={...this.defaults,...e},this}lexer(e,t){return x.lex(e,t??this.defaults)}parser(e,t){return b.parse(e,t??this.defaults)}parseMarkdown(e){return(n,r)=>{let i={...r},s={...this.defaults,...i},a=this.onError(!!s.silent,!!s.async);if(this.defaults.async===!0&&i.async===!1)return a(new Error("marked(): The async option was set to true by an extension. Remove async: false from the parse options object to return a Promise."));if(typeof n>"u"||n===null)return a(new Error("marked(): input parameter is undefined or null"));if(typeof n!="string")return a(new Error("marked(): input parameter is of type "+Object.prototype.toString.call(n)+", string expected"));if(s.hooks&&(s.hooks.options=s,s.hooks.block=e),s.async)return(async()=>{let o=s.hooks?await s.hooks.preprocess(n):n,p=await(s.hooks?await s.hooks.provideLexer():e?x.lex:x.lexInline)(o,s),c=s.hooks?await s.hooks.processAllTokens(p):p;s.walkTokens&&await Promise.all(this.walkTokens(c,s.walkTokens));let h=await(s.hooks?await s.hooks.provideParser():e?b.parse:b.parseInline)(c,s);return s.hooks?await s.hooks.postprocess(h):h})().catch(a);try{s.hooks&&(n=s.hooks.preprocess(n));let u=(s.hooks?s.hooks.provideLexer():e?x.lex:x.lexInline)(n,s);s.hooks&&(u=s.hooks.processAllTokens(u)),s.walkTokens&&this.walkTokens(u,s.walkTokens);let c=(s.hooks?s.hooks.provideParser():e?b.parse:b.parseInline)(u,s);return s.hooks&&(c=s.hooks.postprocess(c)),c}catch(o){return a(o)}}}onError(e,t){return n=>{if(n.message+=`
Please report this to https://github.com/markedjs/marked.`,e){let r="<p>An error occurred:</p><pre>"+O(n.message+"",!0)+"</pre>";return t?Promise.resolve(r):r}if(t)return Promise.reject(n);throw n}}};var M=new A;function g(l,e){return M.parse(l,e)}g.options=g.setOptions=function(l){return M.setOptions(l),g.defaults=M.defaults,N(g.defaults),g};g.getDefaults=_;g.defaults=R;g.use=function(...l){return M.use(...l),g.defaults=M.defaults,N(g.defaults),g};g.walkTokens=function(l,e){return M.walkTokens(l,e)};g.parseInline=M.parseInline;g.Parser=b;g.parser=b.parse;g.Renderer=y;g.TextRenderer=S;g.Lexer=x;g.lexer=x.lex;g.Tokenizer=w;g.Hooks=P;g.parse=g;var pt=g.options,ct=g.setOptions,ht=g.use,kt=g.walkTokens,dt=g.parseInline,gt=g,ft=b.parse,mt=x.lex;

if(__exports != exports)module.exports = exports;return module.exports}));


const marked = module.exports;
// The parser emits controlled HTML only. Raw model HTML is always text.
function escapeMarkdownHtml(value) {
  return String(value ?? '').replace(/[&<>"']/gu, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

function safeMarkdownUrl(value) {
  const url = String(value ?? '').trim();
  // Do not decode HTML entities: escaping & on output prevents browser decoding
  // another layer. Explicitly allow only these protocol/prefix forms.
  if (!url || /[\u0000-\u0020\u007f-\u009f\\]/u.test(url)) return null;
  if (/^https?:\/\//iu.test(url)) {
    try { const parsed = new URL(url); return ['http:', 'https:'].includes(parsed.protocol) && parsed.hostname ? url : null; } catch { return null; }
  }
  if (/^mailto:[^?@]+@[^?@]+(?:\?[^\r\n]*)?$/iu.test(url) && !/%(?:0[ad]|1[0-9a-f])/iu.test(url)) return url;
  if (/^\/(?!\/)/u.test(url) || /^\.{1,2}\//u.test(url) || /^#/u.test(url)) return url;
  return null;
}

// Retain the deployed Chat table behavior: pipes inside math/code are cell
// contents, even when the model omitted GFM's required pipe escape.
function prepareMarkdownTablePipes(markdown, readMath) {
  const source = String(markdown ?? '').replace(/\r\n?/gu, '\n');
  let placeholder = '';
  for (let code = 0xe000; code <= 0xf8ff; code++) {
    const value = String.fromCharCode(code);
    if (!source.includes(value)) { placeholder = value; break; }
  }
  if (!placeholder) return { source, restore: value => String(value ?? '') };
  const lines = source.split('\n');
  const separator = line => /^ {0,3}\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/u.test(line || '');
  const protectRow = row => {
    let output = '';
    const escaped = position => { let n = 0; while (position > 0 && row[--position] === '\\') n++; return n % 2 === 1; };
    for (let index = 0; index < row.length;) {
      if (row[index] === '`' && !escaped(index)) {
        const marker = row.slice(index).match(/^`+/u)[0];
        let end = index + marker.length;
        while ((end = row.indexOf(marker, end)) !== -1) {
          if (row[end - 1] !== '`' && row[end + marker.length] !== '`') break;
          end += marker.length;
        }
        if (end !== -1) { const next = end + marker.length; output += row.slice(index, next).replaceAll('|', placeholder); index = next; continue; }
      }
      const math = !escaped(index) && (row[index] === '$' || row[index] === '\\') ? readMath(row, index) : null;
      if (math) { output += math.raw.replaceAll('|', placeholder); index = math.end; continue; }
      output += row[index++];
    }
    return output;
  };
  let fence = null;
  for (let index = 0; index < lines.length; index++) {
    const marker = lines[index].match(/^ {0,3}(`{3,}|~{3,})/u);
    if (fence) { if (new RegExp(`^ {0,3}${fence[0]}{${fence.length},}\\s*$`, 'u').test(lines[index])) fence = null; continue; }
    if (marker) { fence = marker[1]; continue; }
    if (/^(?: {4}|\t)/u.test(lines[index]) || !lines[index].includes('|') || !separator(lines[index + 1])) continue;
    lines[index] = protectRow(lines[index]);
    index += 1;
    while (index + 1 < lines.length && lines[index + 1].trim() && lines[index + 1].includes('|')) lines[++index] = protectRow(lines[index]);
  }
  return { source: lines.join('\n'), restore: value => String(value ?? '').replaceAll(placeholder, '|') };
}

function renderSafeMarkdown(markdown, readMath, renderMath) {
  const prepared = prepareMarkdownTablePipes(markdown, readMath);
  const restore = prepared.restore;
    const mathExtension = (name, level) => ({
      name, level,
      start(source) { return source.search(level === 'block' ? /(?:^|\n) {0,3}(?:\$\$|\\\[)/u : /[$\\]/u); },
      tokenizer(source) {
        const prefix = level === 'block' ? (source.match(/^ {0,3}/u)?.[0] || '') : '';
        const math = readMath(source.slice(prefix.length), 0);
        if (!math || (level === 'block' && !math.display)) return undefined;
        return { type: name, raw: prefix + math.raw, tex: math.tex, display: math.display, original: math.raw };
      },
      renderer(token) { return renderMath(restore(token.tex), token.display, restore(token.original)); },
    });
    const parser = new marked.Marked({
      gfm: true, breaks: false, pedantic: false, async: false,
      extensions: [mathExtension('omMathBlock', 'block'), mathExtension('omMathInline', 'inline')],
      renderer: {
        html(token) { return escapeMarkdownHtml(token.text); },
        link(token) {
          const text = this.parser.parseInline(token.tokens);
          const href = safeMarkdownUrl(restore(token.href));
          return href ? `<a href="${escapeMarkdownHtml(href)}" target="_blank" rel="noopener noreferrer">${text}</a>` : text;
        },
        image(token) {
          // Images are handled by the existing authenticated answer-image path.
          // Keep Markdown image references useful without a second fetch path.
          const text = escapeMarkdownHtml(token.text || '图片');
          const href = safeMarkdownUrl(restore(token.href));
          return href ? `<a href="${escapeMarkdownHtml(href)}" target="_blank" rel="noopener noreferrer">${text}</a>` : text;
        },
        codespan(token) { return `<code>${escapeMarkdownHtml(restore(token.text))}</code>`; },
        code(token) {
          const language = (token.lang || '').trim().split(/\s/u)[0];
          const attr = /^[A-Za-z0-9_+-]{1,40}$/u.test(language) ? ` data-language="${escapeMarkdownHtml(language)}"` : '';
          return `<pre class="om-code-block"><code${attr}>${escapeMarkdownHtml(token.text)}</code></pre>\n`;
        },
      },
    });
  try { return parser.parse(prepared.source) || '<p>暂无内容。</p>'; }
  catch { return `<p>${escapeMarkdownHtml(markdown)}</p>`; }
}

return { renderSafeMarkdown, safeMarkdownUrl };
})();

function renderMarkdown(markdown) {
  return omSafeMarkdown.renderSafeMarkdown(markdown, answerMathTokenAt, renderAnswerMath);
}



function renderAnswerBody(answer) {
  const container = document.createElement("div");
  container.className = "answer-content";
  const html = renderMarkdown(answer);
  if ("innerHTML" in container) {
    container.innerHTML = html;
    return container;
  }
  appendControlledHtml(container, html);
  return container;
}

function userFacingAnswer(value) {
  return cleanPublicChatText(value);
}

function appendControlledHtml(root, html) {
  const decode = (value) => value
    .replace(/&lt;/gu, "<")
    .replace(/&gt;/gu, ">")
    .replace(/&quot;/gu, '"')
    .replace(/&#39;/gu, "'")
    .replace(/&amp;/gu, "&");
  const stack = [root];
  const pattern = /<\/?([a-z0-9]+)(?:\s[^>]*)?>|([^<]+)/giu;
  let match;
  while ((match = pattern.exec(html))) {
    if (match[2]) {
      stack.at(-1).append(document.createTextNode(decode(match[2])));
      continue;
    }
    const tag = match[1].toLowerCase();
    if (match[0][1] === "/") {
      if (stack.length > 1) stack.pop();
      continue;
    }
    const node = document.createElement(tag);
    stack.at(-1).append(node);
    stack.push(node);
  }
}

function answerMathTokenAt(text, index) {
  let left = "";
  let right = "";
  let display = false;
  if (text.startsWith("\\[", index)) { left = "\\["; right = "\\]"; display = true; }
  else if (text.startsWith("\\(", index)) { left = "\\("; right = "\\)"; }
  else if (text.startsWith("$$", index)) { left = right = "$$"; display = true; }
  else if (text[index] === "$" && text[index - 1] !== "$" && text[index + 1] !== "$") { left = right = "$"; }
  else return null;
  const start = index + left.length;
  const end = text.indexOf(right, start);
  if (end === -1) return null;
  const content = text.slice(start, end);
  const trimmed = content.trim();
  if (left === "$") {
    if (!trimmed || /\r|\n/u.test(content) || /\d/u.test(text[end + 1] || "")) return null;
    const padded = content !== trimmed;
    const looksMathematical = /\\[a-zA-Z]|[_^=+*/<>\-≤≥≠−]/u.test(trimmed) || /^[\p{L}\p{N}.]+$/u.test(trimmed);
    if (padded && !looksMathematical) return null;
  }
  return { raw: text.slice(index, end + right.length), tex: content, display, end: end + right.length };
}

function normalizeAnswerMathTex(value) {
  return String(value).replace(
    /\\begin\{(matrix|pmatrix|bmatrix|Bmatrix|vmatrix|Vmatrix)\}([\s\S]*?)\\end\{\1\}/gu,
    (original, environment, body) => {
      if (/\\(?:begin|end|text|verb|multicolumn|hline)\b/u.test(body)) return original;
      const lines = body.split("\n");
      const rows = lines.map((line, index) => ({ line, index })).filter(({ line }) => line.trim());
      if (rows.length < 2 || rows.length > 50) return original;
      const columns = rows.map(({ line }) => (line.match(/(?<!\\)&/gu) || []).length);
      if (columns[0] < 1 || columns.some((count) => count !== columns[0])) return original;
      const preceding = rows.slice(0, -1);
      if (preceding.some(({ line }) => !/(?<!\\)\\{1,2}[ \t\r]*$/u.test(line))) return original;
      for (const { line, index } of preceding) {
        lines[index] = line.replace(/(?<!\\)\\([ \t\r]*)$/u, (_, spaces) => "\\\\" + spaces);
      }
      return `\\begin{${environment}}${lines.join("\n")}\\end{${environment}}`;
    },
  );
}

function renderAnswerMath(tex, display, raw) {
  const normalizedTex = normalizeAnswerMathTex(tex);
  const mathClass = display ? "math-display answer-math-block" : "math-inline";
  const fallback = `<span class="${mathClass}" data-math-status="fallback" data-tex="${escapeHtml(normalizedTex)}" data-display="${display ? "true" : "false"}" data-raw="${escapeHtml(raw)}">${escapeHtml(raw)}</span>`;
  if (!answerMathEngine?.renderToString || normalizedTex.length > 8000) return fallback;
  try {
    const html = answerMathEngine.renderToString(normalizedTex.trim(), {
      displayMode: display,
      output: "mathml",
      trust: false,
      throwOnError: true,
      strict: "ignore",
      maxExpand: 1000,
      maxSize: 10,
    });
    return `<span class="${mathClass}" data-math-status="rendered">${html}</span>`;
  } catch {
    return fallback;
  }
}

function inline(text) {
  const tokens = [];
  let protectedText = "";
  for (let index = 0; index < String(text).length;) {
    // Only HTTP(S) links; student HTML and unsafe URI schemes stay inert text.
    if (text[index] === '[') {
      const link = text.slice(index).match(/^\[([^\]\n]{1,200})\]\((https?:\/\/[^\s)]+)\)/iu);
      if (link) {
        const token = `\uE000C${tokens.length}\uE001`;
        tokens.push(`<a href="${escapeHtml(link[2])}" target="_blank" rel="noopener noreferrer">${escapeHtml(link[1])}</a>`);
        protectedText += token; index += link[0].length; continue;
      }
    }
    if (text[index] === "`") {
      const end = text.indexOf("`", index + 1);
      if (end !== -1) {
        const token = `\uE000C${tokens.length}\uE001`;
        tokens.push(`<code>${escapeHtml(text.slice(index + 1, end))}</code>`);
        protectedText += token;
        index = end + 1;
        continue;
      }
    }
    const math = (text[index] === "$" || text[index] === "\\") ? answerMathTokenAt(text, index) : null;
    if (math) {
      const token = `\uE000C${tokens.length}\uE001`;
      tokens.push(renderAnswerMath(math.tex, math.display, math.raw));
      protectedText += token;
      index = math.end;
      continue;
    }
    protectedText += text[index++];
  }
  return escapeHtml(protectedText)
    .replace(/\*\*([^*]+)\*\*/gu, "<strong>$1</strong>")
    .replace(/\uE000C(\d+)\uE001/gu, (_, index) => tokens[Number(index)] || "");
}

function knowledgeSuggestionsFromPayload(payload) {
  return (Array.isArray(payload?.suggestions) ? payload.suggestions : [])
    .map((item) => typeof item === "string" ? item : item?.question)
    .filter(Boolean);
}

function rerenderFallbackMath(root = document) {
  if (!answerMathEngine?.renderToString) return;
  root.querySelectorAll('[data-math-status="fallback"][data-tex]').forEach((node) => {
    const tex = node.getAttribute("data-tex") || "";
    const raw = node.getAttribute("data-raw") || node.textContent || "";
    const display = node.getAttribute("data-display") === "true";
    const wrapper = document.createElement("template");
    wrapper.innerHTML = renderAnswerMath(tex, display, raw);
    const rendered = wrapper.content.firstElementChild;
    if (rendered && rendered.getAttribute("data-math-status") === "rendered") node.replaceWith(rendered);
  });
}

function knowledgeImageUrl(value) {
  const url = String(value || "");
  if (!/^\/api\/knowledge\/assets\/[A-Za-z0-9_-]+$/u.test(url)) return "";
  return apiUrl(url);
}

function renderKnowledgeImages(images) {
  const safeImages = (Array.isArray(images) ? images : [])
    .map((image) => ({
      url: knowledgeImageUrl(image?.url),
      alt: String(image?.alt || "资料图片").slice(0, 120),
    }))
    .filter((image) => image.url)
    .slice(0, 4);
  if (!safeImages.length) return "";
  return `<div class="knowledge-gallery">${safeImages.map((image) => `<figure class="knowledge-image"><img src="${escapeHtml(image.url)}" alt="${escapeHtml(image.alt)}" loading="lazy" decoding="async"><figcaption>${escapeHtml(image.alt)}</figcaption></figure>`).join("")}</div>`;
}

function appShell() {
  return `
  <div class="app-shell">
    <aside class="sidebar">
      <div class="brand"><span class="brand-mark" aria-hidden="true"></span><div class="brand-copy"><strong class="brand-title">机器人自主移动与操作实验室</strong><span class="brand-subtitle">OriginMind × ARTS Robotics</span></div></div>
      <div class="sidebar-label">功能</div>
      <div class="nav-list">
        <a class="nav-item village-nav-item" href="/newbie-village">${icons.chart}<span>新手村</span></a>
        <button class="nav-item model-nav-item active" type="button" data-mode="text">${icons.text}<span>文本模型</span></button>
        <button class="nav-item model-nav-item" type="button" data-mode="voice" disabled aria-disabled="true" title="当前版本未接通语音输入">${icons.voice}<span>语音（暂未启用）</span></button>
        <button class="nav-item model-nav-item" type="button" data-mode="vision" disabled aria-disabled="true" title="当前版本未接通图片理解">${icons.vision}<span>视觉（暂未启用）</span></button>
      </div>
      <div class="sidebar-label history-label">历史</div>
      <div class="history-list"></div>
      <button class="collapse-handle" type="button" aria-label="收起侧边栏">${icons.chevron}</button>
      <div class="side-footer"><div class="bottom-actions"><button class="new-chat-bottom" type="button">${icons.plus}<span>聊天</span></button><button class="recent-chat-trigger" type="button" aria-label="打开最近聊天">${icons.chat}</button><button class="settings-trigger mobile-settings-trigger" type="button" aria-label="新手村">${icons.gear}</button></div></div>
    </aside>
    <main class="workspace"><header class="topbar"><div class="topbar-title"><span class="lab-name">机器人自主移动与操作实验室</span><span class="desktop-lab-brand">OriginMind × ARTS Robotics</span></div><div class="topbar-actions"><span class="guest-badge">正在确认身份…</span><button class="settings-trigger desktop-settings-trigger" type="button" aria-label="新手村">${icons.gear}</button></div></header>
      <section class="chat-surface"><button class="student-login-trigger login-guide" type="button" hidden><span class="login-guide-icon">${icons.login}</span><span class="login-guide-copy"><strong>深技大师生登录</strong></span></button><div class="empty-state"><div class="entry-card"><h1 class="hero-title">想了解实验室的什么？</h1><p class="hero-subtitle">从已审核的实验室公开知识中检索并回答。</p></div></div>
        <div class="conversation" aria-live="polite"><div class="message-list"></div></div>
        <div class="composer-wrap"><div class="composer-glow"></div><form class="composer" aria-label="发送消息"><div class="composer-inner"><div class="input-panel"><textarea id="question" class="prompt-input" rows="2" maxlength="4000" aria-label="你的问题" placeholder="输入想了解的实验室问题"></textarea><div class="attachment-chip">${icons.paperclip}<span></span></div></div><div class="composer-footer"><div class="input-tools"><input class="file-input" type="file" hidden><button class="icon-button attach-button" type="button" aria-label="添加附件">${icons.paperclip}</button><button class="icon-button voice-button" type="button" disabled aria-label="语音输入暂未启用">${icons.voice}</button></div><div class="footer-actions"><button class="model-pill" type="button">${icons.cube}<span>文本模型</span></button><button class="send-button" type="submit" aria-label="发送" disabled>${icons.send}</button></div></div></div></form></div>
        <div class="suggestions">${DEFAULT_SUGGESTIONS.map((question, index) => `<button class="suggestion" type="button" data-prompt="${escapeHtml(question)}">${[icons.file, icons.text, icons.chart, icons.pen][index] || icons.chat}<span>${escapeHtml(question.replace(/[？?]$/u, ""))}</span></button>`).join("")}</div>
      </section></main>
  </div>
  <dialog id="recent-drawer" class="recent-drawer" aria-label="最近聊天">
    <header><strong>最近聊天</strong><button class="recent-drawer-close" type="button" aria-label="关闭最近聊天">${icons.x}</button></header>
    <div class="recent-list"></div>
  </dialog>
  <div class="auth-backdrop" aria-hidden="true">
    <div class="auth-dialog" role="dialog" aria-modal="true" aria-labelledby="auth-title">
      <button class="auth-close" type="button" aria-label="关闭">${icons.x}</button>
      <div class="auth-brand">${icons.login}</div>
      <h2 id="auth-title">校内邮箱登录</h2>
      <p>仅用于 Chat 身份验证，不进入其他系统。学生请使用学号@stumail.sztu.edu.cn，教师请使用 @sztu.edu.cn 邮箱。</p>
      <form class="campus-login-form">
        <label class="auth-field"><span>邮箱</span><input class="campus-email-input" type="email" autocomplete="email" placeholder="学号@stumail.sztu.edu.cn"></label>
        <button class="campus-code-button" type="button">发送验证码</button>
        <label class="auth-field code-field"><span>验证码</span><input class="campus-code-input" inputmode="numeric" autocomplete="one-time-code" maxlength="6" placeholder="6 位数字"></label>
        <button class="campus-login-button" type="submit">验证并登录</button>
        <div class="auth-status" aria-live="polite"></div>
      </form>
      <div class="guest-limits"><strong>游客可用</strong><span>公开知识问答、公开研究方向、合作方式咨询。</span><strong>登录后</strong><span>识别学生或校内教师身份，用于后续新手引导和个性化设置。</span></div>
      <button class="guest-continue" type="button">暂不登录，继续学习</button>
      <p class="auth-caption">Chat 登录只做身份验证，不关联内部审批流程。</p>
    </div>
  </div>
  <div class="toast" role="status" aria-live="polite"></div>`;
}

document.getElementById("app").innerHTML = appShell();

const body = document.body;
const form = document.querySelector(".composer");
const promptInput = document.querySelector(".prompt-input");
const sendButton = document.querySelector(".send-button");
const messageList = document.querySelector(".message-list");
const fileInput = document.querySelector(".file-input");
const attachmentChip = document.querySelector(".attachment-chip");
const attachmentName = attachmentChip.querySelector("span");
const omRemoveAttachment = document.createElement("button");
omRemoveAttachment.type = "button"; omRemoveAttachment.textContent = "移除";
omRemoveAttachment.className = "om-remove-attachment"; omRemoveAttachment.setAttribute("aria-label", "移除附件");
omRemoveAttachment.addEventListener("click", () => { if (omRequestPending) return; fileInput.value = ""; attachmentChip.classList.remove("show"); updateSendState(); });
attachmentChip.append(omRemoveAttachment);
const voiceButton = document.querySelector(".voice-button");
const modelPillLabel = document.querySelector(".model-pill span");
const heroTitle = document.querySelector(".hero-title");
const heroSubtitle = document.querySelector(".hero-subtitle");
const toast = document.querySelector(".toast");
const authBackdrop = document.querySelector(".auth-backdrop");
const guestBadge = document.querySelector(".guest-badge");
const loginGuide = document.querySelector(".login-guide");
const campusLoginForm = document.querySelector(".campus-login-form");
const campusEmailInput = document.querySelector(".campus-email-input");
const campusCodeInput = document.querySelector(".campus-code-input");
const campusCodeButton = document.querySelector(".campus-code-button");
const authStatus = document.querySelector(".auth-status");
const historyList = document.querySelector(".history-list");
const recentDrawer = document.querySelector("#recent-drawer");
const recentList = document.querySelector(".recent-list");
let toastTimer;
let currentMode = "text";
let visitorUser = null;
let conversations = [];
let activeConversationId = "";
let activeNewbieCourseId = "";
let submittedQuestionCount = 0;

const NEWBIE_COURSES = __NEWBIE_COURSES__;

function validNewbieCourseId(value) {
  return typeof value === "string" && Object.hasOwn(NEWBIE_COURSES, value) ? value : "";
}

function setActiveNewbieCourse(value) {
  activeNewbieCourseId = validNewbieCourseId(value);
  let notice = document.querySelector(".newbie-learning-notice");
  if (!notice && activeNewbieCourseId) {
    notice = element("p", { className: "newbie-learning-notice", attributes: { role: "note" } });
    notice.style.cssText = "margin:0 18px 12px;font-size:12px;line-height:1.5;opacity:.8;text-align:left;";
    form.append(notice);
  }
  if (notice) {
    notice.hidden = !activeNewbieCourseId;
    notice.textContent = "登录后的课程提问会供教师在管理端查看，用于学习指导。游客提问不记入个人学习记录。";
  }
}

function newbieCourseLaunch(params) {
  const id = params.get("course");
  if (params.get("ta") !== "1" || !Object.hasOwn(NEWBIE_COURSES, id)) return null;
  const course = NEWBIE_COURSES[id];
  const hint = params.get("hint") || "";
  const customQuestion = String(params.get("question") || "").trim().slice(0, 500);
  const step = String(params.get("step") || "").trim().slice(0, 120);
  const question = customQuestion || (/^[0-9]$/u.test(hint) ? course.taPrompts[Number(hint)] : "");
  const text = [
    `我正在学习新手村第 ${course.index} 关：${course.title}。`,
    `本关目标：${course.goal}`,
    "学习任务：", ...course.steps.map((step, i) => `${i + 1}. ${step}`),
    "验收与提交要求：", ...course.deliverables.map((item) => `- ${item}`),
    "请先根据我的问题给出排查步骤或提示，必要时追问运行命令、实际输出和预期结果。不要虚构实验结果，也不要把 AI 建议当作教师验收。",
    ...(step ? [`当前步骤：${step}`] : []),
    `我的问题：${question || "（请在这里补充你卡住的步骤、尝试和报错）"}`,
  ].join("\n");
  return { text, title: `第 ${course.index} 关 · ${course.title}`, id };
}

function launchPromptFromUrl() {
  const params = new URLSearchParams(window.location.search);
  const course = newbieCourseLaunch(params);
  if (course) {
    resetChat();
    setActiveNewbieCourse(course.id);
    promptInput.value = course.text;
    promptInput.placeholder = "补充你的问题，确认后发送给本关助教";
    heroTitle.textContent = course.title;
    heroSubtitle.textContent = "已带入本关任务和验收标准。补充你卡住的步骤、尝试和报错后发送。";
  } else {
    const prompt = String(params.get("prompt") || "").trim();
    if (!prompt || prompt.length > 500) return;
    resetChat();
    promptInput.value = prompt;
    promptInput.placeholder = params.get("ta") === "1" ? "向实验室 AI 助教提问" : promptInput.placeholder;
  }
  autoResize();
  updateSendState();
  window.setTimeout(() => {
    promptInput.focus();
    promptInput.setSelectionRange(promptInput.value.length, promptInput.value.length);
    promptInput.scrollTop = promptInput.scrollHeight;
  }, 120);
}

function showToast(message) {
  toast.textContent = message;
  toast.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("show"), 1800);
}

function openAuthDialog() {
  authBackdrop.classList.add("open");
  authBackdrop.setAttribute("aria-hidden", "false");
  campusEmailInput.focus();
}

function closeAuthDialog() {
  authBackdrop.classList.remove("open");
  authBackdrop.setAttribute("aria-hidden", "true");
}

function setAuthStatus(message, tone = "") {
  authStatus.textContent = message || "";
  authStatus.className = `auth-status${tone ? ` ${tone}` : ""}`;
}

function updateVisitorUi(user) {
  visitorUser = user || null;
  if (visitorUser) {
    guestBadge.textContent = visitorUser.roleLabel || "已登录";
    guestBadge.classList.add("signed-in");
  } else {
    guestBadge.textContent = "游客模式";
    guestBadge.classList.remove("signed-in");
  }
  updateLoginGuide();
}

function updateLoginGuide() {
  if (!loginGuide) return;
  loginGuide.hidden = Boolean(visitorUser);
}

async function refreshVisitorStatus() {
  try {
    const response = await fetch(apiUrl("/api/visitor/status"), { headers: { accept: "application/json" }, credentials: "same-origin", cache: "no-store" });
    const data = await response.json();
    updateVisitorUi(response.ok && data.signedIn ? data.user : null);
  } catch {
    updateVisitorUi(null);
  }
}

async function requestCampusCode() {
  const email = campusEmailInput.value.trim();
  campusCodeButton.disabled = true;
  setAuthStatus("正在发送验证码…");
  try {
    const response = await fetch(apiUrl("/api/visitor/request-code"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({ email }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "验证码发送失败");
    setAuthStatus(data.devCode ? `预览验证码：${data.devCode}` : "验证码已发送，请查看邮箱。", "success");
    campusCodeInput.focus();
  } catch (error) {
    setAuthStatus(error?.message || "验证码发送失败", "error");
  } finally {
    campusCodeButton.disabled = false;
  }
}

async function verifyCampusCode(event) {
  event.preventDefault();
  const button = campusLoginForm.querySelector(".campus-login-button");
  button.disabled = true;
  setAuthStatus("正在验证…");
  try {
    const response = await fetch(apiUrl("/api/visitor/verify-code"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({ email: campusEmailInput.value.trim(), code: campusCodeInput.value.trim() }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.signedIn) throw new Error(data.error || "登录失败");
    updateVisitorUi(data.user);
    setAuthStatus("登录成功。", "success");
    closeAuthDialog();
    showToast(`已登录：${data.user?.roleLabel || "校内身份"}`);
  } catch (error) {
    setAuthStatus(error?.message || "登录失败", "error");
  } finally {
    button.disabled = false;
  }
}

function updateSendState() {
  const ready = promptInput.value.trim().length > 0 || attachmentChip.classList.contains("show");
  sendButton.disabled = !ready || omRequestPending;
  form.setAttribute("aria-busy", String(omRequestPending));
  sendButton.classList.toggle("ready", ready);
}

function autoResize() {
  promptInput.style.height = "auto";
  promptInput.style.height = `${Math.min(promptInput.scrollHeight, 126)}px`;
}

function messageActions(publicSources = false) {
  return `<div class="message-actions">
    <button class="message-action-button copy-answer" type="button" aria-label="复制回答" title="复制回答">${icons.file}</button>
    <button class="message-action-button copy-answer-link" type="button" aria-label="复制链接" title="复制链接">${icons.link || icons.chat}</button>
    <button class="message-action-button share-answer" type="button" aria-label="分享链接" title="分享链接">${icons.share || icons.chat}</button>
    ${publicSources ? '<span class="message-source-note">参考内部公开资料</span>' : ""}
  </div>`;
}

function setAssistantContent(item, text, { html = false, images = [], publicSources = false } = {}) {
  const content = item.querySelector(".answer-content");
  if (!content) return;
  content.innerHTML = `${html ? text : renderMarkdown(text)}${renderKnowledgeImages(images)}`;
  item.__chatTurn = { role: "assistant", text: String(text || ""), images, publicSources };
  const actions = item.querySelector(".message-actions");
  actions?.querySelector(".message-source-note")?.remove();
  if (publicSources && actions) {
    actions.append(element("span", { className: "message-source-note", text: "参考内部公开资料" }));
  }
  rerenderFallbackMath(content);
}

function addMessage(role, text, { html = false, typing = false, images = [], publicSources = false } = {}) {
  const item = document.createElement("article");
  item.className = `message ${role}${typing ? " typing-message" : ""}`;
  if (typing) item.innerHTML = '<div class="message-content"><div class="typing"><i></i><i></i><i></i></div></div>';
  else if (role === "assistant") item.innerHTML = `<div class="message-content"><div class="answer-content"></div>${messageActions(publicSources)}</div>`;
  else item.innerHTML = '<div class="message-content"><p class="message-body"></p></div>';
  if (!typing) {
    if (role === "assistant") setAssistantContent(item, text, { html, images, publicSources });
    else {
      item.querySelector("p").textContent = text;
      item.__chatTurn = { role: "user", text: String(text || "") };
      installQuestionActions(
        item,
        String(text || ""),
        (opener) => editQuestion(item, opener),
        async () => {
          await writeMessageClipboard(String(text || ""));
          showToast("已复制提问");
        },
      );
    }
  }
  messageList.appendChild(item);
  bindMessageActions(item);
  messageList.scrollTo({ top: messageList.scrollHeight, behavior: "smooth" });
  return item;
}

function answerRevealDelay(chunk) {
  return Math.min(80, Math.max(18, Math.round(String(chunk || "").length * 1.1)));
}

function answerRevealChunks(text) {
  const chunks = String(text || "").match(/[^。！？；\n]+[。！？；\n]+|[^。！？；\n]+$/gu) || [String(text || "")];
  const merged = [];
  for (const chunk of chunks) {
    if (merged.length && (merged.at(-1).length < 28 || chunk.length < 10)) merged[merged.length - 1] += chunk;
    else merged.push(chunk);
  }
  return merged.filter(Boolean);
}

async function revealAssistantAnswer(item, answer, { images = [], publicSources = false } = {}) {
  const chunks = answerRevealChunks(answer);
  let visible = "";
  for (const chunk of chunks) {
    visible += chunk;
    setAssistantContent(item, visible, { images: [], publicSources: false });
    messageList.scrollTo({ top: messageList.scrollHeight, behavior: "smooth" });
    await new Promise((resolve) => setTimeout(resolve, answerRevealDelay(chunk)));
  }
  setAssistantContent(item, answer || "暂时没有生成回答。", { images, publicSources });
}

async function consumeChatStream(response, item) {
  const reader = response.body?.getReader();
  if (!reader) throw new Error("当前浏览器不支持流式回答，请刷新后重试。");
  const decoder = new TextDecoder();
  let buffer = "";
  let draft = "";
  let finalData = null;
  let streamError = null;
  let renderTimer = null;

  const renderDraft = () => {
    renderTimer = null;
    if (draft) {
      setAssistantContent(item, draft);
      messageList.scrollTo({ top: messageList.scrollHeight, behavior: "smooth" });
    }
  };
  const scheduleDraft = () => {
    if (renderTimer === null) renderTimer = window.setTimeout(renderDraft, 36);
  };
  const flushDraft = () => {
    if (renderTimer !== null) window.clearTimeout(renderTimer);
    renderDraft();
  };
  const consume = (frame) => {
    const payload = frame
      .split("\n")
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trimStart())
      .join("\n");
    if (!payload) return;
    let event;
    try { event = JSON.parse(payload); } catch { throw new Error("流式回答格式错误，请稍后重试。"); }
    if (event.type === "status") {
      if (!draft) setAssistantContent(item, event.message || "正在生成回答…");
      return;
    }
    if (event.type === "reset") {
      draft = "";
      if (renderTimer !== null) window.clearTimeout(renderTimer);
      renderTimer = null;
      setAssistantContent(item, event.message || "正在重新生成回答…");
      return;
    }
    if (event.type === "delta" && typeof event.delta === "string") {
      draft += event.delta;
      scheduleDraft();
      return;
    }
    if (event.type === "final" && event.data && typeof event.data === "object") {
      finalData = event.data;
      flushDraft();
      return;
    }
    if (event.type === "error") streamError = new Error(event.message || "服务暂不可用，请稍后重试。");
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true }).replaceAll("\r\n", "\n");
    let boundary;
    while ((boundary = buffer.indexOf("\n\n")) >= 0) {
      consume(buffer.slice(0, boundary));
      buffer = buffer.slice(boundary + 2);
    }
  }
  buffer += decoder.decode().replaceAll("\r\n", "\n");
  if (buffer.trim()) consume(buffer);
  flushDraft();
  if (streamError) throw streamError;
  if (!finalData) throw new Error("回答连接提前结束，请重试。");
  return finalData;
}


function bindMessageActions(scope) {
  const answerText = (button) => button.closest(".message-content")?.querySelector(".answer-content")?.innerText.trim() || "";
  const questionText = (button) => {
    const article = button.closest(".message");
    let previous = article?.previousElementSibling;
    while (previous && !previous.classList.contains("user")) previous = previous.previousElementSibling;
    return previous?.querySelector(".message-body, p")?.innerText.trim() || "";
  };
  scope.querySelectorAll(".copy-answer").forEach((button) => button.addEventListener("click", async () => {
    try { await writeMessageClipboard(answerText(button)); showToast("已复制"); }
    catch { showToast("复制失败，请手动选择文本"); }
  }));
  scope.querySelectorAll(".copy-answer-link").forEach((button) => button.addEventListener("click", () => {
    openAnswerLinkDialog({ v: 1, question: questionText(button), answer: answerText(button) }, button, "copy");
  }));
  scope.querySelectorAll(".share-answer").forEach((button) => button.addEventListener("click", () => {
    openAnswerLinkDialog({ v: 1, question: questionText(button), answer: answerText(button) }, button, "share");
  }));
}

function openAnswerLinkDialog(snapshot, opener, intent) {
  const dialog = messageActionDialog("分享这条问答", opener);
  dialog.append(element("p", { className: "message-dialog-note", text: "仅分享预览中的这一问一答，不包含其他聊天或登录信息。任何获得链接的人都能查看；链接不能撤回，请先确认没有个人或非公开信息。" }));
  answerSharePreview(dialog, snapshot);
  const status = element("p", { className: "message-share-status", attributes: { role: "status", "aria-live": "polite" }, text: "确认后生成链接。" });
  const actions = element("div", { className: "message-dialog-actions" });
  const copy = textButton("确认并复制链接", "primary-button");
  const share = textButton("确认并分享", "secondary-button");
  const run = async (mode) => {
    try {
      status.textContent = "正在生成链接…";
      const url = await createAnswerShareUrl(snapshot, window.location.origin);
      if (mode === "share" && typeof navigator.share === "function") {
        await navigator.share({ title: "ARTS Robotics 问答分享", url });
        status.textContent = "已调用系统分享";
      } else {
        await writeMessageClipboard(url);
        status.textContent = mode === "share" ? "当前浏览器未提供系统分享，链接已复制" : "分享链接已复制";
      }
    } catch (error) {
      status.textContent = error?.name === "AbortError" ? "已取消分享" : error?.message || "分享未完成。";
    }
  };
  copy.addEventListener("click", () => void run("copy"));
  share.addEventListener("click", () => void run("share"));
  actions.append(copy, share);
  dialog.append(status, actions);
  dialog.showModal();
  (intent === "share" ? share : copy).focus({ preventScroll: true });
}

function conversationId() {
  return typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function conversationTitle(turns) {
  const question = turns.find((turn) => turn.role === "user")?.text || "新聊天";
  return question.length > 28 ? `${question.slice(0, 28)}…` : question;
}

function turnsFromDom() {
  return [...messageList.querySelectorAll(".message:not(.typing-message)")]
    .map((node) => node.__chatTurn)
    .filter((turn) => turn?.role === "user" || turn?.role === "assistant")
    .slice(-20);
}

function persistConversations() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      version: 2,
      activeConversationId,
      conversations: conversations.slice(0, 12),
    }));
  } catch { /* Browser storage is optional. */ }
}

function recentButton(conversation, compact = false) {
  const button = textButton("", `history-item${conversation.id === activeConversationId ? " current" : ""}`);
  button.setAttribute("aria-label", `${conversation.title}，最近聊天`);
  button.dataset.conversationId = conversation.id;
  button.append(icon("chat"), element("span", { text: conversation.title }));
  if (compact) button.classList.add("recent-drawer-item");
  button.addEventListener("click", () => {
    renderConversation(conversation.id);
    if (recentDrawer.open) recentDrawer.close();
  });
  return button;
}

function renderRecentConversations() {
  historyList.replaceChildren();
  recentList.replaceChildren();
  if (!conversations.length) {
    for (const [key, label] of HISTORY_ITEMS) {
      const button = textButton("", "history-item");
      button.dataset.history = key;
      button.append(icon("chat"), element("span", { text: label }));
      button.addEventListener("click", () => loadHistory(key));
      historyList.append(button);
    }
    recentList.append(element("p", { className: "recent-empty", text: "提问后，最近聊天会显示在这里。" }));
    return;
  }
  for (const conversation of conversations.slice(0, 8)) {
    historyList.append(recentButton(conversation));
    recentList.append(recentButton(conversation, true));
  }
}

function saveConversation() {
  if (!activeConversationId) return;
  const turns = turnsFromDom();
  if (!turns.length) return;
  const now = Date.now();
  const existing = conversations.find((conversation) => conversation.id === activeConversationId);
  if (existing) {
    existing.turns = turns;
    existing.newbieCourseId = activeNewbieCourseId;
    existing.title = conversationTitle(turns);
    existing.updatedAt = now;
  } else {
    conversations.push({ id: activeConversationId, newbieCourseId: activeNewbieCourseId, title: conversationTitle(turns), turns, updatedAt: now });
  }
  conversations.sort((left, right) => right.updatedAt - left.updatedAt);
  persistConversations();
  renderRecentConversations();
}

function rememberAssistantTurn(id, turn) {
  const conversation = conversations.find((candidate) => candidate.id === id);
  if (!conversation) return;
  conversation.turns = [...conversation.turns, turn].slice(-20);
  conversation.title = conversationTitle(conversation.turns);
  conversation.updatedAt = Date.now();
  conversations.sort((left, right) => right.updatedAt - left.updatedAt);
  persistConversations();
  renderRecentConversations();
}

function createConversation(turns = [], newbieCourseId = "") {
  setActiveNewbieCourse(newbieCourseId);
  const conversation = {
    id: conversationId(),
    newbieCourseId: activeNewbieCourseId,
    title: conversationTitle(turns),
    turns: turns.map((turn) => ({ ...turn })),
    updatedAt: Date.now(),
  };
  conversations.unshift(conversation);
  activeConversationId = conversation.id;
  persistConversations();
  return conversation;
}

function renderConversation(id) {
  const conversation = conversations.find((candidate) => candidate.id === id);
  if (!conversation) return;
  heroTitle.textContent = MODE_COPY[currentMode][0];
  heroSubtitle.textContent = MODE_COPY[currentMode][1];
  activeConversationId = id;
  setActiveNewbieCourse(conversation.newbieCourseId);
  promptInput.value = "";
  promptInput.style.height = "auto";
  promptInput.placeholder = activeNewbieCourseId ? "继续向本关助教提问" : MODE_COPY[currentMode][2];
  updateSendState();
  messageList.replaceChildren();
  body.classList.toggle("chat-active", conversation.turns.length > 0);
  for (const turn of conversation.turns) {
    addMessage(turn.role, turn.text || "", {
      images: turn.images || [],
      publicSources: turn.publicSources === true,
    });
  }
  persistConversations();
  renderRecentConversations();
}

function restoreConversation() {
  let stored = null;
  try { stored = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null"); } catch { stored = null; }
  if (Array.isArray(stored)) {
    const turns = stored
      .filter((turn) => turn?.role === "user" || turn?.role === "assistant")
      .map((turn) => ({ role: turn.role, text: String(turn.text || "") }));
    if (turns.length) createConversation(turns);
  } else if (stored?.version === 2 && Array.isArray(stored.conversations)) {
    conversations = stored.conversations
      .filter((conversation) => typeof conversation?.id === "string" && Array.isArray(conversation.turns))
      .slice(0, 12);
    activeConversationId = conversations.some((conversation) => conversation.id === stored.activeConversationId)
      ? stored.activeConversationId
      : conversations[0]?.id || "";
  }
  if (activeConversationId) renderConversation(activeConversationId);
  else renderRecentConversations();
}

function editQuestion(item, opener) {
  const originalText = String(item.__chatTurn?.text || "");
  openQuestionEditor(originalText, opener, (question) => {
    saveConversation();
    const original = conversations.find((conversation) => conversation.id === activeConversationId);
    const messageIndex = [...messageList.querySelectorAll(".message")].indexOf(item);
    if (!original || messageIndex < 0) throw new Error("当前聊天已变化，请重试。");
    const branch = createConversation(original.turns.slice(0, messageIndex), original.newbieCourseId);
    renderConversation(branch.id);
    void submitMessage(question);
  });
}

async function submitMessage(rawText) {
  if (omRequestPending) return;
  omRequestPending = true; updateSendState();
  try { await submitCourseMessage(rawText); }
  catch (error) { showToast(error?.message || "消息未发送，请重试。"); }
  finally { omRequestPending = false; updateSendState(); }
}

async function submitCourseMessage(rawText) {
  const text = String(rawText || "").trim();
  let fileText = "";
  try {
    const file = fileInput.files?.[0];
    if (file) {
      const attachment = await readCourseAttachment(file);
      composeCourseMessage(text, attachment);
      if (!(await confirmAttachment(attachment))) return;
      fileText = attachment.block;
    } else {
      composeCourseMessage(text, null);
      if (attachmentChip.classList.contains("show")) {
        showToast("附件没有可读取的文件内容，请重新选择；本次未发送。"); return;
      }
    }
  } catch (error) { showToast(error.message); return; }
  if (!text && !fileText) return;
  if (submittedQuestionCount > 0 && !answerMathEngine && !answerMathLoading &&
      answerMathAttempts >= MAX_ANSWER_MATH_ATTEMPTS) {
    answerMathAttempts = 0;
    loadAnswerMathEngine();
  }
  submittedQuestionCount += 1;
  if (!activeConversationId) createConversation([], activeNewbieCourseId);
  const requestConversationId = activeConversationId;
  const requestNewbieCourseId = activeNewbieCourseId;
  body.classList.add("chat-active");
  addMessage("user", [text, fileText].filter(Boolean).join("\n"));
  saveConversation();
  promptInput.value = "";
  promptInput.style.height = "auto";
  fileInput.value = "";
  attachmentChip.classList.remove("show");
  updateSendState();
  const requestMessages = recentRequestMessages(turnsFromDom().map((turn) => ({ role: turn.role, content: userFacingAnswer(turn.text) })));
  const typing = addMessage("assistant", "正在处理问题，请勿重复发送…");
  try {
    const response = await fetch(apiUrl("/api/chat"), {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
      body: JSON.stringify({
        topic: "research",
        messages: requestMessages,
        ...(requestNewbieCourseId ? { newbieCourseId: requestNewbieCourseId } : {}),
      }),
    });
    const streamed = response.headers.get("content-type")?.toLowerCase().startsWith("text/event-stream");
    const data = streamed
      ? await consumeChatStream(response, typing)
      : await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "服务暂不可用，请稍后重试。");
    if (data.learningRecord?.status === "failed" && activeConversationId === requestConversationId) {
      showToast("本次课程提问暂未保存到教师指导记录，回答仍可正常查看。");
    }
    const assistantTurn = {
      role: "assistant",
      text: data.answer || "暂时没有生成回答。",
      images: data.images || [],
      publicSources: data.oaPublicStatus === "connected" && Array.isArray(data.sources) && data.sources.length > 0,
    };
    rememberAssistantTurn(requestConversationId, assistantTurn);
    if (streamed) {
      setAssistantContent(typing, data.answer || "暂时没有生成回答。", {
        images: data.images,
        publicSources: assistantTurn.publicSources,
      });
    } else {
      await revealAssistantAnswer(typing, data.answer || "暂时没有生成回答。", {
        images: data.images,
        publicSources: assistantTurn.publicSources,
      });
    }
  } catch (error) {
    const message = error?.message || "服务暂不可用，请稍后重试。";
    rememberAssistantTurn(requestConversationId, { role: "assistant", text: message, images: [], publicSources: false });
    setAssistantContent(typing, message);
  }
  if (activeConversationId === requestConversationId) saveConversation();
}



function resetChat() {
  setActiveNewbieCourse("");
  promptInput.placeholder = MODE_COPY[currentMode][2];
  heroTitle.textContent = MODE_COPY[currentMode][0];
  heroSubtitle.textContent = MODE_COPY[currentMode][1];
  messageList.innerHTML = "";
  promptInput.value = "";
  promptInput.style.height = "auto";
  fileInput.value = "";
  attachmentChip.classList.remove("show");
  body.classList.remove("chat-active");
  activeConversationId = "";
  persistConversations();
  renderRecentConversations();
  updateSendState();
  setTimeout(() => promptInput.focus(), 220);
}

function loadHistory(key) {
  const examples = {
    overview: [["user", "实验室主要研究什么？"], ["assistant", "我会从已审核的实验室公开知识中检索研究方向、项目与成果，并给出结构化回答。"]],
    robots: [["user", "实验室现有的机器人平台包括哪些？"], ["assistant", "接入公开知识库后，我会按机器人平台、核心能力、应用场景和资料来源整理回答。"]],
    cooperation: [["user", "如何与实验室开展科研合作？"], ["assistant", "我会根据实验室公开信息说明合作方向、联系渠道和申请要求。"]],
  };
  const existing = conversations.find((conversation) => conversation.id === key);
  if (existing) {
    renderConversation(existing.id);
    return;
  }
  messageList.innerHTML = "";
  body.classList.add("chat-active");
  for (const [role, text] of examples[key] || examples.overview) addMessage(role, text);
  const preview = createConversation(turnsFromDom());
  renderConversation(preview.id);
}

async function refreshSuggestions() {
  try {
    const response = await fetch(apiUrl("/api/suggestions"));
    const data = await response.json();
    const suggestions = (Array.isArray(data.suggestions) ? data.suggestions : []).map((item) => typeof item === "string" ? item : item.question).filter(Boolean).slice(0, 4);
    if (!suggestions.length) return;
    document.querySelector(".suggestions").innerHTML = suggestions.map((question, index) => `<button class="suggestion" type="button" data-prompt="${escapeHtml(question)}">${[icons.file, icons.text, icons.chart, icons.pen][index] || icons.chat}<span>${escapeHtml(question.replace(/[？?]$/u, ""))}</span></button>`).join("");
    bindSuggestions();
  } catch { /* keep defaults */ }
}

async function refreshStatus() {
  try {
    const response = await fetch(apiUrl("/api/status"));
    const status = await response.json();
    if (status && status.storageReady === false) showToast("资料服务暂不可用");
  } catch { /* visual preview can be static */ }
}

function bindSuggestions() {
  document.querySelectorAll(".suggestion").forEach((item) => item.addEventListener("click", () => submitMessage(item.dataset.prompt)));
}

form.addEventListener("submit", (event) => { event.preventDefault(); submitMessage(promptInput.value); });
promptInput.addEventListener("input", () => { autoResize(); updateSendState(); });
promptInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey && !event.isComposing) { event.preventDefault(); form.requestSubmit(); }
});

document.querySelector(".attach-button").addEventListener("click", () => fileInput.click());
fileInput.addEventListener("change", () => {
  const file = fileInput.files[0];
  if (!file) return;
  attachmentName.textContent = file.name;
  attachmentChip.classList.add("show");
  updateSendState();
});
voiceButton.addEventListener("click", () => showToast("语音输入将在正式服务中启用"));

document.querySelectorAll(".model-nav-item").forEach((item) => item.addEventListener("click", () => {
  document.querySelectorAll(".model-nav-item").forEach((button) => button.classList.remove("active"));
  item.classList.add("active");
  currentMode = item.dataset.mode;
  const copy = MODE_COPY[currentMode];
  heroTitle.textContent = copy[0];
  heroSubtitle.textContent = copy[1];
  promptInput.placeholder = copy[2];
  modelPillLabel.textContent = copy[3];
}));

document.querySelector(".new-chat-bottom").addEventListener("click", resetChat);
document.querySelectorAll(".history-item").forEach((item) => item.addEventListener("click", () => loadHistory(item.dataset.history)));
document.querySelector(".recent-chat-trigger").addEventListener("click", () => {
  renderRecentConversations();
  recentDrawer.showModal();
});
document.querySelector(".recent-drawer-close").addEventListener("click", () => recentDrawer.close());
document.querySelector(".collapse-handle").addEventListener("click", () => body.classList.toggle("sidebar-collapsed"));
document.querySelector(".model-pill").addEventListener("click", () => showToast(`当前使用${MODE_COPY[currentMode][3]}`));
document.querySelectorAll(".settings-trigger").forEach((button) => button.addEventListener("click", () => window.location.assign("/newbie-village")));
document.querySelectorAll(".student-login-trigger").forEach((button) => button.addEventListener("click", openAuthDialog));
campusCodeButton.addEventListener("click", () => void requestCampusCode());
campusLoginForm.addEventListener("submit", (event) => void verifyCampusCode(event));
document.querySelector(".guest-continue").addEventListener("click", closeAuthDialog);
document.querySelector(".auth-close").addEventListener("click", closeAuthDialog);
authBackdrop.addEventListener("click", (event) => { if (event.target === authBackdrop) closeAuthDialog(); });
document.addEventListener("keydown", (event) => { if (event.key === "Escape" && authBackdrop.classList.contains("open")) closeAuthDialog(); });

bindSuggestions();
restoreConversation();
launchPromptFromUrl();
refreshSuggestions();
refreshStatus();
refreshVisitorStatus();
updateSendState();
