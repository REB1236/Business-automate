# Kit de lancement DocExtract

Textes prêts à copier (en anglais, pour l'international). Remplace `https://TON-DOMAINE` par l'adresse du site.
Chaque plateforme a ses règles : publie **une fois**, honnêtement, et réponds aux commentaires. Pas de messages en masse.

---

## 1. Description courte (une ligne)

> DocExtract: send an invoice, purchase order or bank statement, get clean JSON back with every total checked. Free plan, then $19/month.

## 2. Description longue (annuaires d'API, Product Hunt, etc.)

> **DocExtract turns business documents into structured JSON.**
>
> Upload an invoice, purchase order or bank statement (PDF, scan or photo) with one POST request and get back parties, dates, tax IDs, line items, totals and transactions as JSON.
>
> What makes it different: every result is **checked**. Line amounts, subtotal + tax = total, and bank statement balances are verified automatically, and the response tells you which checks passed. You know which documents to review by hand instead of trusting blindly.
>
> - One endpoint, no templates to configure
> - Missing values come back as null, never invented
> - Documents are processed in memory and not stored
> - Free plan (20 documents/month), Starter $19/month (300), Pro $49/month (1,000)
>
> Docs: https://TON-DOMAINE/docs

## 3. Tags / catégories

`invoice OCR`, `document parsing`, `data extraction`, `accounting`, `fintech`, `bank statement parser`, `API`, `AI`, `automation`

## 4. « Show HN » (Hacker News)

Titre :
> Show HN: An invoice/bank-statement-to-JSON API that checks its own math

Texte :
> I built a small API that extracts structured JSON from invoices, purchase orders and bank statements. The part I cared about most: it verifies the arithmetic of what it extracted (line amounts, subtotal + tax = total, opening balance + transactions = closing balance) and returns those checks with the data, so you can route failures to a human instead of silently booking wrong numbers. A cheap model reads the document first; only documents that fail a check are re-read by a stronger model, which keeps the cost per document under a cent. Free tier, no card. Feedback welcome, especially on documents it gets wrong.
> https://TON-DOMAINE

## 5. Message court pour des contacts (comptables, développeurs, freelances)

> Hi [prénom], I've launched a small tool that reads invoices and bank statements and turns them into structured data (JSON), with the totals checked automatically. If you or your clients still type invoices by hand, I'd love you to try it for free and tell me what breaks: https://TON-DOMAINE

## 6. Où publier (une fois chacun)

| Endroit | Pourquoi | Remarque |
|---|---|---|
| Hacker News (Show HN) | Développeurs, très gros trafic potentiel | Un seul post, texte du §4 |
| Product Hunt | Visibilité lancement | Prépare 2-3 captures d'écran |
| Reddit : r/SideProject, r/webdev, r/Accounting | Développeurs et comptables | Lis les règles de chaque forum avant ; beaucoup interdisent l'auto-promotion |
| Indie Hackers | Fondateurs de petits SaaS | Raconte l'histoire, pas une pub |
| Annuaires d'API (RapidAPI, etc.) | Les développeurs y cherchent des API | Utilise le §2 et l'URL `/openapi.json` |
| Dépôt GitHub « public-apis » | Liste très suivie | Vérifie leurs critères avant une pull request |
| Tes contacts LinkedIn | Comptables, PME | Message du §5, personnalisé |

## 7. Ce qui marche le mieux

1. Les **premiers retours** valent plus que les premières ventes : demande ce qui ne marche pas.
2. Réponds vite aux questions, c'est ce qui crée la confiance.
3. Mesure : regarde `/admin/stats` (inscriptions gratuites, documents traités) après chaque publication.
