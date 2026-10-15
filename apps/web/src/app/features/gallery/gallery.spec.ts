/** Tests du composant galerie : états (vide, erreur, liste) et pagination. */
import { HttpErrorResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of, throwError } from 'rxjs';
import { ImagePage, ImageSummary } from '../../core/images/image.models';
import { ImagesService } from '../../core/images/images.service';
import { Gallery, GALLERY_PAGE_SIZE } from './gallery';

function summary(id: string): ImageSummary {
  return { id, originalId: null, format: 'png', sizeBytes: 100, width: 10, height: 10, createdAt: '2026-01-01T10:00:00.000Z' };
}

describe('Gallery', () => {
  const list = vi.fn<(page: number, limit: number) => ReturnType<ImagesService['list']>>();
  const download = vi.fn(() => of(new Blob(['x'], { type: 'image/png' })));

  beforeEach(() => {
    list.mockReset();
    URL.createObjectURL = vi.fn(() => 'blob:fake');
    URL.revokeObjectURL = vi.fn();
    TestBed.configureTestingModule({
      providers: [provideRouter([]), { provide: ImagesService, useValue: { list, download } }],
    });
  });

  async function render(): Promise<HTMLElement> {
    const fixture = TestBed.createComponent(Gallery);
    await fixture.whenStable();
    return fixture.nativeElement as HTMLElement;
  }
  const buttons = (el: HTMLElement): HTMLButtonElement[] => Array.from(el.querySelectorAll('nav button'));

  it('charge la page 1 avec la taille de page prévue', async () => {
    list.mockReturnValue(of({ items: [summary('a')], page: 1, limit: GALLERY_PAGE_SIZE, total: 1 }));
    await render();
    expect(list).toHaveBeenCalledWith(1, GALLERY_PAGE_SIZE);
  });

  it("affiche un message d'accueil quand il n'y a aucune image", async () => {
    list.mockReturnValue(of({ items: [], page: 1, limit: GALLERY_PAGE_SIZE, total: 0 }));
    const el = await render();
    expect(el.textContent).toContain("Aucune image pour l'instant");
    expect(el.querySelector('nav')).toBeNull();
  });

  it('affiche une vignette par image avec un lien vers son détail', async () => {
    list.mockReturnValue(of({ items: [summary('a'), summary('b')], page: 1, limit: GALLERY_PAGE_SIZE, total: 2 }));
    const el = await render();
    const links = Array.from(el.querySelectorAll('ul a')).map((a) => a.getAttribute('href'));
    expect(links).toEqual(['/images/a', '/images/b']);
  });

  it('désactive « Précédent » sur la première page et « Suivant » sur la dernière', async () => {
    const page: ImagePage = { items: [summary('a')], page: 1, limit: 12, total: 25 };
    list.mockReturnValue(of(page));
    const el = await render();
    const [previous, next] = buttons(el);
    expect(previous?.disabled).toBe(true);
    expect(next?.disabled).toBe(false);
    expect(el.textContent).toContain('Page 1 / 3');
  });

  it('« Suivant » demande la page suivante, la dernière page désactive « Suivant »', async () => {
    list.mockImplementation((page) => of({ items: [summary(`p${String(page)}`)], page, limit: 12, total: 25 }));
    const fixture = TestBed.createComponent(Gallery);
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;

    buttons(el)[1]?.click();
    await fixture.whenStable();
    expect(list).toHaveBeenLastCalledWith(2, 12);

    buttons(el)[1]?.click();
    await fixture.whenStable();
    expect(list).toHaveBeenLastCalledWith(3, 12);
    expect(buttons(el)[1]?.disabled).toBe(true);
  });

  it("affiche l'erreur de l'API", async () => {
    list.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 0 })));
    const el = await render();
    expect(el.querySelector('[role="alert"]')?.textContent).toContain('joindre');
  });
});
