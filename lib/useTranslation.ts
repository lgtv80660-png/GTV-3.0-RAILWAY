"use client";

import { useMemo } from "react";

// Dictionnaire de traductions de base
const translations: Record<string, Record<string, string>> = {
  fr: {
    "Catalog.categories": "Catégories",
    "Catalog.allCategories": "Toutes les catégories",
    "Catalog.emptyCategory": "Aucun contenu disponible dans cette catégorie.",
    "Nav.movies": "Films",
    "Nav.series": "Séries",
    "Nav.live": "TV en direct",
    "Nav.home": "Accueil",
    "Nav.search": "Recherche",
    "Nav.myList": "Ma Liste",
  },
  en: {
    "Catalog.categories": "Categories",
    "Catalog.allCategories": "All Categories",
    "Catalog.emptyCategory": "No content available in this category.",
    "Nav.movies": "Movies",
    "Nav.series": "Series",
    "Nav.live": "Live TV",
    "Nav.home": "Home",
    "Nav.search": "Search",
    "Nav.myList": "My List",
  },
};

export function useTranslation(lang: string = "fr") {
  const t = useMemo(() => {
    const dict = translations[lang] || translations.fr;
    return (key: string): string => {
      return dict[key] || key;
    };
  }, [lang]);

  return { t, lang };
}