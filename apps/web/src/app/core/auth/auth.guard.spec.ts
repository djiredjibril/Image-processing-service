/** Tests des guards de routes. */
import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { ActivatedRouteSnapshot, provideRouter, Router, RouterStateSnapshot } from '@angular/router';
import { authGuard, guestGuard } from './auth.guard';

describe('guards', () => {
  const route = {} as ActivatedRouteSnapshot;
  const state = {} as RouterStateSnapshot;

  function setup(token: string | null): Router {
    localStorage.clear();
    if (token !== null) {
      localStorage.setItem('ips.token', token);
    }
    TestBed.configureTestingModule({ providers: [provideRouter([]), provideHttpClient()] });
    return TestBed.inject(Router);
  }
  const run = (guard: typeof authGuard): unknown => TestBed.runInInjectionContext(() => guard(route, state));

  it('authGuard laisse passer un utilisateur connecté', () => {
    setup('jeton');
    expect(run(authGuard)).toBe(true);
  });

  it('authGuard redirige un visiteur vers /login', () => {
    const router = setup(null);
    expect(run(authGuard)).toEqual(router.createUrlTree(['/login']));
  });

  it('guestGuard laisse passer un visiteur', () => {
    setup(null);
    expect(run(guestGuard)).toBe(true);
  });

  it('guestGuard renvoie un utilisateur connecté vers la galerie', () => {
    const router = setup('jeton');
    expect(run(guestGuard)).toEqual(router.createUrlTree(['/images']));
  });
});
