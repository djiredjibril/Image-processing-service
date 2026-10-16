/**
 * Intercepteur HTTP d'authentification.
 *
 * Rôle : ajoute `Authorization: Bearer <jeton>` aux appels vers l'API, et déconnecte
 * l'utilisateur quand l'API répond 401 (jeton expiré ou invalide).
 */
import { HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { catchError, throwError } from 'rxjs';
import { API_BASE_URL } from '../api-config';
import { AuthService } from './auth.service';

/**
 * Intercepteur fonctionnel.
 *
 * Le jeton n'est envoyé QU'À l'API (jamais à un autre domaine), pour ne pas le divulguer.
 * Un 401 sans jeton (ex. mauvais mot de passe à la connexion) ne déconnecte ni ne redirige :
 * c'est une erreur à afficher dans le formulaire.
 */
export const authInterceptor: HttpInterceptorFn = (request, next) => {
  const baseUrl = inject(API_BASE_URL);
  if (!request.url.startsWith(baseUrl)) {
    return next(request);
  }

  const auth = inject(AuthService);
  const router = inject(Router);
  const token = auth.token();
  const authenticated = token === null ? request : request.clone({ setHeaders: { Authorization: `Bearer ${token}` } });

  return next(authenticated).pipe(
    catchError((error: unknown) => {
      if (token !== null && error instanceof HttpErrorResponse && error.status === 401) {
        auth.logout();
        void router.navigate(['/login']);
      }
      return throwError(() => error);
    }),
  );
};
