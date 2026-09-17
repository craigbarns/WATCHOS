# Heure et Passion — Caisse & SAV

Logiciel de caisse pour horlogerie (montres suivies au numéro de série, accessoires, SAV),
conçu pour les exigences anti-fraude TVA : inaltérabilité, sécurisation, conservation, archivage.

Stack : Next.js 16 (App Router) · React 19 · Supabase (Postgres, Auth, RLS) · Tailwind 4 · shadcn/base-ui.

## Démarrage

1. Variables dans `.env.local` : `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`.
2. Appliquer **dans l'ordre** les fichiers de `supabase/migrations/` (Supabase CLI `supabase db push`, ou SQL Editor).
3. (Dev) Charger `supabase/seed.sql` pour des produits de démonstration.
4. `npm install && npm run dev`, puis créer un compte sur `/login`.
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
