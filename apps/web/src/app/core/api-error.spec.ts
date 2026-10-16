/** Tests de la traduction des erreurs de l'API. */
import { HttpErrorResponse } from '@angular/common/http';
import { describeApiError } from './api-error';

describe('describeApiError', () => {
  it("utilise le message de l'API quand il existe", () => {
    const error = new HttpErrorResponse({ status: 415, error: { error: 'UnsupportedImageFormat', message: 'Format non supporté' } });
    expect(describeApiError(error)).toBe('Format non supporté');
  });

  it("signale une API injoignable (status 0)", () => {
    expect(describeApiError(new HttpErrorResponse({ status: 0 }))).toContain('joindre');
  });

  it('retombe sur le code HTTP si le corps est inexploitable', () => {
    expect(describeApiError(new HttpErrorResponse({ status: 500, error: '<html>' }))).toBe('Erreur 500.');
    expect(describeApiError(new HttpErrorResponse({ status: 500, error: null }))).toBe('Erreur 500.');
  });

  it("gère une erreur qui n'est pas HTTP", () => {
    expect(describeApiError(new Error('boom'))).toContain('inattendue');
  });
});
