/**
 * Page de visualisation d'une image : affichage, lien temporaire et transformations.
 */
import { Component, inject, input, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { describeApiError } from '../../core/api-error';
import { PresignedUrl } from '../../core/images/transform.models';
import { TransformsService } from '../../core/images/transforms.service';
import { AuthedImage } from '../../shared/authed-image';
import { TransformPanel } from './transform-panel';

/** Affiche une image en grand, propose un lien temporaire de téléchargement et le panneau de transformation. L'identifiant vient de la route (`/images/:id`). */
@Component({
  selector: 'app-image-detail',
  imports: [RouterLink, AuthedImage, TransformPanel],
  template: `
    <a routerLink="/images" class="mb-4 inline-block text-sm text-indigo-600 hover:underline">← Retour à la galerie</a>
    <div class="overflow-hidden rounded-xl border border-slate-200 bg-white p-2 shadow-sm">
      <div class="flex min-h-48 items-center justify-center">
        <app-authed-image [imageId]="id()" alt="Image" imgClass="max-h-[75vh] w-auto max-w-full rounded-lg" />
      </div>
    </div>
    <p class="mt-3 break-all text-xs text-slate-500">Identifiant : {{ id() }}</p>

    <section class="mt-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm" aria-labelledby="link-title">
      <h2 id="link-title" class="mb-1 text-lg font-semibold">Lien de téléchargement temporaire</h2>
      <p class="mb-3 text-sm text-slate-600">
        Une URL signée qui permet de télécharger l'image directement depuis le stockage, sans connexion, jusqu'à son expiration.
        Quiconque possède ce lien peut voir l'image : ne le partagez pas à la légère.
      </p>
      <button type="button" (click)="requestLink()" [disabled]="loadingLink()"
              class="rounded-md border border-slate-300 px-4 py-2 text-sm hover:bg-slate-50 disabled:opacity-50">
        {{ loadingLink() ? 'Génération…' : 'Générer un lien' }}
      </button>
      @if (link(); as current) {
        <div class="mt-3 space-y-1 text-sm">
          <input readonly [value]="current.url" aria-label="Lien temporaire" class="w-full rounded-md border border-slate-300 bg-slate-50 px-2 py-1.5 text-xs" (focus)="selectAll($event)" />
          <p class="text-slate-600">Valable {{ current.expiresInSeconds }} s (jusqu'à {{ expiresAtLabel(current) }}).</p>
        </div>
      }
      @if (linkError(); as message) {
        <p role="alert" class="mt-3 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800">{{ message }}</p>
      }
    </section>

    <app-transform-panel [imageId]="id()" />
  `,
})
export class ImageDetail {
  /** Identifiant de l'image, injecté depuis le paramètre de route `:id`. */
  readonly id = input.required<string>();

  protected readonly link = signal<PresignedUrl | null>(null);
  protected readonly linkError = signal<string | null>(null);
  protected readonly loadingLink = signal(false);
  private readonly transforms = inject(TransformsService);

  /** Demande une URL signée ; avec un stockage sur disque, l'API répond 501 et le message est affiché tel quel. */
  protected requestLink(): void {
    this.loadingLink.set(true);
    this.linkError.set(null);
    this.transforms.getTemporaryUrl(this.id()).subscribe({
      next: (url) => {
        this.link.set(url);
        this.loadingLink.set(false);
      },
      error: (error: unknown) => {
        this.link.set(null);
        this.linkError.set(describeApiError(error));
        this.loadingLink.set(false);
      },
    });
  }

  /** Heure d'expiration lisible (heure locale). */
  protected expiresAtLabel(url: PresignedUrl): string {
    return new Date(url.expiresAt).toLocaleTimeString('fr-FR');
  }

  /** Sélectionne tout le lien au clic, pour le copier facilement. */
  protected selectAll(event: Event): void {
    (event.target as HTMLInputElement).select();
  }
}
