(() => {
  const screen = document.getElementById('intro-screen');
  const motion = matchMedia('(prefers-reduced-motion: reduce)');
  const navigation = performance.getEntriesByType('navigation')[0];
  if (!screen || motion.matches || location.hash || navigation?.type === 'back_forward') return;

  const started = performance.now();
  const deadline = setTimeout(beginFade, 2250);
  let readyTimer;
  let fadeTimer;

  function hide() {
    clearTimeout(deadline);
    clearTimeout(readyTimer);
    clearTimeout(fadeTimer);
    window.removeEventListener('load', ready);
    window.removeEventListener('pagehide', hide);
    motion.removeEventListener('change', hide);
    document.removeEventListener('focusin', hide);
    screen.removeEventListener('pointerdown', hide);
    screen.hidden = true;
  }

  function beginFade() {
    clearTimeout(deadline);
    clearTimeout(readyTimer);
    window.removeEventListener('load', ready);
    screen.classList.add('intro-leaving');
    fadeTimer = setTimeout(hide, 200);
  }

  function ready() {
    readyTimer = setTimeout(beginFade, Math.max(0, 1650 - (performance.now() - started)));
  }

  window.addEventListener('pagehide', hide, { once: true });
  motion.addEventListener('change', hide, { once: true });
  document.addEventListener('focusin', hide, { once: true });
  screen.addEventListener('pointerdown', hide, { once: true });
  if (document.readyState === 'complete') ready();
  else window.addEventListener('load', ready, { once: true });
  screen.hidden = false;
})();
