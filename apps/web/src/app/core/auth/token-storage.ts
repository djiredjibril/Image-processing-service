/**
 * Stockage du jeton d'authentification dans le navigateur.
 *
 * Rôle : isoler l'accès à `localStorage`. Compromis assumé pour ce projet d'apprentissage :
 * simple, mais lisible par du JavaScript injecté (faille XSS). Un cookie HttpOnly serait plus
 * sûr, mais demanderait de changer l'API (cookies, CSRF).
 */
import { Injectable } from '@angular/core';

const TOKEN_KEY = 'ips.token';

/** Lecture/écriture du jeton ; ne lève jamais (le stockage peut être indisponible : navigation privée…). */
@Injectable({ providedIn: 'root' })
export class TokenStorage {
  /**
   * Lit le jeton enregistré.
   *
   * @returns Le jeton, ou `null` s'il n'y en a pas ou si le stockage est inaccessible.
   */
  read(): string | null {
    try {
      return localStorage.getItem(TOKEN_KEY);
    } catch {
      return null;
    }
  }

  /**
   * Enregistre le jeton.
   *
   * @param token - Jeton JWT reçu de l'API.
   */
  write(token: string): void {
    try {
      localStorage.setItem(TOKEN_KEY, token);
    } catch {
      // Stockage indisponible : la session durera seulement tant que la page reste ouverte.
    }
  }

  /** Supprime le jeton. */
  clear(): void {
    try {
      localStorage.removeItem(TOKEN_KEY);
    } catch {
      // Rien à supprimer si le stockage est inaccessible.
    }
  }
}
