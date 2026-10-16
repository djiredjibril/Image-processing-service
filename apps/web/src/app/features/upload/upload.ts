/**
 * Page d'envoi d'une image.
 */
import { Component, DestroyRef, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { describeApiError } from '../../core/api-error';
import { ACCEPTED_MIME_TYPES, validateImageFile } from '../../core/images/image-validation';
import { ImagesService } from '../../core/images/images.service';

/** Sélection d'un fichier, aperçu local, pré-contrôle puis envoi à l'API. */
@Component({
  selector: 'app-upload',
  imports: [RouterLink],
  template: `
    <section class="mx-auto max-w-lg rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
      <h1 class="mb-1 text-xl font-semibold">Envoyer une image</h1>
      <p class="mb-4 text-sm text-slate-500">JPEG, PNG ou WebP · 10 Mo maximum · 8000 px par côté maximum.</p>

      <input type="file" [accept]="accept" (change)="onFileChosen($event)" aria-label="Choisir une image"
             class="block w-full text-sm file:mr-4 file:rounded-md file:border-0 file:bg-indigo-50 file:px-4 file:py-2 file:font-medium file:text-indigo-700 hover:file:bg-indigo-100" />

      @if (previewUrl(); as url) {
        <img [src]="url" alt="Aperçu de l'image choisie" class="mt-4 max-h-64 w-full rounded-lg border border-slate-200 object-contain" />
      }
      @if (error(); as message) {
        <p role="alert" class="mt-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{{ message }}</p>
      }

      <div class="mt-6 flex items-center justify-between">
        <a routerLink="/images" class="text-sm text-slate-600 hover:underline">Annuler</a>
        <button type="button" (click)="submit()" [disabled]="file() === null || uploading()"
                class="rounded-md bg-indigo-600 px-4 py-2 font-medium text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50">
          {{ uploading() ? 'Envoi…' : 'Envoyer' }}
        </button>
      </div>
    </section>
  `,
})
export class Upload {
  private readonly images = inject(ImagesService);
  private readonly router = inject(Router);

  protected readonly accept = ACCEPTED_MIME_TYPES.join(',');
  protected readonly file = signal<File | null>(null);
  protected readonly previewUrl = signal<string | null>(null);
  protected readonly error = signal<string | null>(null);
  protected readonly uploading = signal(false);

  constructor() {
    // Libère l'URL d'aperçu à la fermeture de la page.
    inject(DestroyRef).onDestroy(() => {
      this.releasePreview();
    });
  }

  /**
   * Réagit au choix d'un fichier : pré-contrôle puis aperçu.
   *
   * @param event - Événement `change` de l'`<input type="file">`.
   */
  protected onFileChosen(event: Event): void {
    this.releasePreview();
    this.error.set(null);
    const chosen = (event.target as HTMLInputElement).files?.item(0) ?? null;
    if (chosen === null) {
      this.file.set(null);
      return;
    }
    const problem = validateImageFile(chosen);
    if (problem !== null) {
      this.file.set(null);
      this.error.set(problem);
      return;
    }
    this.file.set(chosen);
    this.previewUrl.set(URL.createObjectURL(chosen));
  }

  /** Envoie le fichier ; en cas de succès ouvre l'image créée, sinon affiche l'erreur de l'API (413, 415…). */
  protected submit(): void {
    const chosen = this.file();
    if (chosen === null || this.uploading()) {
      return;
    }
    this.uploading.set(true);
    this.error.set(null);
    this.images.upload(chosen).subscribe({
      next: (image) => {
        void this.router.navigate(['/images', image.id]);
      },
      error: (error: unknown) => {
        this.error.set(describeApiError(error));
        this.uploading.set(false);
      },
    });
  }

  /** Révoque l'URL objet de l'aperçu courant, s'il y en a une. */
  private releasePreview(): void {
    const url = this.previewUrl();
    if (url !== null) {
      URL.revokeObjectURL(url);
      this.previewUrl.set(null);
    }
  }
}
