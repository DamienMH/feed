"""Assemblage de l application a partir de la coquille et du moteur.

    python app/build.py                 app/index.html, qui va chercher contenu.json
    python app/build.py --integre       app/demo.html, avec le contenu dans la page

La coquille et le moteur restent deux fichiers separes pendant le developpement,
mais l application livree est un seul fichier : plus simple a heberger, et
indispensable pour les previsualisations qui interdisent les modules externes.
"""

from __future__ import annotations

import argparse
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
    return 0


if __name__ == "__main__":
    sys.exit(main())
