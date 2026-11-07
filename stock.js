import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
import { SUPABASE_ANON_KEY, SUPABASE_URL } from './supabase-config.js';

const companies = {
  print: { name: 'BS PRINT', pharma: false },
  pharma: { name: 'BS PHARMA', pharma: true }
};

const requestedCompany = new URLSearchParams(window.location.search).get('company');
const companyKey = companies[requestedCompany] ? requestedCompany : 'print';
const company = companies[companyKey];
const loginPanel = document.querySelector('#login-panel');
const inventoryPanel = document.querySelector('#inventory-panel');
const loginForm = document.querySelector('#login-form');
const productForm = document.querySelector('#product-form');
const stockRows = document.querySelector('#stock-rows');
const searchInput = document.querySelector('#search-input');
const emptyState = document.querySelector('#empty-state');
const noResults = document.querySelector('#no-results');
const loginMessage = document.querySelector('#login-message');
const inventoryMessage = document.querySelector('#inventory-message');
const setupMessage = document.querySelector('#setup-message');
const productFormTitle = document.querySelector('#product-form-title');
const productSubmitLabel = document.querySelector('#product-submit-label');
const productSubmitIcon = document.querySelector('#product-submit-icon');
const cancelEditButton = document.querySelector('#cancel-edit-button');
const roleLabels = { admin: 'Administrateur', manager: 'Responsable du stock', viewer: 'Consultation' };
let supabase;
let products = [];
let profile;
let editingProductId = null;

document.querySelector('#login-company').textContent = company.name;
document.querySelector('#inventory-company').textContent = company.name;
document.querySelector('#batch-field').hidden = !company.pharma;
document.querySelector('#expiry-field').hidden = !company.pharma;
productForm.hidden = true;

if (SUPABASE_URL.includes('YOUR_PROJECT_ID') || SUPABASE_ANON_KEY.includes('YOUR_SUPABASE_')) {
  setupMessage.hidden = false;
  setupMessage.textContent = 'Supabase n’est pas encore configuré. Ajoutez l’URL du projet et la clé publishable dans supabase-config.js.';
  loginForm.querySelector('button').disabled = true;
} else {
  supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  initialize();
}

loginForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  showMessage(loginMessage, 'Connexion en cours…');
  const formData = new FormData(loginForm);
  const { error } = await supabase.auth.signInWithPassword({
    email: String(formData.get('email')).trim(),
    password: String(formData.get('password'))
  });
  if (error) showMessage(loginMessage, friendlyError(error), true);
});

document.querySelector('#logout-button').addEventListener('click', async () => {
  const { error } = await supabase.auth.signOut();
  if (error) showMessage(inventoryMessage, friendlyError(error), true);
});

cancelEditButton.addEventListener('click', cancelEdit);

productForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const formData = new FormData(productForm);
  const productData = {
    name: String(formData.get('name')).trim(),
    sku: String(formData.get('sku')).trim(),
    quantity: Number(formData.get('quantity')),
    unit: String(formData.get('unit')).trim(),
    threshold: Number(formData.get('threshold')),
    batch: String(formData.get('batch')).trim(),
    expiry: String(formData.get('expiry')) || null
  };
  const { error } = editingProductId
    ? await supabase.from('inventory').update(productData).eq('id', editingProductId).eq('company', companyKey)
    : await supabase.from('inventory').insert({ ...productData, company: companyKey });
  if (error) {
    showMessage(inventoryMessage, friendlyError(error), true);
    return;
  }
  cancelEdit();
  await loadProducts();
});

searchInput.addEventListener('input', renderProducts);

stockRows.addEventListener('click', async (event) => {
  if (profile.role === 'viewer') return;
  const button = event.target.closest('button[data-action]');
  if (!button) return;
  const product = products.find((item) => item.id === button.dataset.id);
  if (!product) return;

  if (button.dataset.action === 'edit') {
    startEditing(product);
    return;
  }

  let request;
  if (button.dataset.action === 'remove') {
    request = supabase.from('inventory').delete().eq('id', product.id);
  } else {
    const change = button.dataset.action === 'increase' ? 1 : -1;
    request = supabase.from('inventory')
      .update({ quantity: Math.max(0, product.quantity + change) })
      .eq('id', product.id);
  }
  const { error } = await request;
  if (error) {
    showMessage(inventoryMessage, friendlyError(error), true);
    return;
  }
  await loadProducts();
});

async function initialize() {
  const { data: { session }, error } = await supabase.auth.getSession();
  if (error) showMessage(loginMessage, friendlyError(error), true);
  if (session) await showInventory(session.user.id);

  supabase.auth.onAuthStateChange((_event, sessionUpdate) => {
    if (sessionUpdate) {
      window.setTimeout(() => showInventory(sessionUpdate.user.id), 0);
    } else {
      showLogin();
    }
  });
}

async function showInventory(userId) {
  const { data, error } = await supabase
    .from('profiles')
    .select('company, role')
    .eq('user_id', userId)
    .maybeSingle();
  if (error || !data) {
    await supabase.auth.signOut();
    showMessage(loginMessage, error ? friendlyError(error) : 'Aucun rôle n’est attribué à ce compte.', true);
    return;
  }
  if (data.role !== 'admin' && data.company !== companyKey) {
    await supabase.auth.signOut();
    showMessage(loginMessage, 'Ce compte n’a pas accès à cet espace entreprise.', true);
    return;
  }

  profile = data;
  loginPanel.hidden = true;
  inventoryPanel.hidden = false;
  productForm.hidden = profile.role === 'viewer';
  document.querySelector('#user-role').textContent = roleLabels[profile.role] || '';
  showMessage(loginMessage, '');
  await loadProducts();
}

function showLogin() {
  cancelEdit();
  profile = undefined;
  inventoryPanel.hidden = true;
  loginPanel.hidden = false;
  loginForm.reset();
  products = [];
  stockRows.replaceChildren();
  showMessage(inventoryMessage, '');
}

async function loadProducts() {
  showMessage(inventoryMessage, 'Chargement du stock…');
  const { data, error } = await supabase
    .from('inventory')
    .select('id, name, sku, quantity, unit, threshold, batch, expiry')
    .eq('company', companyKey)
    .order('name');
  if (error) {
    showMessage(inventoryMessage, friendlyError(error), true);
    return;
  }
  products = data || [];
  showMessage(inventoryMessage, '');
  renderProducts();
}

function renderProducts() {
  const search = searchInput.value.trim().toLocaleLowerCase('fr');
  const filteredProducts = products.filter((product) =>
    `${product.name} ${product.sku} ${product.batch}`.toLocaleLowerCase('fr').includes(search)
  );

  stockRows.replaceChildren();
  emptyState.hidden = products.length > 0;
  noResults.hidden = products.length === 0 || filteredProducts.length > 0;

  for (const product of filteredProducts) {
    const row = document.createElement('tr');
    addCell(row, product.name);
    addCell(row, [product.sku, product.batch].filter(Boolean).join(' · ') || '—');
    addCell(row, product.expiry || '—');

    const quantityCell = document.createElement('td');
    if (profile.role === 'viewer') {
      quantityCell.textContent = `${product.quantity} ${product.unit}`;
    } else {
      const quantityControl = document.createElement('div');
      quantityControl.className = 'quantity-control';
      quantityControl.append(
        createActionButton('−', 'decrease', product.id, 'Retirer une unité'),
        Object.assign(document.createElement('span'), { textContent: `${product.quantity} ${product.unit}` }),
        createActionButton('+', 'increase', product.id, 'Ajouter une unité')
      );
      quantityCell.append(quantityControl);
    }
    row.append(quantityCell);

    const statusCell = document.createElement('td');
    const status = document.createElement('span');
    const isLow = product.quantity <= product.threshold;
    status.className = isLow ? 'stock-status low' : 'stock-status';
    status.textContent = isLow ? 'À réapprovisionner' : 'Disponible';
    statusCell.append(status);
    row.append(statusCell);

    const actionCell = document.createElement('td');
    if (profile.role !== 'viewer') {
      const actions = document.createElement('div');
      actions.className = 'row-actions';
      actions.append(
        createActionButton('Modifier', 'edit', product.id, `Modifier ${product.name}`),
        createActionButton('×', 'remove', product.id, `Supprimer ${product.name}`)
      );
      actionCell.append(actions);
    }
    row.append(actionCell);
    stockRows.append(row);
  }
}

function startEditing(product) {
  editingProductId = product.id;
  productForm.elements.name.value = product.name;
  productForm.elements.sku.value = product.sku || '';
  productForm.elements.quantity.value = product.quantity;
  productForm.elements.unit.value = product.unit;
  productForm.elements.threshold.value = product.threshold;
  productForm.elements.batch.value = product.batch || '';
  productForm.elements.expiry.value = product.expiry || '';
  productFormTitle.textContent = 'Modifier un article';
  productSubmitLabel.textContent = 'Enregistrer les modifications';
  productSubmitIcon.textContent = '✓';
  cancelEditButton.hidden = false;
  showMessage(inventoryMessage, `Modification de « ${product.name} ».`);
  productForm.scrollIntoView({ behavior: 'smooth', block: 'start' });
  productForm.elements.name.focus({ preventScroll: true });
}

function cancelEdit() {
  editingProductId = null;
  productForm.reset();
  productForm.elements.threshold.value = '5';
  productFormTitle.textContent = 'Ajouter un article';
  productSubmitLabel.textContent = 'Ajouter au stock';
  productSubmitIcon.textContent = '+';
  cancelEditButton.hidden = true;
}

function addCell(row, text) {
  const cell = document.createElement('td');
  cell.textContent = text;
  row.append(cell);
}

function createActionButton(label, action, id, accessibleName) {
  const button = document.createElement('button');
  button.type = 'button';
  button.dataset.action = action;
  button.dataset.id = id;
  button.setAttribute('aria-label', accessibleName);
  button.title = accessibleName;
  button.textContent = label;
  return button;
}

function showMessage(element, message, isError = false) {
  element.textContent = message;
  element.classList.toggle('is-error', isError);
}

function friendlyError(error) {
  if (error.code === '42501' || error.code === 'PGRST301') {
    return 'Accès refusé. Vérifiez le rôle du compte et les règles de sécurité Supabase.';
  }
  return error.message || 'Une erreur est survenue. Réessayez.';
}