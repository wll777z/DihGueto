export const names = { corte: 'Corte', barba: 'Barba', combo: 'Corte + barba', luzes: 'Luzes' };
const currency = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
export const money = (cents) => currency.format(cents / 100);
export const dateLabel = (date) => date.split('-').reverse().join('/');
export async function request(path, data) {
  const response = await fetch(path, data === undefined ? {} : {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'Não foi possível completar a solicitação.');
  return result;
}
export async function submit(form, status, work) {
  const button = form.querySelector('[type="submit"]');
  button.disabled = true;
  status.textContent = 'Processando…';
  try { await work(Object.fromEntries(new FormData(form))); }
  catch (error) { status.textContent = error.message; }
  finally { button.disabled = false; }
}
