/**
 * Composant racine : en-tête de navigation et zone d'affichage des pages.
 */
import { Component, inject } from '@angular/core';
import { Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { AuthService } from './core/auth/auth.service';

/** Coquille de l'application : barre de navigation + routeur. */
@Component({
  selector: 'app-root',
  imports: [RouterOutlet, RouterLink, RouterLinkActive],
  template: `
    <header class="border-b border-slate-200 bg-white">
      <nav class="mx-auto flex max-w-5xl items-center justify-between gap-4 px-4 py-3">
        <a routerLink="/" class="text-lg font-semibold text-indigo-600">Image Service</a>
        <div class="flex items-center gap-4 text-sm">
          @if (auth.isAuthenticated()) {
            <a routerLink="/images" routerLinkActive="font-semibold text-indigo-600" [routerLinkActiveOptions]="{ exact: true }" class="text-slate-600 hover:text-indigo-600">Galerie</a>
            <a routerLink="/images/new" routerLinkActive="font-semibold text-indigo-600" class="text-slate-600 hover:text-indigo-600">Envoyer</a>
            <a routerLink="/monitoring" routerLinkActive="font-semibold text-indigo-600" class="text-slate-600 hover:text-indigo-600">Supervision</a>
            <button type="button" (click)="logout()" class="rounded-md border border-slate-300 px-3 py-1 text-slate-700 hover:bg-slate-50">Se déconnecter</button>
          } @else {
            <a routerLink="/login" routerLinkActive="font-semibold text-indigo-600" class="text-slate-600 hover:text-indigo-600">Connexion</a>
            <a routerLink="/register" routerLinkActive="font-semibold text-indigo-600" class="text-slate-600 hover:text-indigo-600">Inscription</a>
          }
        </div>
      </nav>
    </header>
    <main class="mx-auto max-w-5xl px-4 py-8">
      <router-outlet />
    </main>
  `,
})
export class App {
  protected readonly auth = inject(AuthService);
  private readonly router = inject(Router);

  /** Ferme la session puis retourne à la page de connexion. */
  protected logout(): void {
    this.auth.logout();
    void this.router.navigate(['/login']);
  }
}
