/**
 * Service d'authentification : inscription, connexion, déconnexion et état de session.
 *
 * Rôle : seul propriétaire du jeton. Les composants lisent `isAuthenticated` ; l'intercepteur
 * lit `token`.
 */
import { HttpClient } from '@angular/common/http';
import { computed, inject, Injectable, signal } from '@angular/core';
import { map, Observable, switchMap, tap } from 'rxjs';
import { API_BASE_URL } from '../api-config';
import { TokenStorage } from './token-storage';

/** Compte créé, tel que renvoyé par `POST /register` (jamais de mot de passe ni de hash). */
export interface RegisteredUser {
  readonly id: string;
  readonly email: string;
}

/** Réponse de `POST /login`. */
interface LoginResponse {
  readonly token: string;
}

/** État de session et appels d'authentification de l'API. */
@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = inject(API_BASE_URL);
  private readonly storage = inject(TokenStorage);
  private readonly tokenState = signal<string | null>(this.storage.read());

  /** Jeton courant, ou `null` si déconnecté. */
  readonly token = this.tokenState.asReadonly();

  /** `true` quand un jeton est présent. (Le serveur reste seul juge de sa validité : un 401 déconnecte.) */
  readonly isAuthenticated = computed(() => this.tokenState() !== null);

  /**
   * Crée un compte.
   *
   * @param email - Adresse e-mail.
   * @param password - Mot de passe (8 caractères minimum).
   * @returns Le compte créé. Erreurs : 400 (validation), 409 (e-mail déjà pris).
   */
  register(email: string, password: string): Observable<RegisteredUser> {
    return this.http.post<RegisteredUser>(`${this.baseUrl}/register`, { email, password });
  }

  /**
   * Se connecte et conserve le jeton.
   *
   * @param email - Adresse e-mail.
   * @param password - Mot de passe.
   * @returns Un flux qui se termine quand la session est ouverte. Erreur : 401 (identifiants incorrects).
   */
  login(email: string, password: string): Observable<void> {
    return this.http.post<LoginResponse>(`${this.baseUrl}/login`, { email, password }).pipe(
      tap((response) => {
        this.storage.write(response.token);
        this.tokenState.set(response.token);
      }),
      map(() => undefined),
    );
  }

  /**
   * Crée un compte puis ouvre directement la session.
   *
   * @param email - Adresse e-mail.
   * @param password - Mot de passe.
   * @returns Un flux qui se termine une fois connecté.
   */
  registerAndLogin(email: string, password: string): Observable<void> {
    return this.register(email, password).pipe(switchMap(() => this.login(email, password)));
  }

  /** Ferme la session : oublie le jeton (l'API est stateless, il n'y a rien à invalider côté serveur). */
  logout(): void {
    this.storage.clear();
    this.tokenState.set(null);
  }
}
