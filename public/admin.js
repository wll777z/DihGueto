import { request, submit, money, dateLabel, names } from './shared.js';

const settings = document.querySelector('#settings');
const settingsStatus = document.querySelector('#settings-status');
const period = document.querySelector('#period');
const reportStatus = document.querySelector('#report-status');
const mailConfig = document.querySelector('#mail-config');
let notificationsConfigured = false;
try {
  const result = await request('/api/admin/notifications');
  notificationsConfigured = result.configured;
  mailConfig.textContent = notificationsConfigured ? 'Envio de confirmações configurado.' :
    'Confirmações por e-mail aguardam a configuração do remetente e do endereço do barbeiro.';
} catch (error) { mailConfig.textContent = error.message; }
const deliveryLabels = { aceito: 'encaminhado', falhou: 'falhou', pendente: 'pendente' };
const container = document.querySelector('#entries');
const statusNames = { reservado: 'Reservado', cancelado: 'Cancelado', concluido: 'Concluído', faltou: 'Faltou' };
const format = new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/Sao_Paulo', dateStyle: 'short', timeStyle: 'short' });
const today = format.format(new Date()).slice(0, 10);
const lastDay = new Date(Date.UTC(Number(today.slice(0, 4)), Number(today.slice(5, 7)), 0)).toISOString().slice(0, 10);
period.elements.from.value = today.slice(0, 7) + '-01';
period.elements.to.value = lastDay;

function paragraph(tag, text) {
  const element = document.createElement(tag);
  element.textContent = text;
  return element;
}
function card(entry) {
  const section = document.createElement('article');
  section.className = 'entry';
  section.append(paragraph('h3', dateLabel(entry.date) + ' às ' + entry.time + ' · ' + names[entry.service]),
    paragraph('p', entry.name + ' · ' + entry.phone + (entry.email ? ' · ' + entry.email : '')),
    paragraph('p', statusNames[entry.status] + ' · ' + money(entry.price)));
  if (entry.email) {
    section.append(paragraph('p', 'E-mail do cliente: ' + deliveryLabels[entry.delivery?.client || 'pendente'] +
      ' · E-mail do barbeiro: ' + deliveryLabels[entry.delivery?.barber || 'pendente']));
  }
  if (entry.status === 'reservado') {
    const actions = document.createElement('div');
    actions.className = 'entry-actions';
    const past = entry.date + ' ' + entry.time <= format.format(new Date());
    for (const [status, label] of Object.entries({ concluido: 'Concluir', faltou: 'Registrar falta', cancelado: 'Cancelar' })) {
      if (!past && status !== 'cancelado') continue;
      const button = paragraph('button', label);
      button.type = 'button';
      button.className = 'button secondary';
      button.addEventListener('click', async () => {
        if (!window.confirm(label + ' o atendimento de ' + entry.name + '?')) return;
        for (const item of actions.children) item.disabled = true;
        try {
          await request('/api/admin/status', { date: entry.date, id: entry.id, status });
          await report();
        } catch (error) { reportStatus.textContent = error.message; }
        finally { for (const item of actions.children) item.disabled = false; }
      });
      actions.append(button);
    }
    if (notificationsConfigured && entry.email && (entry.delivery?.client !== 'aceito' || entry.delivery?.barber !== 'aceito')) {
      const retry = paragraph('button', 'Tentar enviar e-mails novamente');
      retry.type = 'button';
      retry.className = 'button secondary';
      retry.addEventListener('click', async () => {
        for (const item of actions.children) item.disabled = true;
        try {
          await request('/api/admin/notifications', { date: entry.date, id: entry.id });
          await report();
        } catch (error) { reportStatus.textContent = error.message; }
        finally { for (const item of actions.children) item.disabled = false; }
      });
      actions.append(retry);
    }
    section.append(actions);
  }
  return section;
}
let reportVersion = 0;
async function report() {
  const current = ++reportVersion;
  const query = new URLSearchParams(new FormData(period));
  reportStatus.textContent = 'Consultando…';
  try {
    const result = await request('/api/admin/report?' + query);
    if (current !== reportVersion) return;
    for (const key of ['revenue', 'projected', 'completed', 'upcoming', 'clients']) {
      document.querySelector('#' + key).textContent = ['revenue', 'projected'].includes(key) ? money(result[key]) : result[key];
    }
    container.replaceChildren(...result.entries.map(card));
    reportStatus.textContent = result.entries.length ? result.entries.length + ' registro(s) no período.' : 'Nenhuma reserva no período.';
  } catch (error) {
    if (current === reportVersion) {
      container.replaceChildren();
      for (const item of document.querySelectorAll('.metrics dd')) item.textContent = '—';
      reportStatus.textContent = error.message;
    }
  }
}

period.addEventListener('submit', (event) => {
  event.preventDefault();
  report();
});
report();

try {
  const config = await request('/api/admin/settings');
  settings.elements.enabled.checked = config.enabled;
  settings.elements.open.value = config.open;
  settings.elements.close.value = config.close;
  for (const item of settings.querySelectorAll('[name="day"]')) item.checked = config.days.includes(Number(item.value));
  for (const [key, value] of Object.entries(config.services)) {
    settings.elements[key + '-price'].value = (value.price / 100).toFixed(2);
    settings.elements[key + '-duration'].value = value.duration;
  }
  settings.hidden = false;
} catch (error) { settingsStatus.textContent = error.message; }

settings.addEventListener('submit', (event) => {
  event.preventDefault();
  submit(settings, settingsStatus, async (values) => {
    await request('/api/admin/settings', {
      enabled: settings.elements.enabled.checked,
      days: new FormData(settings).getAll('day').map(Number),
      open: values.open, close: values.close,
      services: Object.fromEntries(Object.keys(names).map((key) => [key, {
        price: Math.round(Number(values[key + '-price']) * 100),
        duration: Number(values[key + '-duration']),
      }])),
    });
    settingsStatus.textContent = 'Configuração salva.';
  });
});
