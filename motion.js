(() => {
  const preference = matchMedia('(prefers-reduced-motion: reduce)');
  if (preference.matches || !('IntersectionObserver' in window)) return;

  const nodes = [...document.querySelectorAll('[data-motion]')];
  const waiting = new Set();
  const playing = new Set();
  const observer = new IntersectionObserver((entries) => {
    for (const { target, isIntersecting, intersectionRatio } of entries) {
      if (isIntersecting && waiting.has(target) &&
          (target.dataset.motion === 'fade' || intersectionRatio >= 0.2)) reveal(target, true);
    }
  }, { threshold: [0, 0.2] });

  function clear() {
    observer.disconnect();
    for (const node of waiting) node.classList.remove('entry-wait');
    for (const node of playing) node.classList.remove('entry-run');
    waiting.clear();
    playing.clear();
    preference.removeEventListener('change', onPreference);
    document.removeEventListener('focusin', onFocus);
    document.removeEventListener('animationend', onAnimationDone);
    document.removeEventListener('animationcancel', onAnimationDone);
    window.removeEventListener('pagehide', clear);
  }
  function clearWhenDone() {
    if (waiting.size === 0 && playing.size === 0) clear();
  }
  function finish(node) {
    playing.delete(node);
    node.classList.remove('entry-run');
    clearWhenDone();
  }
  function onAnimationDone(event) {
    if (event.animationName === 'entry-in' && playing.has(event.target)) finish(event.target);
  }
  function onPreference(event) {
    if (event.matches) clear();
  }
  function onFocus(event) {
    const node = event.target.closest('[data-motion]');
    if (waiting.has(node)) reveal(node, false);
    else if (playing.has(node)) finish(node);
  }
  function reveal(node, animate) {
    observer.unobserve(node);
    waiting.delete(node);
    node.classList.remove('entry-wait');
    if (animate && !preference.matches) {
      playing.add(node);
      node.classList.add('entry-run');
    }
    clearWhenDone();
  }

  try {
    preference.addEventListener('change', onPreference);
    document.addEventListener('focusin', onFocus);
    document.addEventListener('animationend', onAnimationDone);
    document.addEventListener('animationcancel', onAnimationDone);
    window.addEventListener('pagehide', clear, { once: true });
    for (const node of nodes) {
      observer.observe(node);
      waiting.add(node);
      node.classList.add('entry-wait');
    }
    clearWhenDone();
  } catch {
    clear();
  }
})();
