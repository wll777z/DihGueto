import assets from './assets.mjs';

const services = { corte: 'Corte', barba: 'Barba', combo: 'Corte + barba', luzes: 'Luzes' };
const pendingConfig = {
  enabled: false, days: [2, 3, 4, 5, 6], open: '09:00', close: '18:00',
  services: { corte: { duration: 45, price: 0 }, barba: { duration: 30, price: 0 }, combo: { duration: 60, price: 0 }, luzes: { duration: 90, price: 0 } },
};
const zone = 'America/Sao_Paulo';
const timeFormat = new Intl.DateTimeFormat('sv-SE', { timeZone: zone, dateStyle: 'short', timeStyle: 'short' });
const clock = () => timeFormat.format(new Date());
const dayPattern = /^\d{4}-\d{2}-\d{2}$/;
const timePattern = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
const minutes = (value) => Number(value.slice(0, 2)) * 60 + Number(value.slice(3));
const hhmm = (value) => [Math.floor(value / 60), value % 60].map((part) => String(part).padStart(2, '0')).join(':');
const validDay = (value) => typeof value === 'string' && dayPattern.test(value) &&
  !Number.isNaN(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
const addDays = (value, count) => new Date(Date.parse(value) + count * 86400000).toISOString().slice(0, 10);
const hasService = (value) => typeof value === 'string' && Object.hasOwn(services, value);
const missing = (status, message) => Response.json({ error: message }, { status, headers: { 'Cache-Control': 'no-store' } });
const okay = (body) => Response.json(body, { headers: { 'Cache-Control': 'no-store' } });
const dayKey = (date) => 'agenda/' + date;
const uuid = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const categories = ['cortes', 'luzes'];
const photoName = /^galeria\/(cortes|luzes)\/\d{13}-[a-f0-9-]{36}$/;
const emailPattern = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;
const mailKeys = ['client', 'barber'];
const active = (entry) => entry.status === 'reservado' || entry.status === 'concluido';

async function read(bucket, key, fallback) {
  const object = await bucket.get(key);
  return object ? { data: await object.json(), etag: object.etag } : { data: fallback, etag: null };
}

async function revise(bucket, key, fallback, update) {
  for (let attempt = 0; attempt < 6; attempt++) {
    const { data, etag } = await read(bucket, key, fallback);
    const next = update(data);
    if (next instanceof Response) return next;
    const stored = await bucket.put(key, JSON.stringify(next.data), {
      onlyIf: etag ? { etagMatches: etag } : { etagDoesNotMatch: '*' },
      httpMetadata: { contentType: 'application/json' },
    });
    if (stored) return okay(next.result);
  }
  return missing(409, 'A agenda mudou agora. Atualize a página e tente novamente.');
}

async function readConfig(bucket) {
  const { data } = await read(bucket, 'config', pendingConfig);
  return { ...data, services: { ...pendingConfig.services, ...data.services } };
}

function mailReady(env) {
  return Boolean(env.RESEND_API_KEY && env.BOOKING_FROM_EMAIL && emailPattern.test(env.BARBER_EMAIL || ''));
}

async function notify(env, booking) {
  const delivery = { client: 'pendente', barber: 'pendente', ...booking.delivery };
  if (!mailReady(env)) return delivery;
  const day = booking.date.split('-').reverse().join('/');
  const summary = services[booking.service] + ' em ' + day + ', às ' + booking.time + ' (horário de Brasília).';
  const customer = 'Sua reserva na DihGuetto está confirmada.\n' + summary +
    '\nValor: ' + (booking.price / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) +
    '\nCódigo de cancelamento: ' + booking.id;
  const barber = 'Nova reserva na DihGuetto.\n' + summary + '\nCliente: ' + booking.name +
    '\nCelular: ' + booking.phone + '\nE-mail: ' + booking.email;
  await Promise.all(mailKeys.map(async (key) => {
    if (delivery[key] === 'aceito') return;
    try {
      const response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: 'Bearer ' + env.RESEND_API_KEY,
          'Content-Type': 'application/json',
          'Idempotency-Key': 'dihguetto/' + booking.id + '/' + key,
        },
        body: JSON.stringify({
          from: env.BOOKING_FROM_EMAIL,
          to: [key === 'client' ? booking.email : env.BARBER_EMAIL],
          subject: key === 'client' ? 'Reserva confirmada | DihGuetto' : 'Nova reserva | DihGuetto',
          text: key === 'client' ? customer : barber,
        }),
        signal: AbortSignal.timeout(6500),
      });
      delivery[key] = response.ok ? 'aceito' : 'falhou';
      if (!response.ok) console.error('Notificação de reserva:', key, response.status);
      await response.body?.cancel();
    } catch {
      delivery[key] = 'falhou';
    }
  }));
  await revise(env.BUCKET, dayKey(booking.date), [], (entries) => ({
    data: entries.map((item) => {
      if (item.id !== booking.id) return item;
      return { ...item, delivery: Object.fromEntries(mailKeys.map((key) => [
        key, item.delivery?.[key] === 'aceito' ? 'aceito' : delivery[key],
      ])) };
    }),
    result: {},
  }));
  return delivery;
}

async function gallery(bucket, limit) {
  const results = await Promise.all(categories.map(async (category) => {
    const page = await bucket.list({ prefix: 'galeria/' + category + '/', limit, include: ['customMetadata'] });
    return [category, page.objects.map((object) => ({
      url: '/media/' + object.key.slice('galeria/'.length), caption: object.customMetadata?.caption || '',
    }))];
  }));
  return Object.fromEntries(results);
}

async function uploadPhoto(request, bucket) {
  const length = Number(request.headers.get('Content-Length'));
  if (length > 3_250_000) return missing(413, 'Envie uma imagem de até 3 MB.');
  let form;
  try { form = await request.formData(); } catch { return missing(400, 'Foto inválida.'); }
  const category = form.get('category');
  const image = form.get('photo');
  const caption = form.get('caption');
  const expected = { 'image/jpeg': [255, 216, 255], 'image/png': [137, 80, 78, 71, 13, 10, 26, 10], 'image/webp': [82, 73, 70, 70] };
  if (!categories.includes(category) || !(image instanceof File) || !Object.hasOwn(expected, image.type) ||
      image.size < 12 || image.size > 3_000_000 || typeof caption !== 'string' || caption.trim().length > 100)
    return missing(400, 'Escolha uma categoria e uma foto JPG, PNG ou WebP de até 3 MB.');
  const signature = new Uint8Array(await image.slice(0, 12).arrayBuffer());
  if (!expected[image.type].every((byte, index) => signature[index] === byte) ||
      (image.type === 'image/webp' && String.fromCharCode(...signature.slice(8)) !== 'WEBP'))
    return missing(400, 'Formato de imagem inválido.');
  const key = 'galeria/' + category + '/' + String(9999999999999 - Date.now()) + '-' + crypto.randomUUID();
  await bucket.put(key, image.stream(), { httpMetadata: { contentType: image.type }, customMetadata: { caption: caption.trim() } });
  return okay({ url: '/media/' + key.slice('galeria/'.length) });
}

function slots(config, date, service, entries, now) {
  if (!config.enabled || !config.days.includes(new Date(date).getUTCDay()) ||
      date < now.slice(0, 10) || date > addDays(now.slice(0, 10), 45)) return [];
  if (service === 'luzes' && config.services.luzes.price === 0) return [];
  const duration = config.services[service].duration;
  const times = [];
  for (let start = minutes(config.open); start + duration <= minutes(config.close); start += 15) {
    const time = hhmm(start);
    if (date + ' ' + time <= now) continue;
    const overlaps = entries.some((item) => active(item) && start < minutes(item.time) + item.duration && start + duration > minutes(item.time));
    if (!overlaps) times.push(time);
  }
  return times;
}

function validatedSettings(body) {
  if (typeof body?.enabled !== 'boolean' || !Array.isArray(body.days) || body.days.length > 7 ||
      body.days.some((day) => !Number.isInteger(day) || day < 0 || day > 6) ||
      typeof body.open !== 'string' || typeof body.close !== 'string' ||
      !timePattern.test(body.open) || !timePattern.test(body.close) || minutes(body.open) >= minutes(body.close) ||
      minutes(body.open) % 15 || minutes(body.close) % 15) return null;
  if (body.enabled && body.days.length === 0) return null;
  const items = {};
  for (const service of Object.keys(services)) {
    const item = body.services?.[service];
    if (!Number.isInteger(item?.price) || item.price < (body.enabled && service !== 'luzes' ? 1 : 0) || item.price > 999999 ||
        !Number.isInteger(item.duration) || item.duration < 15 || item.duration > 180 || item.duration % 15 ||
        (body.enabled && item.price > 0 && item.duration > minutes(body.close) - minutes(body.open))) return null;
    items[service] = { price: item.price, duration: item.duration };
  }
  return { enabled: body.enabled, days: [...new Set(body.days)], open: body.open, close: body.close, services: items };
}

async function listDates(bucket, from, to) {
  const dates = [];
  for (let day = from; day <= to; day = addDays(day, 1)) dates.push(day);
  const items = [];
  for (let offset = 0; offset < dates.length; offset += 5) {
    const batch = await Promise.all(dates.slice(offset, offset + 5).map((day) => read(bucket, dayKey(day), [])));
    items.push(...batch.flatMap(({ data }) => data));
  }
  return items.sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
}

async function api(request, env, url, admin) {
  const path = url.pathname;
  const method = request.method;
  const bucket = env.BUCKET;
  if (path.startsWith('/api/admin/') && !admin) return missing(403, 'Acesso reservado à administração.');
  if (!bucket) return missing(503, 'Agenda temporariamente indisponível.');
  const today = clock().slice(0, 10);
  if (path === '/api/config' && method === 'GET') {
    const data = await readConfig(bucket);
    return okay({ ...data, today, lastDay: addDays(today, 45) });
  }
  if (path === '/api/slots' && method === 'GET') {
    const date = url.searchParams.get('date');
    const service = url.searchParams.get('service');
    if (!validDay(date) || !hasService(service)) return missing(400, 'Escolha uma data e um serviço.');
    if (date < today || date > addDays(today, 45)) return okay({ times: [] });
    const [config, { data: entries }] = await Promise.all([readConfig(bucket), read(bucket, dayKey(date), [])]);
    return okay({ times: slots(config, date, service, entries, clock()) });
  }
  if (path === '/api/admin/settings' && method === 'GET') {
    return okay(await readConfig(bucket));
  }
  if (path === '/api/gallery' && method === 'GET') return okay(await gallery(bucket, 24));
  if (path === '/api/admin/gallery' && method === 'GET') return okay(await gallery(bucket, 96));
  if (path === '/api/admin/notifications' && method === 'GET') return okay({ configured: mailReady(env) });
  if (path === '/api/admin/gallery' && method === 'POST') {
    if (request.headers.get('Origin') !== url.origin) return missing(403, 'Origem da solicitação inválida.');
    return uploadPhoto(request, bucket);
  }
  if (path === '/api/admin/report' && method === 'GET') {
    const from = url.searchParams.get('from');
    const to = url.searchParams.get('to');
    if (!validDay(from) || !validDay(to) || from > to || to > addDays(from, 31))
      return missing(400, 'Escolha um período de até 32 dias.');
    const entries = await listDates(bucket, from, to);
    const completed = entries.filter((item) => item.status === 'concluido');
    const booked = entries.filter((item) => item.status === 'reservado');
    const upcoming = booked.filter((item) => item.date + ' ' + item.time >= clock());
    return okay({
      entries, completed: completed.length, upcoming: upcoming.length,
      clients: new Set([...booked, ...completed].map((item) => item.phone)).size,
      revenue: completed.reduce((sum, item) => sum + item.price, 0),
      projected: upcoming.reduce((sum, item) => sum + item.price, 0),
    });
  }
  if (method !== 'POST') return missing(404, 'Recurso indisponível.');
  if (request.headers.get('Origin') !== url.origin ||
      !/^application\/json(?:;|$)/i.test(request.headers.get('Content-Type') || ''))
    return missing(403, 'Origem da solicitação inválida.');
  const raw = await request.text();
  if (raw.length > 8000) return missing(413, 'Dados acima do limite.');
  let body;
  try { body = JSON.parse(raw); } catch { return missing(400, 'Dados inválidos.'); }
  if (!body || typeof body !== 'object') return missing(400, 'Dados inválidos.');
  if (path === '/api/admin/settings') {
    const config = validatedSettings(body);
    if (!config) return missing(400, 'Confira dias, horários (a cada 15 minutos), duração e preços.');
    return revise(bucket, 'config', pendingConfig, () => ({ data: config, result: config }));
  }
  if (path === '/api/admin/gallery/remove') {
    const key = typeof body.url === 'string' && body.url.startsWith('/media/') ? 'galeria/' + body.url.slice(7) : '';
    if (!photoName.test(key)) return missing(400, 'Foto inválida.');
    await bucket.delete(key);
    return okay({ removed: true });
  }
  if (path === '/api/admin/notifications') {
    const { date, id } = body;
    if (typeof id !== 'string' || !uuid.test(id) || !validDay(date)) return missing(400, 'Reserva inválida.');
    if (!mailReady(env)) return missing(503, 'O envio de e-mails ainda precisa ser configurado.');
    const { data } = await read(bucket, dayKey(date), []);
    const booking = data.find((item) => item.id === id && item.status === 'reservado' && item.email);
    if (!booking) return missing(404, 'Reserva com e-mail não encontrada.');
    return okay(await notify(env, booking));
  }
  if (path === '/api/book') {
    const { date, time, service } = body;
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
    const phone = typeof body.phone === 'string' ? body.phone.replace(/\D/g, '').replace(/^55(?=\d{10,11}$)/, '') : '';
    if (!validDay(date) || date < today || date > addDays(today, 45) || !hasService(service) ||
        typeof time !== 'string' || !timePattern.test(time) || name.length < 2 || name.length > 80 || !/^\d{10,11}$/.test(phone) || email.length > 254 || !emailPattern.test(email))
      return missing(400, 'Confira o nome, celular com DDD, e-mail, serviço, data e horário.');
    const config = await readConfig(bucket);
    const booking = { id: crypto.randomUUID(), date, time, service, name, phone, email, ...config.services[service], status: 'reservado',
      delivery: { client: 'pendente', barber: 'pendente' } };
    const saved = await revise(bucket, dayKey(date), [], (entries) => {
      if (!slots(config, date, service, entries, clock()).includes(time)) return missing(409, 'Esse horário já passou ou foi ocupado.');
      return { data: [...entries, booking], result: { id: booking.id, date, time, service } };
    });
    if (!saved.ok) return saved;
    let delivery = booking.delivery;
    try { delivery = await notify(env, booking); }
    catch (error) { console.error('Notificação de reserva:', error?.name); }
    return okay({ id: booking.id, date, time, service, emailStatus: delivery.client });
  }
  if (path === '/api/cancel' || path === '/api/admin/status') {
    const { id, date } = body;
    const selfCancel = path === '/api/cancel';
    const status = selfCancel ? 'cancelado' : body.status;
    if (typeof id !== 'string' || !uuid.test(id) || !validDay(date) || !['cancelado', 'concluido', 'faltou'].includes(status))
      return missing(400, 'Confira os dados da reserva.');
    return revise(bucket, dayKey(date), [], (entries) => {
      const entry = entries.find((item) => item.id === id && item.status === 'reservado');
      if (!entry || (selfCancel && date + ' ' + entry.time <= clock()))
        return missing(404, 'Reserva indisponível para alteração.');
      if (status !== 'cancelado' && date + ' ' + entry.time > clock())
        return missing(400, 'Registre o resultado a partir do horário marcado.');
      return { data: entries.map((item) => item === entry ? { ...item, status } : item), result: { status } };
    });
  }
  return missing(404, 'Recurso indisponível.');
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const email = request.headers.get('oai-authenticated-user-email');
    const admin = Boolean(email && env.ADMIN_EMAIL && email.toLowerCase() === env.ADMIN_EMAIL.toLowerCase() &&
      request.headers.get('oai-authenticated-user-id'));
    if (url.pathname.startsWith('/api/')) {
      try { return await api(request, env, url, admin); }
      catch (error) {
        console.error('Agenda:', error?.name);
        return missing(503, 'Agenda temporariamente indisponível. Tente novamente.');
      }
    }
    if (url.pathname.startsWith('/media/')) {
      const key = 'galeria/' + url.pathname.slice(7);
      if (!photoName.test(key) || !env.BUCKET) return new Response('Foto indisponível.', { status: 404 });
      const image = await env.BUCKET.get(key);
      if (!image) return new Response('Foto indisponível.', { status: 404 });
      return new Response(image.body, { headers: {
        'Content-Type': image.httpMetadata.contentType,
        'X-Content-Type-Options': 'nosniff',
        'Cache-Control': 'private, max-age=120',
      } });
    }
    if (url.pathname === '/admin' && !admin) {
      return new Response('Acesso reservado à administração.', { status: 403, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' } });
    }
    const asset = assets[url.pathname === '/admin' ? '/admin.html' : url.pathname];
    if (!asset || url.pathname === '/admin.html') return new Response('Página indisponível.', { status: 404 });
    const [type, value, binary] = asset;
    return new Response(binary ? Uint8Array.from(atob(value), (char) => char.charCodeAt(0)) : value, {
      headers: {
        'Content-Type': type,
        'Cache-Control': binary ? 'public, max-age=300' : 'no-cache',
        'X-Content-Type-Options': 'nosniff',
        'Referrer-Policy': 'strict-origin-when-cross-origin',
        'Content-Security-Policy': "default-src 'self'; base-uri 'none'; frame-ancestors 'self'; form-action 'self'; style-src 'self' https://fonts.googleapis.com; font-src https://fonts.gstatic.com",
      },
    });
  },
};
