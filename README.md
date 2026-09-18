# Heures et Passion — Caisse & SAV

Logiciel de caisse pour les prestations d’un atelier d’horlogerie, avec suivi SAV et contact WhatsApp,
conçu pour les exigences anti-fraude TVA : inaltérabilité, sécurisation, conservation, archivage.

Stack : Next.js 16 (App Router) · React 19 · Supabase (Postgres, Auth, RLS) · Tailwind 4 · shadcn/base-ui.

## Démarrage

1. Variables dans `.env.local` : `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`.
2. Appliquer **dans l'ordre** les fichiers de `supabase/migrations/` (Supabase CLI `supabase db push`, ou SQL Editor).
3. La migration `20260920000000_service_checkout.sql` installe les 11 postes de prestation et les statistiques, sans créer de vente ni de client fictif. Elle préserve les ventes historiques.
4. La migration `20260921000000_sav_payment_and_store_name.sql` corrige le nom commercial en « Heures et Passion » et ajoute le suivi du règlement SAV.
5. `npm install && npm run dev`, puis se connecter sur `/login` avec un compte provisionné dans Supabase Auth.
   Le **premier compte** devient administrateur ; les suivants doivent être activés dans Paramètres → Équipe.

## Architecture fiscale

- Une vente est créée uniquement par la fonction SQL `finalize_sale` (transaction unique) :
  poste et TVA relus en base, montant TTC saisi par le vendeur et validé en base, paiements = total, idempotence.
  Les anciennes ventes de produits et leur contrôle de stock restent compatibles.
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
| Vendeur | Caisse, statistiques, clients, SAV, rapports et clôtures |
| Technicien | Tableau de bord, clients, SAV (lecture/écriture SAV) |

## Raccourcis caisse

`F2` ou `/` : rechercher une prestation · `Entrée` : choisir le seul poste trouvé / valider son montant · `F9` : encaisser

## Prestations et statistiques

La caisse propose : Pile, Bracelet, Pile plus contrôle étanchéité, Changement de verre, Polissage,
Bracelets sur mesure, Échange standard de mouvement quartz, Révision montre quartz,
Révision montre automatique, Aiguillage, Intervention partielle.

Chaque ajout demande un montant unitaire TTC (virgule ou point, deux décimales maximum).
Un même poste peut apparaître plusieurs fois avec des montants différents. Quantités, modification du montant,
remises, paiements multiples et tickets restent disponibles. Aucune prestation ne décrémente de stock.
Les postes sont dans `service_categories`, avec une TVA initiale de 20 %, identique au taux habituel de la configuration existante ; ajuster ce taux en base si la boutique utilise un autre taux.

`/statistiques` regroupe les quantités, tickets distincts, CA HT/TTC après remises et part du CA par poste.
La période inclut les deux dates, en heure de Paris (changements d’heure compris). L’agrégation se fait en SQL,
sans plafond de 1 000 lignes. Les ventes historiques de produits restent dans les rapports fiscaux.

## Règlement des SAV

Chaque fiche SAV propose un montant TTC saisi manuellement et une case **Payé**. Une case décochée
signifie **Non payé**. Le montant peut rester vide tant qu’il n’est pas connu ; zéro indique une intervention gratuite.
Cliquer sur **Enregistrer le règlement** conserve le montant et le statut, et inscrit la modification dans
l’historique du dossier avec son auteur. Ces informations figurent aussi sur le bon de dépôt imprimé.
Ce suivi manuel ne crée pas de vente : les encaissements se font dans la caisse.

## WhatsApp pour les SAV prêts

Au statut **Prêt**, la fiche propose **Envoyer par WhatsApp** avec le prénom du client, la montre,
le numéro de dossier et les coordonnées de la boutique. Les numéros français et internationaux sont normalisés.
Un numéro absent ou incorrect peut être corrigé directement sur la fiche SAV et enregistré sur le client.

Le [lien officiel WhatsApp](https://faq.whatsapp.com/5913398998672934) ouvre une conversation avec un texte prérempli.
L’opérateur clique sur **Envoyer dans WhatsApp**, revient sur le SAV puis clique **J’ai envoyé le message**.
Seule cette confirmation passe le dossier à **Client prévenu** et écrit un événement horodaté attribué à l’opérateur.
Ouvrir le lien ne change aucun statut ; aucune preuve de livraison n’est déduite de cette ouverture.
La confirmation est atomique et un double clic ne crée pas deux événements. Aucun compte API SMS/WhatsApp n’est nécessaire.

## Vérification

- `npm run lint` et `npm run build` : contrôles statiques et compilation de production.
- `npm test` : PostgreSQL isolé (PGlite), ventes et paiements, règlements SAV et historique, prestations à prix libre, statistiques, confirmation WhatsApp, stock historique, permissions, journal fiscal et changements d’heure de Paris. Aucun accès à la base distante.
- `npm run test:browser` : parcours de lecture sur ordinateur/mobile, avec le serveur de production sur `http://127.0.0.1:3100`. Charge `.env.local`, ouvre une session administrateur temporaire sans email et la ferme après les tests. Ne crée ni client ni vente. `MAINTENANCE_OPERATOR_ID` est nécessaire si plusieurs administrateurs existent. `TEST_CHROME_PATH` permet de choisir l’exécutable Chromium. Les sauvegardes et sessions sont exclues de Git.

## Retrait des données de démonstration

`npm run demo:check` affiche un aperçu sans modification. Le script `scripts/maintenance/archive-demo.mjs --apply`, lancé avec `.env.local`, sauvegarde les données puis retire uniquement les produits portant les deux marqueurs `DEMO-Wxx`/`DEMO-Axx` et « Article de démonstration ». Chaque retrait passe par les fonctions de stock tracées ; les ventes restent intactes.

La remise à zéro demandée pour l’unique ticket d’essai `T2026-000001` est préparée séparément dans `scripts/maintenance/reset-test-shop.sql`. Elle nécessite une sauvegarde et un accès d’administration SQL. Ce fichier n’est jamais exécuté par l’application ou par les migrations : il refuse une vente différente, rétablit les protections dans la même transaction et préserve les paramètres et comptes utilisateurs.
