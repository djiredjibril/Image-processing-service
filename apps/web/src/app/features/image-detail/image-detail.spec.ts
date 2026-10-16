/** Tests de la page de détail : lien temporaire (succès, 501 avec le stockage sur disque) et présence du panneau de transformation. */
import { HttpErrorResponse } from '@angular/common/http';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of, throwError } from 'rxjs';
import { ImagesService } from '../../core/images/images.service';
import { TransformsService } from '../../core/images/transforms.service';
import { ImageDetail } from './image-detail';

describe('ImageDetail', () => {
  const getTemporaryUrl = vi.fn();

  beforeEach(() => {
    getTemporaryUrl.mockReset();
    URL.createObjectURL = vi.fn(() => 'blob:fake');
    URL.revokeObjectURL = vi.fn();
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        { provide: TransformsService, useValue: { getTemporaryUrl, transform: vi.fn(), createJob: vi.fn(), pollJob: vi.fn() } },
        { provide: ImagesService, useValue: { download: () => of(new Blob(['x'], { type: 'image/png' })) } },
      ],
    });
  });

  let fixture: ComponentFixture<ImageDetail>;
  async function render(): Promise<HTMLElement> {
    fixture = TestBed.createComponent(ImageDetail);
    fixture.componentRef.setInput('id', 'o1');
    await fixture.whenStable();
    return fixture.nativeElement as HTMLElement;
  }
  const generate = async (el: HTMLElement): Promise<void> => {
    (Array.from(el.querySelectorAll('button')).find((b) => b.textContent.includes('Générer')) as HTMLButtonElement).click();
    await fixture.whenStable();
  };

  it('affiche le panneau de transformation et le lien vers la galerie', async () => {
    const el = await render();
    expect(el.querySelector('app-transform-panel')).not.toBeNull();
    expect(el.querySelector('a[href="/images"]')).not.toBeNull();
    expect(getTemporaryUrl).not.toHaveBeenCalled(); // aucun lien généré tant qu'on ne le demande pas
  });

  it("génère un lien temporaire à la demande et l'affiche avec sa durée", async () => {
    getTemporaryUrl.mockReturnValue(of({ url: 'http://localhost:8333/b/o.png?X-Amz-Signature=abc', expiresInSeconds: 300, expiresAt: '2026-01-01T00:05:00.000Z' }));
    const el = await render();
    await generate(el);
    const input = el.querySelector('input[aria-label="Lien temporaire"]') as HTMLInputElement;
    expect(getTemporaryUrl).toHaveBeenCalledWith('o1');
    expect(input.value).toContain('X-Amz-Signature=abc');
    expect(el.textContent).toContain('300 s');
  });

  it("stockage sur disque (501) : affiche le message de l'API, pas de lien", async () => {
    getTemporaryUrl.mockReturnValue(
      throwError(() => new HttpErrorResponse({ status: 501, error: { error: 'PresignedUrlsUnsupported', message: "Ce stockage ne propose pas d'URLs signées : utilisez GET /images/:id" } })),
    );
    const el = await render();
    await generate(el);
    expect(el.querySelector('[role="alert"]')?.textContent).toContain("ne propose pas d'URLs signées");
    expect(el.querySelector('input[aria-label="Lien temporaire"]')).toBeNull();
  });
});
