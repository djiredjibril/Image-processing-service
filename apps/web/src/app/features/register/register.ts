/**
 * Page d'inscription.
 */
import { Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { describeApiError } from '../../core/api-error';
import { AuthService } from '../../core/auth/auth.service';

/** Formulaire de création de compte ; en cas de succès, ouvre directement la session. */
@Component({
  selector: 'app-register',
  imports: [ReactiveFormsModule, RouterLink],
  template: `
    <section class="mx-auto max-w-sm rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
      <h1 class="mb-4 text-xl font-semibold">Créer un compte</h1>
      <form [formGroup]="form" (ngSubmit)="submit()" class="space-y-4" novalidate>
        <div>
          <label for="email" class="mb-1 block text-sm font-medium">E-mail</label>
          <input id="email" type="email" formControlName="email" autocomplete="email"
                 class="w-full rounded-md border border-slate-300 px-3 py-2 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-200" />
        </div>
        <div>
          <label for="password" class="mb-1 block text-sm font-medium">Mot de passe</label>
          <input id="password" type="password" formControlName="password" autocomplete="new-password"
                 class="w-full rounded-md border border-slate-300 px-3 py-2 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-200" />
          <p class="mt-1 text-xs text-slate-500">8 caractères minimum.</p>
        </div>
        @if (error(); as message) {
          <p role="alert" class="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{{ message }}</p>
        }
        <button type="submit" [disabled]="form.invalid || loading()"
                class="w-full rounded-md bg-indigo-600 px-4 py-2 font-medium text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50">
          {{ loading() ? 'Création…' : "S'inscrire" }}
        </button>
      </form>
      <p class="mt-4 text-center text-sm text-slate-600">
        Déjà un compte ? <a routerLink="/login" class="text-indigo-600 hover:underline">Se connecter</a>
      </p>
    </section>
  `,
})
export class Register {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);

  protected readonly form = inject(FormBuilder).nonNullable.group({
    email: ['', [Validators.required, Validators.email]],
    password: ['', [Validators.required, Validators.minLength(8)]],
  });
  protected readonly loading = signal(false);
  protected readonly error = signal<string | null>(null);

  /** Crée le compte puis se connecte ; affiche l'erreur de l'API (409 : e-mail déjà pris) sinon redirige. */
  protected submit(): void {
    if (this.form.invalid || this.loading()) {
      return;
    }
    this.loading.set(true);
    this.error.set(null);
    const { email, password } = this.form.getRawValue();
    this.auth.registerAndLogin(email, password).subscribe({
      next: () => {
        void this.router.navigate(['/images']);
      },
      error: (error: unknown) => {
        this.error.set(describeApiError(error));
        this.loading.set(false);
      },
    });
  }
}
