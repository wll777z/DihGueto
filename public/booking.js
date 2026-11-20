import { request, submit, money, dateLabel, names } from './shared.js';

const form = document.querySelector('#booking');
const availability = document.querySelector('#availability');
const status = document.querySelector('#booking-status');
const service = document.querySelector('#service');
const date = document.querySelector('#date');
const time = document.querySelector('#time');
const cancel = document.querySelector('#cancel');
let lightsAvailable = false;
const cancelStatus = document.querySelector('#cancel-status');
let version = 0;
let serviceDetails = {};
const summary = document.querySelector('#service-summary');

function updateSummary() {
  const details = serviceDetails[service.value];
  summary.textContent = details ? names[service.value] + ' · ' + details.duration + ' min · ' + money(details.price) : '';
}

function placeholder(label) {
  time.replaceChildren(new Option(label, ''));
  time.disabled = true;
}

async function refresh() {
  const current = ++version;
  if (!date.value || !date.validity.valid) {
    placeholder('Escolha uma data válida');
    return;
  }
  placeholder('Carregando horários…');
  try {
    const query = new URLSearchParams({ date: date.value, service: service.value });
    const { times } = await request('/api/slots?' + query);
    if (current !== version) return;
    placeholder(times.length ? 'Selecione um horário' : 'Sem horários nesta data');
    if (times.length) {
      time.append(...times.map((value) => new Option(value, value)));
      time.disabled = false;
    }
  } catch (error) {
    if (current === version) placeholder(error.message);
  }
}

try {
  const config = await request('/api/config');
  availability.textContent = config.enabled ? '' : 'A agenda ainda está fechada para novas reservas.';
  if (config.enabled) {
    serviceDetails = config.services;
    date.min = config.today;
    date.max = config.lastDay;
    date.value = config.today;
    form.hidden = false;
    lightsAvailable = config.services.luzes.price > 0;
    if (!lightsAvailable) service.querySelector('[value=luzes]').remove();
    for (const [key, details] of Object.entries(config.services)) {
      if (key === 'luzes' && !lightsAvailable) continue;
      [...service.options].find((option) => option.value === key).textContent =
        names[key] + ' · ' + details.duration + ' min · ' + money(details.price);
    }
    updateSummary();
    refresh();
  }
} catch (error) {
  availability.textContent = error.message;
}

date.addEventListener('change', refresh);
service.addEventListener('change', () => { updateSummary(); refresh(); });
for (const link of document.querySelectorAll('[data-service]')) {
  link.addEventListener('click', () => {
    if (link.dataset.service === 'luzes' && !lightsAvailable && !form.hidden) {
      status.textContent = 'Luzes ainda não tem horários disponíveis para reserva.';
      return;
    }
    status.textContent = '';
    service.value = link.dataset.service;
    updateSummary();
    if (!form.hidden) refresh();
  });
}

form.addEventListener('submit', (event) => {
  event.preventDefault();
  if (time.disabled || !time.value) {
    status.textContent = 'Selecione um horário disponível.';
    return;
  }
  submit(form, status, async (data) => {
    try {
      const booking = await request('/api/book', data);
      status.textContent = names[booking.service] + ' confirmado em ' + dateLabel(booking.date) + ' às ' + booking.time +
        '. Guarde o código da reserva: ' + booking.id + (booking.emailStatus === 'aceito' ?
          '. A confirmação por e-mail foi encaminhada.' : '. A reserva está confirmada no site. O e-mail ainda não foi enviado.');
      form.elements.namedItem('name').value = '';
      form.elements.namedItem('phone').value = '';
      form.elements.namedItem('email').value = '';
    } finally { refresh(); }
  });
});

cancel.addEventListener('submit', (event) => {
  event.preventDefault();
  if (!window.confirm('Cancelar este horário?')) return;
  submit(cancel, cancelStatus, async (data) => {
    await request('/api/cancel', { date: data.date, id: data.id.trim().toLowerCase() });
    cancelStatus.textContent = 'Reserva cancelada.';
    cancel.reset();
    if (!form.hidden) refresh();
  });
});
