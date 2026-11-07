# Supabase BS GROUP

## Migration du projet existant

Le projet actuel a deja execute `setup.sql` et possede des profils et articles. Dans Supabase **SQL Editor**, executer une seule fois `upgrade-companies-sales.sql`. Cette migration elargit les entreprises a `print`, `cafe`, `pharma` et `tech`, ajoute les noms et prix manquants, puis cree l'historique de vente et la fonction transactionnelle qui diminue le stock. Elle ne supprime pas les articles existants.

Apres la migration, attribuer le nom et le postnom au profil admin deja cree. Remplacer les exemples et l'UUID par les vraies valeurs dans le SQL Editor :

```sql
update public.profiles
set first_name = 'TON_PRENOM', last_name = 'TON_NOM'
where user_id = 'UUID_DE_TON_COMPTE_ADMIN';
```

Le couple prenom + nom doit etre unique. La connexion utilise prenom + nom + mot de passe; l'adresse e-mail reste utilisee pour recevoir l'invitation et recuperer le compte.

Pour autoriser les consultants a enregistrer des ventes sans leur donner le droit de modifier l'inventaire, executer `allow-consultant-sales.sql` une fois dans le SQL Editor. Les ventes diminuent le stock via `record_sale`; les politiques RLS d'ajout, de modification et de suppression restent reservees aux administrateurs et gestionnaires.

## Deploiement des fonctions

Dans le tableau de bord Supabase, **Edge Functions**, deployer les deux fonctions depuis leurs fichiers. Regler la validation JWT selon `config.toml` :

- `functions/login-by-name/index.ts`, nom `login-by-name`, avec **Verify JWT** desactive. La fonction est publique pour permettre la connexion avant authentification; elle retrouve l'e-mail cote serveur et verifie le mot de passe avec Supabase Auth.
- `functions/invite-user/index.ts`, nom `invite-user`, avec **Verify JWT** active. Elle verifie que l'appelant a le role `admin` avant d'inviter et d'attribuer un profil.

Les fonctions utilisent les secrets d'environnement Supabase `SUPABASE_URL`, `SUPABASE_ANON_KEY` et `SUPABASE_SERVICE_ROLE_KEY`. Ne jamais copier `SUPABASE_SERVICE_ROLE_KEY` dans les fichiers du site ou sur GitHub.

L'envoi d'invitations peut necessiter un service SMTP configure dans les parametres Auth. Supabase doit aussi autoriser `https://bsgroupasbl.github.io` dans les URL de redirection Auth.

## Mise en ligne du site

Publier sur la branche `main` les fichiers `index.html`, `stock.html`, `stock.js`, `stock.css` et `supabase-config.js`. Le lien unique **Espace entreprise** ouvre la connexion. L'administrateur peut choisir l'une des quatre entreprises; chaque autre compte reste limite a l'entreprise et au role attribues dans `profiles`.

Ajouter un article avec son prix de vente en CDF. Les ventes sont enregistrees par `record_sale`, qui verifie les droits et la quantite disponible, met a jour le stock et conserve l'historique dans une transaction.