/**
 * Configuration de l'URL de l'API.
 *
 * Rôle : fournir l'adresse de base de l'API via l'injection de dépendances, pour pouvoir
 * la remplacer (autre environnement, tests) sans toucher aux services.
 */
import { InjectionToken } from '@angular/core';

/**
 * URL de base de l'API (sans `/` final).
 *
 * En développement, c'est l'API Express locale. Elle doit autoriser l'origine de cette
 * application via `CORS_ORIGIN` (défaut `http://localhost:4200`).
 */
export const API_BASE_URL = new InjectionToken<string>('API_BASE_URL', {
  providedIn: 'root',
  factory: () => 'http://localhost:3001',
});
