import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
import { SUPABASE_ANON_KEY, SUPABASE_URL } from './supabase-config.js';

const companies = {
  print: { name: 'BS PRINT', pharma: false },
  cafe: { name: 'BS CAFÉ', pharma: false },
  pharma: { name: 'BS PHARMA', pharma: true },
  tech: { name: 'BS TECH', pharma: false }
};
const requestedCompany = new URLSearchParams(window.location.search).get('company');
let companyKey = companies[requestedCompany] ? requestedCompany : 'print';
let company = companies[companyKey];

const loginPanel = document.querySelector('#login-panel');
const inventoryPanel = document.querySelector('#inventory-panel');
const loginForm = document.querySelector('#login-form');
const loginSubmitButton = document.querySelector('#login-submit-button');
const productForm = document.querySelector('#product-form');
const saleForm = document.querySelector('#sale-form');
const salesPanel = document.querySelector('#sales-panel');
const salesRows = document.querySelector('#sales-rows');
const salesEmptyState = document.querySelector('#sales-empty-state');
const saleProductSelect = document.querySelector('#sale-product');
const saleQuantityInput = document.querySelector('#sale-quantity');
const saleUnitPrice = document.querySelector('#sale-unit-price');
const saleTotal = document.querySelector('#sale-total');
const saleMessage = document.querySelector('#sale-message');
const saleSubmitButton = document.querySelector('#sale-submit-button');
const inviteUserForm = document.querySelector('#invite-user-form');
const inviteUserPanel = document.querySelector('#user-admin-panel');
const inviteMessage = document.querySelector('#invite-message');
const inviteSubmitButton = document.querySelector('#invite-submit-button');
const companySelect = document.querySelector('#company-select');
const companySwitcher = document.querySelector('#company-switcher');
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
const roleLabels = { admin: 'Super administrateur', manager: 'Administrateur gestionnaire', viewer: 'Consultant' };
let supabase;
let products = [];
let profile;
let editingProductId = null;

companySelect.value = companyKey;
syncCompanyDisplay();
productForm.hidden = true;
saleForm.hidden = true;

if (SUPABASE_URL.includes('YOUR_PROJECT_ID') || SUPABASE_ANON_KEY.includes('YOUR_SUPABASE_')) {
  setupMessage.hidden = false;
  setupMessage.textContent = 'Supabase n’est pas encore configuré. Ajoutez l’URL du projet et la clé publishable dans supabase-config.js.';
  loginSubmitButton.disabled = true;
} else {
  supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  initialize();
}

loginForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  loginSubmitButton.disabled = true;
  showMessage(loginMessage, 'Connexion en cours…');
  const formData = new FormData(loginForm);
  const { data, error } = await supabase.functions.invoke('login-by-name', {
    body: {
      first_name: String(formData.get('first_name')).trim(),
      last_name: String(formData.get('last_name')).trim(),
      password: String(formData.get('password'))
    }
  });
  loginSubmitButton.disabled = false;
  if (error || !data?.session) {
    showMessage(loginMessage, data?.error || await loginFunctionErrorMessage(error), true);
    return;
  }

  const { error: sessionError } = await supabase.auth.setSession(data.session);
  if (sessionError) showMessage(loginMessage, friendlyError(sessionError), true);
});

document.querySelector('#logout-button').addEventListener('click', async () => {
  const { error } = await supabase.auth.signOut();
  if (error) showMessage(inventoryMessage, friendlyError(error), true);
});

companySelect.addEventListener('change', async () => {
  if (profile?.role !== 'admin' || !companies[companySelect.value]) return;
  companyKey = companySelect.value;
  syncCompanyDisplay();
  cancelEdit();
  await Promise.all([loadProducts(), loadSales()]);
});

inviteUserForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const formData = new FormData(inviteUserForm);
  const email = String(formData.get('email')).trim();
  const company = normalizeCompany(String(formData.get('company')));
  const role = normalizeRole(String(formData.get('role')));
  inviteSubmitButton.disabled = true;
  showMessage(inviteMessage, 'Envoi de l’invitation…');

  const { data, error } = await supabase.functions.invoke('invite-user', {
    body: {
      email,
      first_name: String(formData.get('first_name')).trim(),
      last_name: String(formData.get('last_name')).trim(),
      company,
      role
    }
  });

  inviteSubmitButton.disabled = false;
  if (error) {
    showMessage(inviteMessage, inviteUserErrorMessage(data, error), true);
    return;
  }

  inviteUserForm.reset();
  showMessage(inviteMessage, `Invitation envoyée à ${email}.`);
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
    unit_price: Number(formData.get('unit_price')),
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

saleProductSelect.addEventListener('change', renderSaleEstimate);
saleQuantityInput.addEventListener('input', renderSaleEstimate);
saleForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const inventoryId = saleProductSelect.value;
  const quantity = Number(saleQuantityInput.value);
  if (!inventoryId || !Number.isInteger(quantity) || quantity <= 0) {
    showMessage(saleMessage, 'Choisissez un article et une quantité valide.', true);
    return;
  }

  saleSubmitButton.disabled = true;
  showMessage(saleMessage, 'Enregistrement de la vente…');
  const { error } = await supabase.rpc('record_sale', {
    p_inventory_id: inventoryId,
    p_quantity: quantity
  });
  saleSubmitButton.disabled = false;
  if (error) {
    showMessage(saleMessage, friendlySaleError(error), true);
    return;
  }

  saleForm.reset();
  saleQuantityInput.value = '1';
  showMessage(saleMessage, 'Vente enregistrée et stock mis à jour.');
  await Promise.all([loadProducts(), loadSales()]);
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
    .select('company, role, first_name, last_name')
    .eq('user_id', userId)
    .maybeSingle();
  if (error || !data) {
    await supabase.auth.signOut();
    showMessage(loginMessage, error ? friendlyError(error) : 'Aucun rôle n’est attribué à ce compte.', true);
    return;
  }

  profile = data;
  if (profile.role !== 'admin') companyKey = profile.company;
  companySelect.value = companyKey;
  syncCompanyDisplay();
  loginPanel.hidden = true;
  inventoryPanel.hidden = false;
  companySwitcher.hidden = profile.role !== 'admin';
  inviteUserPanel.hidden = profile.role !== 'admin';
  productForm.hidden = profile.role === 'viewer';
  salesPanel.hidden = profile.role === 'viewer';
  document.querySelector('#user-role').textContent = roleLabels[profile.role] || '';
  showMessage(loginMessage, '');
  await Promise.all([loadProducts(), loadSales()]);
}

function showLogin() {
  cancelEdit();
  profile = undefined;
  companySwitcher.hidden = true;
  inviteUserPanel.hidden = true;
  salesPanel.hidden = true;
  inviteUserForm.reset();
  showMessage(inviteMessage, '');
  showMessage(saleMessage, '');
  inventoryPanel.hidden = true;
  loginPanel.hidden = false;
  loginForm.reset();
  products = [];
  stockRows.replaceChildren();
  salesRows.replaceChildren();
  showMessage(inventoryMessage, '');
}

function syncCompanyDisplay() {
  company = companies[companyKey] || companies.print;
  companyKey = companies[companyKey] ? companyKey : 'print';
  document.querySelector('#inventory-company').textContent = company.name;
  document.querySelector('#batch-field').hidden = !company.pharma;
  document.querySelector('#expiry-field').hidden = !company.pharma;
  if (companySelect.value !== companyKey) companySelect.value = companyKey;
}

async function loadProducts() {
  showMessage(inventoryMessage, 'Chargement du stock…');
  const { data, error } = await supabase
    .from('inventory')
    .select('id, name, sku, quantity, unit, unit_price, threshold, batch, expiry')
    .eq('company', companyKey)
    .order('name');
  if (error) {
    showMessage(inventoryMessage, friendlyError(error), true);
    return;
  }
  products = data || [];
  showMessage(inventoryMessage, '');
  populateSaleProducts();
  renderProducts();
}

async function loadSales() {
  const { data, error } = await supabase
    .from('sales')
    .select('id, item_name, quantity, unit_price, total_amount, sold_at')
    .eq('company', companyKey)
    .order('sold_at', { ascending: false })
    .limit(50);
  if (error) {
    showMessage(saleMessage, friendlyError(error), true);
    return;
  }

  salesRows.replaceChildren();
  const sales = data || [];
  salesEmptyState.hidden = sales.length > 0;
  for (const sale of sales) {
    const row = document.createElement('tr');
    addCell(row, new Date(sale.sold_at).toLocaleString('fr-CD'));
    addCell(row, sale.item_name);
    addCell(row, String(sale.quantity));
    addCell(row, formatCdf(sale.unit_price));
    addCell(row, formatCdf(sale.total_amount));
    salesRows.append(row);
  }
}

function populateSaleProducts() {
  const selectedId = saleProductSelect.value;
  saleProductSelect.replaceChildren();
  for (const product of products) {
    const option = document.createElement('option');
    option.value = product.id;
    option.textContent = `${product.name} · ${product.quantity} ${product.unit}`;
    saleProductSelect.append(option);
  }
  if (products.some((product) => product.id === selectedId)) saleProductSelect.value = selectedId;
  if (products.length === 0) {
    const option = document.createElement('option');
    option.value = '';
    option.textContent = 'Aucun article en stock';
    saleProductSelect.append(option);
  }
  renderSaleEstimate();
}

function renderSaleEstimate() {
  const product = products.find((item) => item.id === saleProductSelect.value);
  const unitPrice = Number(product?.unit_price || 0);
  const quantity = Math.max(0, Number(saleQuantityInput.value) || 0);
  saleUnitPrice.textContent = formatCdf(unitPrice);
  saleTotal.textContent = formatCdf(unitPrice * quantity);
  saleSubmitButton.disabled = !product || !profile || profile.role === 'viewer';
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
    addCell(row, formatCdf(product.unit_price));

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
  productForm.elements.unit_price.value = product.unit_price || 0;
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
  productForm.elements.unit_price.value = '0';
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

function formatCdf(value) {
  return `${Number(value || 0).toLocaleString('fr-CD', { maximumFractionDigits: 2 })} CDF`;
}

async function loginFunctionErrorMessage(error) {
  const response = error?.context;
  if (response instanceof Response) {
    if (response.status === 404) return 'La fonction login-by-name est introuvable. Vérifiez son nom et son déploiement.';
    if (response.status === 401) return 'Nom, postnom ou mot de passe incorrect, ou compte non confirmé dans Supabase Auth.';
    try {
      const body = await response.clone().json();
      if (body?.error) return body.error;
    } catch {
      return `Erreur de connexion Supabase (${response.status}). Consultez les logs de login-by-name.`;
    }
    return `Erreur de connexion Supabase (${response.status}). Consultez les logs de login-by-name.`;
  }
  return error?.message || 'Impossible de joindre login-by-name. Vérifiez le réseau, le CORS et le port local.';
}

function friendlySaleError(error) {
  if (error.code === '22003') return 'La quantité demandée dépasse le stock disponible.';
  if (error.code === '42501') return 'Ce compte n’a pas le droit d’enregistrer une vente.';
  if (error.code === 'PGRST202' || error.code === '42883') return 'La fonction de vente Supabase n’est pas encore installée.';
  return friendlyError(error);
}

function showMessage(element, message, isError = false) {
  element.textContent = message;
  element.classList.toggle('is-error', isError);
}

function normalizeRole(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'administrateur gestionnaire' || normalized === 'responsable' || normalized === 'manager') return 'manager';
  if (normalized === 'consultant' || normalized === 'consultation' || normalized === 'viewer') return 'viewer';
  return normalized;
}

function normalizeCompany(value) {
  const normalized = String(value || '').trim().toLowerCase();
  const aliases = {
    'bs print': 'print',
    'bs café': 'cafe',
    'bs cafe': 'cafe',
    'bs pharma': 'pharma',
    'bs tech': 'tech',
    print: 'print',
    cafe: 'cafe',
    pharma: 'pharma',
    tech: 'tech'
  };
  return aliases[normalized] || normalized;
}

function inviteUserErrorMessage(data, error) {
  if (data?.error) return data.error;
  if (error?.context instanceof Response) {
    const response = error.context;
    if (response.status === 404) return 'La fonction invite-user est introuvable. Vérifiez son nom et son déploiement.';
    if (response.status === 401) return 'Session invalide. Connectez-vous en tant qu’administrateur.';
    if (response.status === 403) return 'Accès refusé. Seul l’administrateur peut inviter un utilisateur.';
    return `Erreur Supabase (${response.status}). Vérifiez le déploiement et les logs de la fonction.`;
  }
  return error?.message || 'Impossible d’envoyer l’invitation. Vérifiez le déploiement de la fonction Supabase.';
}

function friendlyError(error) {
  if (error.code === '42501' || error.code === 'PGRST301') {
    return 'Accès refusé. Vérifiez le rôle du compte et les règles de sécurité Supabase.';
  }
  return error.message || 'Une erreur est survenue. Réessayez.';
}