/** Tests du panneau de transformation : validation avant envoi, mode synchrone, mode arrière-plan (suivi du job) et nettoyage. */
import { HttpErrorResponse } from '@angular/common/http';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { Observable, of, Subject, throwError } from 'rxjs';
import { ImageSummary } from '../../core/images/image.models';
import { JobSummary, TransformBody } from '../../core/images/transform.models';
import { TransformsService } from '../../core/images/transforms.service';
import { ImagesService } from '../../core/images/images.service';
import { TransformPanel } from './transform-panel';

const DERIVED: ImageSummary = { id: 'd1', originalId: 'o1', format: 'webp', sizeBytes: 10, width: 20, height: 40, createdAt: '2026-01-01T00:00:00.000Z' };
const job = (status: JobSummary['status'], extra: Partial<JobSummary> = {}): JobSummary => ({
  id: 'j1',
  status,
  sourceImageId: 'o1',
  attempts: 0,
  image: null,
  error: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  ...extra,
});

describe('TransformPanel', () => {
  const transform = vi.fn();
  const createJob = vi.fn();
  const pollJob = vi.fn();
  let fixture: ComponentFixture<TransformPanel>;
  let el: HTMLElement;

  beforeEach(async () => {
    transform.mockReset();
    createJob.mockReset();
    pollJob.mockReset();
    URL.createObjectURL = vi.fn(() => 'blob:fake');
    URL.revokeObjectURL = vi.fn();
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        { provide: TransformsService, useValue: { transform, createJob, pollJob } },
        { provide: ImagesService, useValue: { download: () => of(new Blob(['x'], { type: 'image/png' })) } },
      ],
    });
    fixture = TestBed.createComponent(TransformPanel);
    fixture.componentRef.setInput('imageId', 'o1');
    await fixture.whenStable();
    el = fixture.nativeElement as HTMLElement;
  });

  const field = (id: string): HTMLInputElement | HTMLSelectElement => el.querySelector(`#${id}`) as HTMLInputElement | HTMLSelectElement;
  async function type(id: string, value: string): Promise<void> {
    const control = field(id);
    control.value = value;
    control.dispatchEvent(new Event(control instanceof HTMLSelectElement ? 'change' : 'input'));
    await fixture.whenStable();
  }
  async function tick(): Promise<void> {
    await fixture.whenStable();
  }
  async function submit(): Promise<void> {
    (el.querySelector('button[type="submit"]') as HTMLButtonElement).click();
    await tick();
  }
  const alerts = (): string => (el.querySelector('[role="alert"]')?.textContent ?? '').replace(/\s+/g, ' ').trim();
  const entries = (): HTMLElement[] => Array.from(el.querySelectorAll('[data-state]'));

  it('refuse un formulaire vide SANS appel réseau', async () => {
    await submit();
    expect(alerts()).toContain('Choisissez au moins une transformation');
    expect(transform).not.toHaveBeenCalled();
    expect(createJob).not.toHaveBeenCalled();
  });

  it('affiche toutes les erreurs de validation et ne contacte pas l\'API', async () => {
    await type('rotate', '999');
    await type('quality', '0');
    await submit();
    expect(alerts()).toContain('Rotation');
    expect(alerts()).toContain('Qualité');
    expect(transform).not.toHaveBeenCalled();
  });

  it('mode synchrone : envoie le corps construit à l\'image courante et affiche le résultat avec un lien', async () => {
    transform.mockReturnValue(of({ image: DERIVED, cached: false }));
    await type('rotate', '90');
    await type('format', 'webp');
    await submit();

    expect(transform).toHaveBeenCalledTimes(1);
    expect(transform.mock.calls[0]).toEqual(['o1', { rotate: 90, format: 'webp' } satisfies TransformBody]);
    expect(createJob).not.toHaveBeenCalled();
    expect(entries()).toHaveLength(1);
    expect(entries()[0]?.textContent).toContain('Image créée');
    expect(el.querySelector('a[href="/images/d1"]')).not.toBeNull();
  });

  it('indique quand le résultat vient du cache (aucun recalcul)', async () => {
    transform.mockReturnValue(of({ image: DERIVED, cached: true }));
    await type('rotate', '90');
    await submit();
    expect(entries()[0]?.textContent).toContain('Déjà produite');
  });

  it("affiche le message de l'API en cas d'erreur (ex. 503 serveur saturé) et permet de réessayer", async () => {
    transform.mockReturnValueOnce(
      throwError(() => new HttpErrorResponse({ status: 503, error: { error: 'ServerBusy', message: 'Serveur occupé par d\'autres traitements, réessayez dans un instant' } })),
    );
    await type('rotate', '90');
    await submit();
    expect(alerts()).toContain('Serveur occupé');
    expect((el.querySelector('button[type="submit"]') as HTMLButtonElement).disabled).toBe(false);

    transform.mockReturnValueOnce(of({ image: DERIVED, cached: false }));
    await submit();
    expect(entries()).toHaveLength(1);
    expect(alerts()).toBe(''); // l'erreur précédente a disparu
  });

  it('mode arrière-plan : crée un job, suit son statut (file → traitement → terminé) puis affiche le résultat', async () => {
    const polling = new Subject<JobSummary>();
    createJob.mockReturnValue(of(job('queued')));
    pollJob.mockReturnValue(polling);
    await type('rotate', '90');
    (field('rotate').closest('form')?.querySelector('input[formControlName="background"]') as HTMLInputElement).click();
    await submit();

    expect(createJob).toHaveBeenCalledWith('o1', { rotate: 90 });
    expect(transform).not.toHaveBeenCalled();
    expect(pollJob).toHaveBeenCalledWith('j1');
    expect(entries()[0]?.getAttribute('data-state')).toBe('working');
    expect(entries()[0]?.textContent).toContain("En file d'attente");

    polling.next(job('processing'));
    await tick();
    expect(entries()[0]?.textContent).toContain('Traitement en cours');

    polling.next(job('completed', { image: DERIVED }));
    polling.complete();
    await tick();
    expect(entries()[0]?.getAttribute('data-state')).toBe('done');
    expect(el.querySelector('a[href="/images/d1"]')).not.toBeNull();
  });

  it("job échoué : affiche le message de l'API en rouge, sans résultat", async () => {
    createJob.mockReturnValue(of(job('queued')));
    pollJob.mockReturnValue(of(job('failed', { error: { kind: 'ImageNotFound', message: 'Image source introuvable' } })));
    await type('rotate', '90');
    (el.querySelector('input[formControlName="background"]') as HTMLInputElement).click();
    await submit();
    expect(entries()[0]?.getAttribute('data-state')).toBe('failed');
    expect(entries()[0]?.textContent).toContain('Image source introuvable');
    expect(el.querySelector('a[href="/images/d1"]')).toBeNull();
  });

  it("attente abandonnée (le suivi se termine sans statut final) : explique que le job continue côté serveur", async () => {
    createJob.mockReturnValue(of(job('queued')));
    pollJob.mockReturnValue(of(job('queued')));
    await type('rotate', '90');
    (el.querySelector('input[formControlName="background"]') as HTMLInputElement).click();
    await submit();
    expect(entries()[0]?.textContent).toContain('Toujours en cours');
    expect(entries()[0]?.textContent).toContain('j1');
  });

  it("création de job refusée (503, file injoignable) : message d'erreur, aucun suivi", async () => {
    createJob.mockReturnValue(
      throwError(() => new HttpErrorResponse({ status: 503, error: { error: 'QueueUnavailable', message: 'Service de traitement momentanément indisponible, réessayez plus tard' } })),
    );
    await type('rotate', '90');
    (el.querySelector('input[formControlName="background"]') as HTMLInputElement).click();
    await submit();
    expect(alerts()).toContain('momentanément indisponible');
    expect(pollJob).not.toHaveBeenCalled();
  });

  it("arrête le suivi d'un job quand on change d'image, et vide la liste des résultats", async () => {
    let tornDown = false;
    createJob.mockReturnValue(of(job('queued')));
    // Un flux qui ne se termine jamais ; sa fonction de nettoyage ne s'exécute que si le panneau se désabonne.
    pollJob.mockReturnValue(new Observable<JobSummary>(() => () => {
      tornDown = true;
    }));
    await type('rotate', '90');
    (el.querySelector('input[formControlName="background"]') as HTMLInputElement).click();
    await submit();
    expect(entries()).toHaveLength(1);
    expect(tornDown).toBe(false);

    fixture.componentRef.setInput('imageId', 'autre');
    await tick();
    expect(entries()).toHaveLength(0);
    expect(tornDown).toBe(true);
  });

  it('arrête aussi le suivi quand le panneau est détruit', async () => {
    let tornDown = false;
    createJob.mockReturnValue(of(job('queued')));
    pollJob.mockReturnValue(new Observable<JobSummary>(() => () => {
      tornDown = true;
    }));
    await type('rotate', '90');
    (el.querySelector('input[formControlName="background"]') as HTMLInputElement).click();
    await submit();
    fixture.destroy();
    expect(tornDown).toBe(true);
  });

  it('« Réinitialiser » vide les champs et les erreurs', async () => {
    await type('rotate', '999');
    await submit();
    expect(alerts()).not.toBe('');
    (Array.from(el.querySelectorAll('button')).find((b) => b.textContent.includes('Réinitialiser')) as HTMLButtonElement).click();
    await tick();
    expect(alerts()).toBe('');
    expect(field('rotate').value).toBe('');
  });

  it('empêche un double envoi pendant une requête en cours', async () => {
    const pending = new Subject<{ image: ImageSummary; cached: boolean }>();
    transform.mockReturnValue(pending);
    await type('rotate', '90');
    await submit();
    await submit();
    expect(transform).toHaveBeenCalledTimes(1);
    expect((el.querySelector('button[type="submit"]') as HTMLButtonElement).disabled).toBe(true);
    pending.next({ image: DERIVED, cached: false });
    pending.complete();
    await tick();
    expect((el.querySelector('button[type="submit"]') as HTMLButtonElement).disabled).toBe(false);
  });
});
