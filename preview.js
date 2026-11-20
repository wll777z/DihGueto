(() => {
  const form = document.getElementById('preview-booking');
  const service = document.getElementById('preview-service');
  const date = document.getElementById('preview-date');
  const time = document.getElementById('preview-time');
  const result = document.getElementById('preview-result');
  const dateFormat = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short' });

  const today = new Date();
  const localDay = new Date(today.getTime() - today.getTimezoneOffset() * 60_000);
  date.min = localDay.toISOString().slice(0, 10);
  date.value = date.min;

  for (const link of document.querySelectorAll('[data-service]')) {
    link.addEventListener('click', () => {
      service.value = link.dataset.service;
      result.textContent = '';
    });
  }

  form.addEventListener('change', () => { result.textContent = ''; });
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const day = dateFormat.format(new Date(date.value + 'T12:00'));
    result.textContent = service.selectedOptions[0].textContent + ' em ' + day + ' às ' +
      time.value + '. Simulação concluída.';
  });
  form.hidden = false;
})();
