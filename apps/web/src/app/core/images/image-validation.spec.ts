/** Tests du pré-contrôle de fichier image. */
import { MAX_UPLOAD_BYTES, validateImageFile } from './image-validation';

describe('validateImageFile', () => {
  it.each(['image/jpeg', 'image/png', 'image/webp'])('accepte %s', (type) => {
    expect(validateImageFile({ size: 1000, type })).toBeNull();
  });

  it('accepte un fichier pile à la limite de 10 Mo, refuse un octet de plus', () => {
    expect(validateImageFile({ size: MAX_UPLOAD_BYTES, type: 'image/png' })).toBeNull();
    expect(validateImageFile({ size: MAX_UPLOAD_BYTES + 1, type: 'image/png' })).toContain('lourd');
  });

  it('refuse un fichier vide', () => {
    expect(validateImageFile({ size: 0, type: 'image/png' })).toContain('vide');
  });

  it.each(['image/gif', 'text/plain', 'application/pdf', ''])('refuse le type %j', (type) => {
    expect(validateImageFile({ size: 1000, type })).toContain('Format');
  });
});
