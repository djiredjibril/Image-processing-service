/** Tests de l'image authentifiée : téléchargement, affichage, erreur et libération mémoire. */
import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { of, Subject, throwError } from 'rxjs';
import { ImagesService } from '../core/images/images.service';
import { AuthedImage } from './authed-image';

@Component({ imports: [AuthedImage], template: `<app-authed-image [imageId]="id()" alt="test" />` })
class Host {
  readonly id = signal('a');
}

describe('AuthedImage', () => {
  const download = vi.fn();
  const createObjectURL = vi.fn((blob: Blob) => `blob:${String(blob.size)}`);
  const revokeObjectURL = vi.fn();

  beforeEach(() => {
    download.mockReset();
    createObjectURL.mockClear();
    revokeObjectURL.mockClear();
    URL.createObjectURL = createObjectURL;
    URL.revokeObjectURL = revokeObjectURL;
    TestBed.configureTestingModule({ providers: [{ provide: ImagesService, useValue: { download } }] });
  });

  it("télécharge l'image avec authentification et l'affiche via une URL objet", async () => {
    download.mockReturnValue(of(new Blob(['abc'])));
    const fixture = TestBed.createComponent(Host);
    await fixture.whenStable();
    expect(download).toHaveBeenCalledWith('a');
    expect((fixture.nativeElement as HTMLElement).querySelector('img')?.getAttribute('src')).toBe('blob:3');
  });

  it('affiche un état de chargement tant que le téléchargement est en cours', async () => {
    download.mockReturnValue(new Subject<Blob>());
    const fixture = TestBed.createComponent(Host);
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('img')).toBeNull();
    expect(el.querySelector('[aria-label]')).not.toBeNull();
  });

  it("affiche « Image indisponible » si le téléchargement échoue (ex. 404)", async () => {
    download.mockReturnValue(throwError(() => new Error('404')));
    const fixture = TestBed.createComponent(Host);
    await fixture.whenStable();
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('Image indisponible');
  });

  it("libère l'URL objet quand l'identifiant change et quand le composant est détruit", async () => {
    download.mockReturnValue(of(new Blob(['abc'])));
    const fixture = TestBed.createComponent(Host);
    await fixture.whenStable();

    fixture.componentInstance.id.set('b');
    await fixture.whenStable();
    expect(download).toHaveBeenLastCalledWith('b');
    expect(revokeObjectURL).toHaveBeenCalledTimes(1);

    fixture.destroy();
    expect(revokeObjectURL).toHaveBeenCalledTimes(2);
  });
});
