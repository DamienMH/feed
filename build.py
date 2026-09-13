"""Assemblage de l application a partir de la coquille et du moteur.

    python app/build.py                 app/index.html, qui va chercher contenu.json
    python app/build.py --integre       app/demo.html, avec le contenu dans la page

La coquille et le moteur restent deux fichiers separes pendant le developpement,
mais l application livree est un seul fichier : plus simple a heberger, et
indispensable pour les previsualisations qui interdisent les modules externes.
"""

from __future__ import annotations

import argparse
import hashlib
import re
import sys
from pathlib import Path

DOSSIER = Path(__file__).resolve().parent


def assembler(paquet: Path | None) -> str:
    coquille = (DOSSIER / "coquille.html").read_text(encoding="utf-8")
    moteur = (DOSSIER / "moteur.js").read_text(encoding="utf-8")

    # Le moteur devient un espace de noms local : la coquille l appelle par M.
    moteur_inline = "const M = (() => {\n" + moteur.replace("export ", "") + "\n  return {\n"
    noms = []
    for ligne in moteur.splitlines():
        if ligne.startswith("export function "):
            noms.append(ligne.split("function ")[1].split("(")[0])
        elif ligne.startswith("export const "):
            noms.append(ligne.split("const ")[1].split(" ")[0].split("=")[0].strip())
    moteur_inline += "".join(f"    {n},\n" for n in sorted(set(noms))) + "  };\n})();"

    sortie = coquille.replace("/*MOTEUR*/", moteur_inline)

    if paquet:
        contenu = paquet.read_text(encoding="utf-8")
        sortie = sortie.replace("/*PAQUET*/", f"const PAQUET = {contenu};")
    else:
        sortie = sortie.replace("/*PAQUET*/", "const PAQUET = null;")
    return sortie


def versionner_cache(html: str) -> str | None:
    """Aligne le nom du cache du service worker sur le contenu de la page.

    Le service worker sert la coquille depuis son cache et ne la remplace que si
    son nom change. Tant qu on l ecrivait a la main, toute correction oubliait
    de le faire et n arrivait jamais sur le telephone deja installe. On derive
    donc le nom d une empreinte de la page : il change exactement quand il
    faut, ni plus ni moins."""
    sw = DOSSIER / "sw.js"
    if not sw.exists():
        return None
    empreinte = hashlib.sha256(html.encode("utf-8")).hexdigest()[:8]
    avant = sw.read_text(encoding="utf-8")
    apres = re.sub(r'const CACHE = "[^"]*";', f'const CACHE = "feed-{empreinte}";', avant)

    # Les personnages sont pre-caches plutot que ramasses au vol : ils pesent
    # trente kilo-octets a eux tous, et un module ouvert pour la premiere fois
    # dans le metro aurait autrement une colonne vide.
    persos = sorted(q.name for q in (DOSSIER / "images" / "perso").glob("*.png")) \
        if (DOSSIER / "images" / "perso").is_dir() else []
    liste = ", ".join(['"./"', '"./index.html"', '"./manifest.json"']
                      + [f'"./images/perso/{n}"' for n in persos])
    apres = re.sub(r"const COQUILLE = \[[^\]]*\];", f"const COQUILLE = [{liste}];", apres)
    if apres != avant:
        sw.write_text(apres, encoding="utf-8")
        return empreinte
    return None


def main() -> int:
    analyseur = argparse.ArgumentParser(description="Assemblage de l application")
    analyseur.add_argument("--integre", action="store_true",
                           help="inclure le paquet dans la page")
    analyseur.add_argument("--paquet", default=str(DOSSIER / "contenu.json"))
    analyseur.add_argument("--sortie")
    arguments = analyseur.parse_args()

    paquet = Path(arguments.paquet) if arguments.integre else None
    if paquet and not paquet.exists():
        print(f"Paquet introuvable : {paquet}. Lancer d abord : python exporte.py")
        return 1

    html = assembler(paquet)
    sortie = Path(arguments.sortie) if arguments.sortie else (
        DOSSIER / ("demo.html" if arguments.integre else "index.html"))
    sortie.write_text(html, encoding="utf-8")
    print(f"  {sortie.name} : {sortie.stat().st_size / 1024:.0f} Ko")

    if not arguments.integre:
        empreinte = versionner_cache(html)
        if empreinte:
            print(f"  sw.js : cache renomme feed-{empreinte}, "
                  "les telephones prendront la nouvelle version")
    return 0


if __name__ == "__main__":
    sys.exit(main())
