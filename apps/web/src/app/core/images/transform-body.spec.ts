/** Tests de la construction du corps de transformation : champs vides ignorés, bornes identiques à celles de l'API. */
import { buildTransformBody, MAX_SIDE, TransformFormValue, WATERMARK_MAX_LENGTH } from './transform-body';

const EMPTY: TransformFormValue = {
  rotate: null,
  flip: false,
  mirror: false,
  resizeWidth: null,
  resizeHeight: null,
  resizeFit: '',
  filter: '',
  cropX: null,
  cropY: null,
  cropWidth: null,
  cropHeight: null,
  watermarkText: '',
  watermarkPosition: '',
  watermarkOpacity: null,
  format: '',
  quality: null,
};
const withFields = (fields: Partial<TransformFormValue>): TransformFormValue => ({ ...EMPTY, ...fields });

function errorsOf(fields: Partial<TransformFormValue>): readonly string[] {
  const result = buildTransformBody(withFields(fields));
  if (result.ok) throw new Error('une erreur était attendue');
  return result.errors;
}

describe('buildTransformBody', () => {
  it('refuse un formulaire vide : au moins une transformation est requise', () => {
    expect(errorsOf({})).toEqual(['Choisissez au moins une transformation.']);
  });

  it("n'envoie que les champs renseignés (les cases décochées et les champs vides sont omis)", () => {
    const result = buildTransformBody(withFields({ rotate: 90, filter: 'sepia' }));
    expect(result).toEqual({ ok: true, body: { rotate: 90, filter: 'sepia' } });
  });

  it('le format seul est une transformation valide (conversion)', () => {
    expect(buildTransformBody(withFields({ format: 'webp' }))).toEqual({ ok: true, body: { format: 'webp' } });
  });

  it('assemble toutes les opérations', () => {
    const result = buildTransformBody(
      withFields({
        rotate: -90,
        flip: true,
        mirror: true,
        resizeWidth: 300,
        resizeHeight: 200,
        resizeFit: 'cover',
        filter: 'grayscale',
        cropX: 0,
        cropY: 5,
        cropWidth: 100,
        cropHeight: 50,
        watermarkText: '  © Moi  ',
        watermarkPosition: 'center',
        watermarkOpacity: 0.5,
        format: 'jpeg',
        quality: 80,
      }),
    );
    expect(result).toEqual({
      ok: true,
      body: {
        rotate: -90,
        flip: true,
        mirror: true,
        resize: { width: 300, height: 200, fit: 'cover' },
        filter: 'grayscale',
        crop: { x: 0, y: 5, width: 100, height: 50 },
        watermark: { text: '© Moi', position: 'center', opacity: 0.5 },
        format: 'jpeg',
        quality: 80,
      },
    });
  });

  describe('rotation', () => {
    it.each([-360, 0, 45, 360])('accepte %i', (rotate) => {
      expect(buildTransformBody(withFields({ rotate })).ok).toBe(true);
    });
    it.each([361, -361, 45.5])('refuse %f', (rotate) => {
      expect(errorsOf({ rotate })).toEqual(['Rotation : un entier entre -360 et 360.']);
    });
  });

  describe('redimensionnement', () => {
    it("n'envoie que la dimension renseignée", () => {
      expect(buildTransformBody(withFields({ resizeWidth: 100 }))).toEqual({ ok: true, body: { resize: { width: 100 } } });
      expect(buildTransformBody(withFields({ resizeHeight: 100 }))).toEqual({ ok: true, body: { resize: { height: 100 } } });
    });
    it.each([0, -5, MAX_SIDE + 1, 10.5])('refuse une largeur de %f', (resizeWidth) => {
      expect(errorsOf({ resizeWidth })).toEqual([`Largeur : un entier entre 1 et ${String(MAX_SIDE)}.`]);
    });
    it('refuse une hauteur hors bornes, et accepte la borne haute', () => {
      expect(errorsOf({ resizeHeight: 0 })[0]).toContain('Hauteur');
      expect(buildTransformBody(withFields({ resizeHeight: MAX_SIDE })).ok).toBe(true);
    });
    it("refuse un ajustement sans dimension (l'API exige largeur ou hauteur)", () => {
      expect(errorsOf({ resizeFit: 'cover' })).toEqual(['Ajustement : indiquez aussi une largeur ou une hauteur.']);
    });
  });

  describe('recadrage', () => {
    it('exige les quatre valeurs', () => {
      expect(errorsOf({ cropX: 0, cropY: 0, cropWidth: 10 })).toEqual(['Recadrage : renseignez x, y, largeur et hauteur.']);
    });
    it.each([
      { cropX: -1, cropY: 0, cropWidth: 10, cropHeight: 10 },
      { cropX: 0, cropY: 0, cropWidth: 0, cropHeight: 10 },
      { cropX: 0, cropY: 0, cropWidth: 10, cropHeight: 1.5 },
    ])('refuse %o', (crop) => {
      expect(errorsOf(crop)).toEqual(['Recadrage : x et y entiers ≥ 0, largeur et hauteur entiers ≥ 1.']);
    });
    it('accepte x = 0 et y = 0', () => {
      expect(buildTransformBody(withFields({ cropX: 0, cropY: 0, cropWidth: 1, cropHeight: 1 })).ok).toBe(true);
    });
  });

  describe('filigrane', () => {
    it('refuse un texte trop long, en comptant les caractères visibles (un emoji vaut 1)', () => {
      expect(errorsOf({ watermarkText: 'a'.repeat(WATERMARK_MAX_LENGTH + 1) })[0]).toContain('30 caractères');
      expect(buildTransformBody(withFields({ watermarkText: '😀'.repeat(WATERMARK_MAX_LENGTH) })).ok).toBe(true);
    });
    it("refuse une opacité hors de 0,1 à 1, accepte les bornes", () => {
      expect(errorsOf({ watermarkText: 'x', watermarkOpacity: 0.05 })[0]).toContain('opacité');
      expect(errorsOf({ watermarkText: 'x', watermarkOpacity: 1.1 })[0]).toContain('opacité');
      expect(buildTransformBody(withFields({ watermarkText: 'x', watermarkOpacity: 0.1 })).ok).toBe(true);
      expect(buildTransformBody(withFields({ watermarkText: 'x', watermarkOpacity: 1 })).ok).toBe(true);
    });
    it("refuse une position ou une opacité sans texte ; un texte d'espaces est un texte vide", () => {
      expect(errorsOf({ watermarkPosition: 'center' })[0]).toContain('saisissez un texte');
      expect(errorsOf({ watermarkOpacity: 0.5 })[0]).toContain('saisissez un texte');
      expect(errorsOf({ watermarkText: '   ' })).toEqual(['Choisissez au moins une transformation.']);
    });
  });

  describe('qualité', () => {
    it.each([1, 50, 100])('accepte %i', (quality) => {
      expect(buildTransformBody(withFields({ quality })).ok).toBe(true);
    });
    it.each([0, 101, 80.5])('refuse %f', (quality) => {
      expect(errorsOf({ quality })).toEqual(['Qualité : un entier entre 1 et 100.']);
    });
  });

  it('cumule toutes les erreurs au lieu de s\'arrêter à la première', () => {
    expect(errorsOf({ rotate: 999, quality: 0, resizeWidth: 0 })).toHaveLength(3);
  });
});
