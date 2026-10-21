# Mettre l'API en ligne avec Coolify

L'API lit des factures, bons de commande et relevés bancaires (PDF ou image) et renvoie les données en JSON.
Elle utilise Claude pour la lecture, et Stripe pour les abonnements.

## 1. Créer l'application dans Coolify

1. Ouvre Coolify (`http://IP-DU-VPS:8000`).
2. **Projects** → ton projet (ou **+ New**) → **+ New resource** → **Public Repository**.
3. URL du dépôt : `https://github.com/REB1236/Business-automate`
4. Branche : `claude/new-session-ap7s9g`
5. **Build Pack** : `Dockerfile`
6. **Base Directory** : `/docapi`
7. **Ports Exposes** : `3000`
8. Clique sur **Continue**.

## 2. Ajouter un stockage permanent (très important)

Sans ça, toutes les clés de tes clients sont effacées à chaque mise à jour.

**Persistent Storage** → **+ Add** → **Volume** :
- Name : `docapi-data`
- Destination Path : `/app/data`

## 3. Variables d'environnement

Onglet **Environment Variables**, ajoute :

| Nom | Valeur |
|---|---|
| `ANTHROPIC_API_KEY` | ta clé Claude `sk-ant-...` (coche **Is Secret** si l'option existe) |
| `BASE_URL` | l'adresse publique de l'API, par exemple `https://api.ton-domaine.com` |

Optionnel :

| Nom | Par défaut | Rôle |
|---|---|---|
| `BRAND_NAME` | `DocExtract` | Le nom affiché sur la page d'accueil |
| `MODEL` | `claude-opus-5-5` | Le modèle Claude utilisé |
| `EFFORT` | `medium` | `low` coûte moins cher, `high` est plus précis |
| `LIMIT_FREE` / `LIMIT_STARTER` / `LIMIT_PRO` | `20` / `300` / `1000` | Documents par mois et par forfait |

## 4. Nom de domaine

- **Pour tester tout de suite** : laisse le domaine automatique que Coolify propose (il finit par `sslip.io`).
- **Pour de vrais clients** : achète un domaine, puis chez ton registrar crée un enregistrement **A**
  `api` → **IP du VPS**. Dans Coolify, onglet **General** → **Domains**, mets `https://api.ton-domaine.com`.
  Coolify crée le certificat HTTPS tout seul.

Mets la même adresse dans `BASE_URL`.

## 5. Déployer et tester

Clique sur **Deploy**. Quand c'est vert, ouvre l'adresse : la page d'accueil avec les tarifs doit s'afficher.

Crée une clé gratuite depuis la page, puis teste avec une vraie facture :

```bash
curl https://api.ton-domaine.com/v1/extract \
  -H "Authorization: Bearer dk_live_TA_CLE" \
  -F type=invoice \
  -F file=@facture.pdf
```

`type` peut être `invoice`, `purchase_order`, `bank_statement` ou `auto` (l'API devine le type).

## 6. Stripe (quand tu es prêt à encaisser)

Tant que Stripe n'est pas configuré, la page affiche « Coming soon » pour les forfaits payants
et seul le forfait gratuit fonctionne.

> Stripe n'ouvre pas de compte aux entreprises basées au Maroc. Il faut une société dans un pays
> pris en charge (France, Espagne, États-Unis, etc.). Sinon il faudra une autre solution de paiement.

1. Dans Stripe : **Catalogue de produits** → crée deux produits avec un prix **récurrent mensuel** :
   Starter à **19 €** et Pro à **49 €**. Copie l'identifiant de chaque prix (`price_...`).
2. **Développeurs** → **Webhooks** → **Ajouter un endpoint** :
   - URL : `https://api.ton-domaine.com/billing/webhook`
   - Événements : `customer.subscription.updated` et `customer.subscription.deleted`
   - Copie le **secret de signature** (`whsec_...`).
3. Active le **portail client** (Paramètres → Facturation → Portail client) pour que tes clients
   puissent changer de forfait ou annuler eux-mêmes.
4. Dans Coolify, ajoute ces variables puis redéploie :

| Nom | Valeur |
|---|---|
| `STRIPE_SECRET_KEY` | `sk_live_...` (ou `sk_test_...` pour tester) |
| `STRIPE_WEBHOOK_SECRET` | `whsec_...` |
| `STRIPE_PRICE_STARTER` | `price_...` du Starter |
| `STRIPE_PRICE_PRO` | `price_...` du Pro |

Commence en **mode test** de Stripe (clés `sk_test_...`, carte `4242 4242 4242 4242`) avant de passer en réel.

## 7. Suivre tes coûts

Chaque document traité enregistre ses tokens Claude. Pour voir le coût moyen par document,
dans Coolify ouvre le **Terminal** de l'application et tape :

```bash
node -e 'const db=new (require("better-sqlite3"))("/app/data/docapi.db");console.log(db.prepare("SELECT doc_type, COUNT(*) n, AVG(input_tokens) avg_in, AVG(output_tokens) avg_out FROM usage WHERE status=\"ok\" GROUP BY doc_type").all())'
```

Avec `claude-opus-5-5` : coût ≈ (avg_in × 4 + avg_out × 20) / 1 000 000 dollars par document.
Vérifie que ce coût reste bien en dessous de ton prix de vente par document (19 € / 300 ≈ 0,063 €).
