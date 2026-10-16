/**
 * Guards de routes liés à la session.
 *
 * Rôle : protéger les pages privées (`authGuard`) et éviter d'afficher connexion/inscription
 * à quelqu'un déjà connecté (`guestGuard`). Ce n'est que de l'ergonomie : la vraie protection
 * est celle de l'API, qui exige un jeton valide.
 */
import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from './auth.service';

/** Autorise la route si connecté, sinon redirige vers `/login`. */
export const authGuard: CanActivateFn = () => {
  return inject(AuthService).isAuthenticated() ? true : inject(Router).createUrlTree(['/login']);
};

/** Autorise la route si NON connecté, sinon redirige vers la galerie. */
export const guestGuard: CanActivateFn = () => {
  return inject(AuthService).isAuthenticated() ? inject(Router).createUrlTree(['/images']) : true;
};
