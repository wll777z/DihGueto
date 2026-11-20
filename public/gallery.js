import { request } from './shared.js';

const categories = { cortes: 'Cortes', luzes: 'Luzes' };
const form = document.querySelector('#gallery-upload');
const names = Object.keys(categories);
const dialog = document.querySelector('#photo-dialog');
const dialogImage = document.querySelector('#photo-dialog-image');
const dialogTitle = document.querySelector('#photo-dialog-title');

function photo(item, category) {
  const figure = document.createElement('figure');
  const link = document.createElement('a');
  link.href = item.url;
  link.target = '_blank';
  link.rel = 'noopener';
  link.setAttribute('aria-label', 'Abrir foto: ' + (item.caption || categories[category]));
  const image = document.createElement('img');
  image.src = item.url;
  image.alt = item.caption || 'Foto da categoria ' + categories[category];
  image.loading = 'lazy';
  image.width = 260;
  image.height = 300;
  if (dialog && typeof dialog.showModal === 'function') {
    link.addEventListener('click', (event) => {
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      event.preventDefault();
      dialogTitle.textContent = item.caption || categories[category];
      dialogImage.src = item.url;
      dialogImage.alt = image.alt;
      dialog.showModal();
    });
  }
  link.append(image);
  figure.append(link);
  if (item.caption) {
    const caption = document.createElement('figcaption');
    caption.textContent = item.caption;
    figure.append(caption);
  }
  return figure;
}

if (form) {
  const status = document.querySelector('#gallery-admin-status');
  const root = document.querySelector('#gallery-admin');

  async function render() {
    const groups = await request('/api/admin/gallery');
    root.replaceChildren();
    for (const category of names) {
      const title = document.createElement('h3');
      title.textContent = categories[category];
      const items = document.createElement('div');
      items.className = 'photo-grid';
      for (const item of groups[category]) {
        const figure = photo(item, category);
        const remove = document.createElement('button');
        remove.className = 'button secondary';
        remove.type = 'button';
        remove.textContent = 'Remover foto';
        remove.addEventListener('click', async () => {
          if (!window.confirm('Remover esta foto da galeria?')) return;
          remove.disabled = true;
          try {
            await request('/api/admin/gallery/remove', { url: item.url });
            figure.remove();
            status.textContent = 'Foto removida.';
          } catch (error) { status.textContent = error.message; }
          finally { remove.disabled = false; }
        });
        figure.append(remove);
        items.append(figure);
      }
      if (!items.childElementCount) items.textContent = 'Nenhuma foto publicada.';
      root.append(title, items);
    }
  }
  render().catch((error) => { status.textContent = error.message; });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const button = form.querySelector('button');
    button.disabled = true;
    status.textContent = 'Enviando foto…';
    try {
      const response = await fetch('/api/admin/gallery', { method: 'POST', body: new FormData(form) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error);
      form.reset();
      status.textContent = 'Foto publicada.';
      await render();
    } catch (error) { status.textContent = error.message; }
    finally { button.disabled = false; }
  });
} else {
  const galleries = names.map((category) => ({
    category,
    root: document.querySelector('#photos-' + category),
    status: document.querySelector('#gallery-' + category + '-status'),
  }));
  try {
    const groups = await request('/api/gallery');
    for (const { category, root, status } of galleries) {
      root.append(...groups[category].map((item) => photo(item, category)));
      if (!root.childElementCount) status.textContent = 'As fotos desta categoria serão adicionadas em breve.';
    }
  } catch {
    for (const { root, status } of galleries) {
      if (!root.childElementCount) status.textContent = 'A galeria está temporariamente indisponível.';
    }
  }
}
