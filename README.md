# Carte de l'informatique graphique en France

Carte des entreprises et des équipes de recherche en informatique graphique en France, maintenue par l'AFIG.
Elle montre, pour une équipe de recherche, les entreprises à moins de 30 km, et pour une entreprise, les
équipes de recherche proches.

Page : https://afig-asso.github.io/cartographie/

## Données

La carte ne contient pas de données : elle lit directement les deux listings de l'AFIG, et suit donc leurs mises à jour.

- Entreprises : [Afig-Asso/entreprises](https://github.com/Afig-Asso/entreprises) (`json/data.json`, coordonnées des implantations)
- Équipes de recherche : [Afig-Asso/research-team](https://github.com/Afig-Asso/research-team) (`json/data.json`, champ `Coordonnées` des labos et des équipes)

Pour corriger une information, modifier le `data.yaml` du listing concerné (ou écrire à contact[at]asso-afig.fr).

## Liens directs

- `?entreprise=Ubisoft` : la carte centrée sur une entreprise
- `?equipe=LJK/MAVERICK` : sur une équipe (`?equipe=LJK` : sur un laboratoire)

## Voir aussi

- Équipes de recherche en informatique graphique : https://afig-asso.github.io/research-team/ (dépôt [Afig-Asso/research-team](https://github.com/Afig-Asso/research-team))
- Entreprises en informatique graphique : https://afig-asso.github.io/entreprises/ (dépôt [Afig-Asso/entreprises](https://github.com/Afig-Asso/entreprises))

## Développement

Le contenu de `site/` est déployé sur https://afig-asso.github.io/cartographie/ à chaque push sur `main`
(`.github/workflows/deploy.yml`, qui a besoin du secret `API_TOKEN_GITHUB`, comme le dépôt entreprises).

En local, servir le dossier qui contient les trois dépôts côte à côte (`cartographie`, `entreprises`, `research-team`) :

```bash
python3 -m http.server 8770
```

puis ouvrir http://localhost:8770/cartographie/site/index.html (les données sont alors lues dans les dépôts voisins).

Leaflet 1.9.4 et Leaflet.markercluster sont copiés dans `site/leaflet/` ; fond de carte Esri World Light Gray (© Esri, contributeurs OpenStreetMap).
