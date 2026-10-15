/** Tests du composant d'envoi : pré-contrôle, aperçu, envoi et erreurs de l'API. */
import { HttpErrorResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { of, throwError } from 'rxjs';
import { ImagesService } from '../../core/images/images.service';
import { Upload } from './upload';

describe('Upload', () => {
  const upload = vi.fn();
  let navigate: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    upload.mockReset();
    URL.createObjectURL = vi.fn(() => 'blob:apercu');
    URL.revokeObjectURL = vi.fn();
    TestBed.configureTestingModule({
      providers: [provideRouter([]), { provide: ImagesService, useValue: { upload } }],
    });
    navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
  });

  async function render(): Promise<{ el: HTMLElement; choose: (file: File) => Promise<void>; send: () => Promise<void> }> {
    const fixture = TestBed.createComponent(Upload);
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;
    const input = el.querySelector('input[type="file"]') as HTMLInputElement;
    return {
      el,
      choose: async (file: File) => {
        Object.defineProperty(input, 'files', { value: { item: () => file, length: 1 }, configurable: true });
        input.dispatchEvent(new Event('change'));
        await fixture.whenStable();
      },
      send: async () => {
        (el.querySelector('button') as HTMLButtonElement).click();
        await fixture.whenStable();
      },
    };
  }
  const png = (): File => new File([new Uint8Array([1, 2, 3])], 'photo.png', { type: 'image/png' });

  it("désactive l'envoi tant qu'aucun fichier valide n'est choisi", async () => {
    const { el } = await render();
    expect((el.querySelector('button') as HTMLButtonElement).disabled).toBe(true);
  });

  it('refuse un format non supporté AVANT tout appel réseau', async () => {
    const { el, choose } = await render();
    await choose(new File(['GIF89a'], 'anim.gif', { type: 'image/gif' }));
    expect(el.querySelector('[role="alert"]')?.textContent).toContain('Format non supporté');
    expect((el.querySelector('button') as HTMLButtonElement).disabled).toBe(true);
    expect(upload).not.toHaveBeenCalled();
  });

  it('affiche un aperçu pour un fichier valide', async () => {
    const { el, choose } = await render();
    await choose(png());
    expect(el.querySelector('img')?.getAttribute('src')).toBe('blob:apercu');
  });

  it("envoie le fichier puis ouvre l'image créée", async () => {
    upload.mockReturnValue(of({ id: 'nouvelle', format: 'png', sizeBytes: 3, width: 1, height: 1, createdAt: '' }));
    const { choose, send } = await render();
    await choose(png());
    await send();
    expect(upload).toHaveBeenCalledOnce();
    expect(navigate).toHaveBeenCalledWith(['/images', 'nouvelle']);
  });

  it("affiche l'erreur de l'API (ex. 413) et permet de réessayer", async () => {
    upload.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 413, error: { message: 'Image trop grande' } })));
    const { el, choose, send } = await render();
    await choose(png());
    await send();
    expect(el.querySelector('[role="alert"]')?.textContent).toContain('Image trop grande');
    expect(navigate).not.toHaveBeenCalled();
    expect((el.querySelector('button') as HTMLButtonElement).disabled).toBe(false);
  });
});
