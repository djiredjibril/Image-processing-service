/**
 * Routes de l'application (chargement différé de chaque page).
 *
 * `images/new` est déclarée AVANT `images/:id`, sinon « new » serait lu comme un identifiant.
 */
import { Routes } from '@angular/router';
import { authGuard, guestGuard } from './core/auth/auth.guard';

/** Table de routage : pages publiques (connexion, inscription) et pages protégées. */
export const routes: Routes = [
  { path: 'login', canActivate: [guestGuard], loadComponent: () => import('./features/login/login').then((m) => m.Login) },
  { path: 'register', canActivate: [guestGuard], loadComponent: () => import('./features/register/register').then((m) => m.Register) },
  { path: 'images', canActivate: [authGuard], loadComponent: () => import('./features/gallery/gallery').then((m) => m.Gallery) },
  { path: 'images/new', canActivate: [authGuard], loadComponent: () => import('./features/upload/upload').then((m) => m.Upload) },
  { path: 'images/:id', canActivate: [authGuard], loadComponent: () => import('./features/image-detail/image-detail').then((m) => m.ImageDetail) },
  { path: 'monitoring', canActivate: [authGuard], loadComponent: () => import('./features/monitoring/monitoring').then((m) => m.Monitoring) },
  { path: '', pathMatch: 'full', redirectTo: 'images' },
  { path: '**', redirectTo: 'images' },
];
