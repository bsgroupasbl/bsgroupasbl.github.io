import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const projectUrl = Deno.env.get('SUPABASE_URL')!;
const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const allowedOrigins = new Set([
  'https://bsgroupasbl.github.io',
  'http://localhost:5500',
  'http://127.0.0.1:5500',
  'http://localhost:5501',
  'http://127.0.0.1:5501'
]);

function getCorsHeaders(origin: string | null) {
  const allowedOrigin = origin && allowedOrigins.has(origin) ? origin : 'https://bsgroupasbl.github.io';
  return {
    'Access-Control-Allow-Origin': allowedOrigin,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Vary': 'Origin'
  };
}

function normalizeRole(value: string) {
  const normalized = value.trim().toLowerCase();
  if (normalized === 'administrateur gestionnaire' || normalized === 'responsable' || normalized === 'manager') return 'manager';
  if (normalized === 'consultant' || normalized === 'consultation' || normalized === 'viewer') return 'viewer';
  return normalized;
}

function normalizeCompany(value: string) {
  const normalized = value.trim().toLowerCase();
  const aliases: Record<string, string> = {
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

function normalizeName(value: string) {
  return value.replace(/\s+/g, ' ').trim();
}

function jsonResponse(request: Request, body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...getCorsHeaders(request.headers.get('Origin')), 'Content-Type': 'application/json' }
  });
}

Deno.serve(async (request: Request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: getCorsHeaders(request.headers.get('Origin')) });
  if (request.method !== 'POST') return jsonResponse(request, { error: 'Méthode non autorisée.' }, 405);

  const authorization = request.headers.get('Authorization');
  if (!authorization) return jsonResponse(request, { error: 'Connexion requise.' }, 401);

  const userClient = createClient(projectUrl, anonKey, {
    global: { headers: { Authorization: authorization } },
    auth: { autoRefreshToken: false, persistSession: false }
  });
  const adminClient = createClient(projectUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false }
  });

  const { data: userData, error: userError } = await userClient.auth.getUser();
  if (userError || !userData.user) return jsonResponse(request, { error: 'Session invalide. Reconnectez-vous.' }, 401);

  const { data: callerProfile, error: profileError } = await adminClient
    .from('profiles')
    .select('role')
    .eq('user_id', userData.user.id)
    .maybeSingle();
  if (profileError) return jsonResponse(request, { error: 'Vérification du rôle impossible.' }, 500);
  if (callerProfile?.role !== 'admin') return jsonResponse(request, { error: 'Réservé à l’administrateur.' }, 403);

  let payload: { email?: unknown; first_name?: unknown; last_name?: unknown; company?: unknown; role?: unknown };
  try {
    payload = await request.json();
  } catch {
    return jsonResponse(request, { error: 'Requête invalide.' }, 400);
  }

  const email = typeof payload.email === 'string' ? payload.email.trim().toLowerCase() : '';
  const firstName = typeof payload.first_name === 'string' ? normalizeName(payload.first_name) : '';
  const lastName = typeof payload.last_name === 'string' ? normalizeName(payload.last_name) : '';
  const company = typeof payload.company === 'string' ? normalizeCompany(payload.company) : '';
  const role = typeof payload.role === 'string' ? normalizeRole(payload.role) : '';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return jsonResponse(request, { error: 'Adresse e-mail invalide.' }, 400);
  }
  const validName = /^[\p{L}][\p{L} '-]{0,59}$/u;
  if (!validName.test(firstName) || !validName.test(lastName)) {
    return jsonResponse(request, { error: 'Le nom et le postnom doivent contenir entre 1 et 60 lettres.' }, 400);
  }
  if (!['print', 'cafe', 'pharma', 'tech'].includes(String(company))) {
    return jsonResponse(request, { error: 'Entreprise invalide.' }, 400);
  }
  if (role !== 'manager' && role !== 'viewer') {
    return jsonResponse(request, { error: 'Rôle invalide.' }, 400);
  }

  const { data: existingProfile, error: nameLookupError } = await adminClient
    .from('profiles')
    .select('user_id')
    .ilike('first_name', firstName)
    .ilike('last_name', lastName)
    .maybeSingle();
  if (nameLookupError) return jsonResponse(request, { error: 'Vérification du nom impossible.' }, 500);
  if (existingProfile) return jsonResponse(request, { error: 'Ce nom et ce postnom sont déjà attribués. Ajoutez un deuxième nom distinctif.' }, 409);

  const { data: inviteData, error: inviteError } = await adminClient.auth.admin.inviteUserByEmail(email);
  if (inviteError || !inviteData.user) {
    return jsonResponse(request, { error: inviteError?.message || 'Invitation impossible.' }, 400);
  }

  const { error: insertError } = await adminClient.from('profiles').insert({
    user_id: inviteData.user.id,
    first_name: firstName,
    last_name: lastName,
    company,
    role
  });
  if (insertError) {
    await adminClient.auth.admin.deleteUser(inviteData.user.id);
    return jsonResponse(request, { error: 'Le compte invité n’a pas pu recevoir son nom et son rôle.' }, 500);
  }

  return jsonResponse(request, { success: true });
});