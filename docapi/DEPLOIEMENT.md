# Mettre l'API en ligne avec Coolify

L'API lit des factures, bons de commande et relevés bancaires (PDF ou image) et renvoie les données en JSON.
Elle utilise Claude pour la lecture, et Lemon Squeezy pour les abonnements.

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

Pour voir tes coûts (recommandé) :

| Nom | Valeur |
|---|---|
| `ADMIN_TOKEN` | un long mot de passe que tu inventes (30 caractères ou plus), différent de tes autres mots de passe |

Optionnel :

| Nom | Par défaut | Rôle |
|---|---|---|
| `BRAND_NAME` | `DocExtract` | Le nom affiché sur la page d'accueil |
| `MODEL` | `claude-haiku-5-5` | Le modèle qui lit chaque document en premier (le moins cher) |
| `EFFORT` | `low` | Effort du premier modèle |
| `ESCALATION_MODEL` | `claude-opus-5-5` | Le modèle appelé seulement si les totaux ne collent pas. Mets une valeur vide pour ne jamais l'appeler |
| `ESCALATION_EFFORT` | `medium` | Effort du modèle de secours |
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

## 6. Lemon Squeezy (pour encaisser)

Tant que Lemon Squeezy n'est pas configuré, la page affiche « Coming soon » pour les forfaits payants
et seul le forfait gratuit fonctionne. Lemon Squeezy est le « marchand officiel » : il encaisse les
clients du monde entier, gère la TVA et les taxes, et te verse l'argent deux fois par mois.

Ajoute d'abord ces deux variables (Lemon Squeezy vérifie tes pages légales avant d'activer les paiements) :

| Nom | Valeur |
|---|---|
| `CONTACT_EMAIL` | l'adresse email de support affichée sur le site (ex. `support@ton-domaine.com`) |
| `LEGAL_NAME` | ton nom ou celui de ta société, affiché dans les conditions d'utilisation |

Les pages `/terms`, `/privacy` et `/refunds` existent déjà sur ton site. Relis-les : ce sont des modèles,
pas un avis juridique.

Ensuite, dans Lemon Squeezy :

1. **Products** → **New product** → « DocExtract Starter », prix **19 €**, **Subscription**, tous les mois.
   Recommence pour « DocExtract Pro » à **49 €**.
2. Pour chaque produit, note l'**ID de la variante** (Variant ID, un nombre) : ouvre le produit, la variante
   par défaut a un ID visible dans l'URL ou dans le menu « … » → « Copy ID ».
3. **Settings** → **Stores** : note l'**ID de ta boutique** (Store ID, un nombre).
4. **Settings** → **API** → **New API key** : copie la clé (elle ne s'affiche qu'une fois).
5. **Settings** → **Webhooks** → **+** :
   - Callback URL : `https://TON-ADRESSE/billing/webhook`
   - Signing secret : invente un long mot de passe (lettres et chiffres)
   - Événements : coche tous ceux qui commencent par `subscription_`

Puis, dans Coolify (avec **Literal** coché et **Build time** décoché), ajoute :

| Nom | Valeur |
|---|---|
| `LEMONSQUEEZY_API_KEY` | la clé API de l'étape 4 |
| `LEMONSQUEEZY_STORE_ID` | l'ID de la boutique (étape 3) |
| `LEMONSQUEEZY_WEBHOOK_SECRET` | le signing secret de l'étape 5 |
| `LEMONSQUEEZY_VARIANT_STARTER` | l'ID de variante du Starter |
| `LEMONSQUEEZY_VARIANT_PRO` | l'ID de variante du Pro |

Redéploie. Dans les **Logs**, tu dois voir `Paid plans enabled (Lemon Squeezy)`.

Teste d'abord en **mode test** de Lemon Squeezy (interrupteur « Test mode », carte `4242 4242 4242 4242`) :
après le paiement, tu dois revenir sur ton site et voir ta clé API Starter.

## 7. Suivre tes coûts

Chaque document est d'abord lu par Claude Haiku 5.5, le modèle le moins cher. L'API vérifie ensuite
que les montants s'additionnent. Si ce n'est pas le cas, Claude Opus 5.5 relit le document : il coûte
plus cher, mais seulement pour les documents difficiles.

Pour voir le coût réel, ouvre dans ton navigateur (avec ton `ADMIN_TOKEN`) :

```
https://TON-ADRESSE/admin/stats?token=TON_ADMIN_TOKEN
```

Tu y vois, pour le mois en cours et par type de document : le nombre de documents, le coût moyen
(`avg_cost_usd`), le coût total, combien ont eu besoin d'Opus (`escalated`), et le nombre de clients
par forfait. Ne partage pas cette adresse : elle contient ton mot de passe admin.

Compare `avg_cost_usd` à ton prix de vente par document (19 € / 300 ≈ 0,063 €).
