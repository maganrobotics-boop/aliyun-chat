(() => {
  'use strict';
  const OA = 'https://oa.omindos.cn/';
  const NAV = [
    ['courses', '课程', '/newbie-village#courses', '<path d="M3 4h6a4 4 0 0 1 3 2 4 4 0 0 1 3-2h6v15h-6a4 4 0 0 0-3 2 4 4 0 0 0-3-2H3z"/><path d="M12 6v15"/>'],
    ['tutor', '助教', '/?ta=1', '<path d="M4 4h16v12H9l-5 4z"/><path d="M8 8h8M8 12h5"/>'],
    ['progress', '进度', '/newbie-village#progress', '<path d="M4 20h16M6 16v-5M12 16V5M18 16V8"/>'],
    ['profile', '我的', '/newbie-village#profile', '<circle cx="12" cy="8" r="4"/><path d="M4 21v-2a8 8 0 0 1 16 0v2"/>'],
  ];

  function holdToSwitch(button) {
    let timer = null, origin = null, switched = false;
    const cancel = () => { clearTimeout(timer); timer = null; origin = null; };
    const start = () => {
      cancel(); switched = false;
      timer = setTimeout(() => { switched = true; cancel(); location.assign(OA); }, 3000);
    };
    button.title = '长按 3 秒切换到 OA';
    button.setAttribute('aria-label', '我的；长按 3 秒切换到 OA');
    button.addEventListener('pointerdown', (event) => {
      if (!event.isPrimary || event.button !== 0) return;
      start(); origin = [event.clientX, event.clientY];
    });
    button.addEventListener('pointermove', (event) => {
      if (origin && Math.hypot(event.clientX - origin[0], event.clientY - origin[1]) > 12) cancel();
    });
    for (const name of ['pointerup', 'pointercancel', 'pointerleave', 'blur']) button.addEventListener(name, cancel);
    button.addEventListener('contextmenu', (event) => event.preventDefault());
    button.addEventListener('keydown', (event) => {
      if ((event.key === ' ' || event.key === 'Enter') && !event.repeat) start();
    });
    button.addEventListener('keyup', cancel);
    button.addEventListener('click', (event) => {
      if (switched) { event.preventDefault(); event.stopImmediatePropagation(); }
    }, true);
    window.addEventListener('blur', cancel);
    document.addEventListener('visibilitychange', () => { if (document.hidden) cancel(); });
  }

  function mount() {
    const villageNav = document.querySelector('.workspace-bottom-nav');
    document.documentElement.dataset.workspaceRelease = '20260927-r2';
    if (villageNav) {
      document.body.classList.add('chat-workspace-view');
      villageNav.setAttribute('aria-label', 'Chat 主导航');
      const profile = villageNav.querySelector('[data-view="profile"]');
      if (profile) holdToSwitch(profile);
      villageNav.addEventListener('click', (event) => {
        const button = event.target.closest('[data-view="tutor"]');
        if (!button) return;
        event.preventDefault(); event.stopImmediatePropagation();
        location.assign('/?ta=1');
      }, true);
      for (const dialog of document.querySelectorAll('dialog.modal')) {
        dialog.classList.add('workspace-fullscreen-page');
        dialog.setAttribute('aria-modal', 'false');
      }
      const taskBack = document.querySelector('.task-close');
      if (taskBack) { taskBack.textContent = '返回课程'; taskBack.setAttribute('aria-label', '返回课程'); }
      const heading = document.querySelector('#profile-heading');
      if (heading) heading.textContent = '我的';
      const saveProfile = document.querySelector('.profile-form button[type="submit"]');
      if (saveProfile) saveProfile.textContent = '保存资料';
      document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') [...document.querySelectorAll('dialog[open]')].at(-1)?.close();
      });
      // Old shared tutor links keep working, using the original chat page.
      const routeTutor = () => { if (location.hash === '#tutor') location.replace('/?ta=1'); };
      window.addEventListener('hashchange', routeTutor);
      routeTutor();
    } else if (document.getElementById('app') && location.pathname !== '/manage') {
      document.body.classList.add('chat-assistant-view');
      const nav = document.createElement('nav');
      nav.className = 'workspace-bottom-nav workspace-chat-nav';
      nav.setAttribute('aria-label', 'Chat 主导航');
      for (const [key, label, href, icon] of NAV) {
        const link = document.createElement('a');
        link.className = `workspace-nav-button${key === 'tutor' ? ' active' : ''}`;
        link.href = href;
        link.dataset.view = key;
        if (key === 'tutor') link.setAttribute('aria-current', 'page');
        link.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true">${icon}</svg><span>${label}</span>`;
        nav.append(link);
        if (key === 'profile') holdToSwitch(link);
      }
      document.body.append(nav);
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount, { once: true });
  else mount();
})();
