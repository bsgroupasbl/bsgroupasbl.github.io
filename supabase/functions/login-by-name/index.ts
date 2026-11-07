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

function jsonResponse(request: Request, body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...getCorsHeaders(request.headers.get('Origin')), 'Content-Type': 'application/json' }
  });
}

Deno.serve(async (request: Request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: getCorsHeaders(request.headers.get('Origin')) });
  if (request.method !== 'POST') return jsonResponse(request, { error: 'Méthode non autorisée.' }, 405);

  let payload: { first_name?: unknown; last_name?: unknown; password?: unknown };
  try {
    payload = await request.json();
  } catch {
    return jsonResponse(request, { error: 'Prénom, nom ou mot de passe incorrect.' }, 401);
  }

  const firstName = typeof payload.first_name === 'string' ? payload.first_name.trim() : '';
  const lastName = typeof payload.last_name === 'string' ? payload.last_name.trim() : '';
  const password = typeof payload.password === 'string' ? payload.password : '';
  const validName = /^[\p{L}][\p{L} '-]{0,59}$/u;
  if (!validName.test(firstName) || !validName.test(lastName) || password.length < 1 || password.length > 256) {
    return jsonResponse(request, { error: 'Prénom, nom ou mot de passe incorrect.' }, 401);
  }

  const adminClient = createClient(projectUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false }
  });
  const loginClient = createClient(projectUrl, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false }
  });

  const { data: profile, error: profileError } = await adminClient
    .from('profiles')
    .select('user_id')
    .ilike('first_name', firstName)
    .ilike('last_name', lastName)
    .maybeSingle();
  if (profileError || !profile) {
    return jsonResponse(request, { error: 'Prénom, nom ou mot de passe incorrect.' }, 401);
  }

  const { data: authUser, error: authUserError } = await adminClient.auth.admin.getUserById(profile.user_id);
  const email = authUser.user?.email;
  if (authUserError || !email) {
    return jsonResponse(request, { error: 'Prénom, nom ou mot de passe incorrect.' }, 401);
  }

  const { data: login, error: loginError } = await loginClient.auth.signInWithPassword({ email, password });
  if (loginError || !login.session) {
    return jsonResponse(request, { error: 'Prénom, nom ou mot de passe incorrect.' }, 401);
  }

  return jsonResponse(request, {
    session: {
      access_token: login.session.access_token,
      refresh_token: login.session.refresh_token
    }
  });
});