# Orbit — Démo (vitrine)

Version **vitrine** du tableau de bord personnel **Orbit** — 100 % frontend, **données entièrement fictives**, aucun backend.

> ⚠️ Démo uniquement : aucun bot, aucune clé, aucune donnée réelle. Le vrai Orbit (bot de trading, secrets, données) reste privé.

**Démo en ligne :** https://thespicyy.github.io/orbit-demo/

Apps incluses : journal de trading & analyses, budget & projection d'actifs, to-do & planning (temps), suivi de capital.
Stack : HTML / CSS / JavaScript — dashboards autonomes, données en `localStorage`.

---

## Mettre à jour la démo (si le dossier a été archivé)

La démo en ligne est servie par **GitHub Pages** depuis le dépôt distant `github.com/thespicyy/orbit-demo` — **pas** depuis ce dossier local. Archiver ou déplacer ce dossier ne coupe donc **rien** : le site reste en ligne.

Pour la modifier de nouveau :

1. Récupérer une copie de travail (si le dossier n'est plus là) :
   ```bash
   git clone https://github.com/thespicyy/orbit-demo.git
   cd orbit-demo
   ```
   *(ou simplement désarchiver ce dossier — le `.git` y est déjà)*

2. Éditer les fichiers (`index.html`, `apps/…`), puis publier :
   ```bash
   git add -A
   git commit -m "Update démo"
   git push
   ```

3. GitHub Pages redéploie automatiquement en ~1 min → https://thespicyy.github.io/orbit-demo/

> 💾 Le dépôt GitHub est la **source de vérité** et ta sauvegarde : même si ce dossier local disparaît, tout est récupérable via `git clone`.
