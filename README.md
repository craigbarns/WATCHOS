# Heure et Passion — Caisse & SAV

Logiciel de caisse pour horlogerie (montres suivies au numéro de série, accessoires, SAV),
conçu pour les exigences anti-fraude TVA : inaltérabilité, sécurisation, conservation, archivage.

Stack : Next.js 16 (App Router) · React 19 · Supabase (Postgres, Auth, RLS) · Tailwind 4 · shadcn/base-ui.

## Démarrage

1. Variables dans `.env.local` : `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`.
2. Appliquer **dans l'ordre** les fichiers de `supabase/migrations/` (Supabase CLI `supabase db push`, ou SQL Editor).
3. Le stock et les clients démarrent vides. `supabase/seed.sql` ne crée aucune donnée fictive.
4. `npm install && npm run dev`, puis se connecter sur `/login` avec un compte provisionné dans Supabase Auth.
   Le **premier compte** devient administrateur ; les suivants doivent être activés dans Paramètres → Équipe.

## Architecture fiscale

- Une vente est créée uniquement par la fonction SQL `finalize_sale` (transaction unique) :
  prix et TVA relus en base, contrôle stock / numéro de série, paiements = total, idempotence.
- Chaque vente produit un `fiscal_events` chaîné en SHA-256 (hash précédent + format canonique).
- Numérotation continue (tickets, événements, clôtures) via `fiscal_counters` verrouillé.
- `close_day` génère la clôture journalière (Z) chaînée avec grand total perpétuel.
- Tables fiscales en ajout seul (triggers) ; aucune écriture directe possible (RLS).
- Le format canonique est dupliqué dans `src/lib/fiscal/core.ts` : **toute modification doit être faite des deux côtés**.
  La page Rapports recalcule l'intégralité des deux chaînes et l'archive JSON est exportable.

## Rôles

| Rôle | Accès |
| --- | --- |
| Administrateur | Tout, dont paramètres boutique et gestion de l'équipe |
| Vendeur | Caisse, stock, clients, SAV, rapports et clôtures |
| Technicien | Tableau de bord, stock, clients, SAV (lecture/écriture SAV) |

## Raccourcis caisse

`F2` ou `/` : recherche / scan · `Entrée` : ajout direct sur correspondance exacte (douchette) · `F9` : encaisser

## Vérification

- `npm run lint` et `npm run build` : contrôles statiques et compilation de production.
- `npm test` : PostgreSQL isolé (PGlite), ventes et paiements, stock, permissions, journal fiscal et changements d’heure de Paris. Aucun accès à la base distante.
- `npm run test:browser` : parcours de lecture sur ordinateur/mobile, avec le serveur de production sur `http://127.0.0.1:3100`. Charge `.env.local`, ouvre une session administrateur temporaire sans email et la ferme après les tests. Ne crée ni client ni vente. `MAINTENANCE_OPERATOR_ID` est nécessaire si plusieurs administrateurs existent. `TEST_CHROME_PATH` permet de choisir l’exécutable Chromium. Les sauvegardes et sessions sont exclues de Git.

## Retrait des données de démonstration

`npm run demo:check` affiche un aperçu sans modification. Le script `scripts/maintenance/archive-demo.mjs --apply`, lancé avec `.env.local`, sauvegarde les données puis retire uniquement les produits portant les deux marqueurs `DEMO-Wxx`/`DEMO-Axx` et « Article de démonstration ». Chaque retrait passe par les fonctions de stock tracées ; les ventes restent intactes.

La remise à zéro demandée pour l’unique ticket d’essai `T2026-000001` est préparée séparément dans `scripts/maintenance/reset-test-shop.sql`. Elle nécessite une sauvegarde et un accès d’administration SQL. Ce fichier n’est jamais exécuté par l’application ou par les migrations : il refuse une vente différente, rétablit les protections dans la même transaction et préserve les paramètres et comptes utilisateurs.
