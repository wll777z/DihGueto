(() => {
  const decoration = document.getElementById('scroll-tools');
  if (!decoration) return;

  const [clipper, scissors] = decoration.children;
  const motion = matchMedia('(prefers-reduced-motion: reduce)');
  let width = 0;
  let height = 0;
  let target = Math.max(0, window.scrollY);
  let position = target;
  let frame = null;
  let previousTime = null;

  function schedule() {
    if (frame === null) frame = requestAnimationFrame(draw);
  }

  function draw(time) {
    frame = null;
    const elapsed = previousTime === null ? 16 : Math.min(48, Math.max(1, time - previousTime));
    const distance = target - position;
    const moving = Math.abs(distance) > .5;
    const step = moving ? distance * (1 - Math.exp(-elapsed / 110)) : distance;
    position = moving ? position + step : target;
    const pace = moving ? Math.min(1, Math.abs(step) / elapsed) : 0;

    const compact = width <= 840;
    const size = compact ? 30 : 44;
    const edge = compact ? 2 : Math.min(30, width * .015);
    const drift = compact ? 3 : Math.min(14, width * .012);
    const ceiling = Math.min(compact ? 86 : 104, height * .23);
    const floor = Math.min(108, height * .26);
    const travel = Math.max(0, height - ceiling - floor - size);
    const phase = position / Math.max(550, height) * 1.8;
    const xLeft = edge + drift * (.5 + .5 * Math.sin(phase - .35));
    const xRight = width - size - edge - drift * (.5 + .5 * Math.cos(phase + .85));
    const clipperY = ceiling + travel * (.52 + .37 * Math.sin(phase - .7));
    const scissorsY = ceiling + travel * (.49 + .39 * Math.sin(phase + 1.45));
    const lean = Math.sign(step) * pace * 5;
    const clipperAngle = Math.sin(phase) * 8 + lean;
    const scissorsAngle = Math.cos(phase + .5) * 10 - lean;
    const snip = 13 - pace * (5 + 5 * Math.cos(position / 34));
    const bladeShift = pace * .9 * Math.sin(position / 12);

    clipper.style.transform = `translate3d(${xLeft}px, ${clipperY}px, 0) rotate(${clipperAngle}deg)`;
    clipper.style.setProperty('--clipper-blade-shift', `${bladeShift}px`);
    scissors.style.transform = `translate3d(${xRight}px, ${scissorsY}px, 0) rotate(${scissorsAngle}deg)`;
    scissors.style.setProperty('--shear-angle', `${snip}deg`);
    decoration.classList.toggle('is-scrolled', target > 22);

    previousTime = moving ? time : null;
    if (moving) schedule();
  }

  function update() {
    if (motion.matches) return;
    target = Math.max(0, window.scrollY);
    schedule();
  }

  function resize() {
    width = document.documentElement.clientWidth;
    height = document.documentElement.clientHeight;
    update();
  }

  function stop() {
    if (frame !== null) cancelAnimationFrame(frame);
    frame = null;
    previousTime = null;
    decoration.classList.remove('is-scrolled');
  }

  function resume() {
    stop();
    position = Math.max(0, window.scrollY);
    resize();
  }

  window.addEventListener('scroll', update, { passive: true });
  window.addEventListener('resize', resize, { passive: true });
  window.addEventListener('pagehide', stop);
  window.addEventListener('pageshow', resume);
  motion.addEventListener('change', resume);
  decoration.hidden = false;
  resize();
})();
