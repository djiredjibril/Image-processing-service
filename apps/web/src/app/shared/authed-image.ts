/**
 * Composant d'affichage d'une image protégée par l'API.
 *
 * Rôle : une balise `<img src>` ne peut pas envoyer `Authorization`. Ce composant télécharge
 * l'image avec `HttpClient` (jeton ajouté par l'intercepteur), puis l'affiche via une URL objet.
 */
import { Component, effect, inject, input, signal } from '@angular/core';
import { ImagesService } from '../core/images/images.service';

/** Image téléchargée avec authentification ; libère l'URL objet quand elle n'est plus utilisée. */
@Component({
  selector: 'app-authed-image',
  template: `
    @if (src(); as url) {
      <img [src]="url" [alt]="alt()" [class]="imgClass()" />
    } @else if (failed()) {
      <div class="flex h-full w-full items-center justify-center bg-slate-100 p-2 text-center text-xs text-slate-500">
        Image indisponible
      </div>
    } @else {
      <div class="h-full w-full animate-pulse bg-slate-200" aria-label="Chargement de l'image"></div>
    }
  `,
  host: { class: 'block' },
})
export class AuthedImage {
  /** Identifiant de l'image à afficher. */
  readonly imageId = input.required<string>();
  /** Texte alternatif. */
  readonly alt = input('');
  /** Classes CSS appliquées à la balise `<img>`. */
  readonly imgClass = input('');

  protected readonly src = signal<string | null>(null);
  protected readonly failed = signal(false);
  private readonly images = inject(ImagesService);

  constructor() {
    effect((onCleanup) => {
      const id = this.imageId();
      this.src.set(null);
      this.failed.set(false);

      let objectUrl: string | null = null;
      const subscription = this.images.download(id).subscribe({
        next: (blob) => {
          objectUrl = URL.createObjectURL(blob);
          this.src.set(objectUrl);
        },
        error: () => {
          this.failed.set(true);
        },
      });
      // Annule le téléchargement et libère la mémoire quand l'identifiant change ou que le composant disparaît.
      onCleanup(() => {
        subscription.unsubscribe();
        if (objectUrl !== null) {
          URL.revokeObjectURL(objectUrl);
        }
      });
    });
  }
}
