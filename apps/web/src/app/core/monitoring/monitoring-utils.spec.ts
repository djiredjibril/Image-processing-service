/** Tests des fonctions pures de la supervision. */
import { formatBytes, formatUptime, hitRatioPercent, HISTORY_SIZE, pushSample, randomLoadBody, Sample, sparklinePoints, throughputPerSecond } from './monitoring-utils';

const counts = (completed: number, failed = 0) => ({ waiting: 0, active: 0, delayed: 0, completed, failed });
const sample = (at: number, completed: number, failed = 0): Sample => ({ at, counts: counts(completed, failed) });

describe('formatBytes', () => {
  it.each([
    [null, '–'],
    [0, '0 o'],
    [512, '512 o'],
    [1024, '1,0 Ko'],
    [2_584_040, '2,5 Mo'],
    [5 * 1024 ** 3, '5,0 Go'],
  ])('%s → %s', (value, expected) => {
    expect(formatBytes(value)).toBe(expected);
  });
});

describe('formatUptime', () => {
  it.each([
    [null, '–'],
    [0, '0 s'],
    [45, '45 s'],
    [60, '1 min'],
    [3599, '59 min'],
    [3 * 3600 + 5 * 60, '3 h 05 min'],
    [26 * 3600, '1 j 2 h'],
  ])('%s → %s', (value, expected) => {
    expect(formatUptime(value)).toBe(expected);
  });
});

describe('hitRatioPercent', () => {
  it('renvoie null tant qu\'il n\'y a aucune transformation (pas de division par zéro)', () => {
    expect(hitRatioPercent(0, 0)).toBeNull();
  });
  it('calcule la part des réponses servies par le cache, arrondie', () => {
    expect(hitRatioPercent(1, 3)).toBe(25);
    expect(hitRatioPercent(2, 1)).toBe(67);
    expect(hitRatioPercent(5, 0)).toBe(100);
    expect(hitRatioPercent(0, 4)).toBe(0);
  });
});

describe('pushSample', () => {
  it('ajoute à la fin sans modifier l\'historique d\'origine', () => {
    const history = [sample(1, 0)];
    const next = pushSample(history, sample(2, 1));
    expect(next.map((s) => s.at)).toEqual([1, 2]);
    expect(history).toHaveLength(1);
  });
  it('ne garde que les plus récents (une minute à 1 relevé par seconde)', () => {
    let history: readonly Sample[] = [];
    for (let i = 0; i < HISTORY_SIZE + 10; i++) history = pushSample(history, sample(i, 0));
    expect(history).toHaveLength(HISTORY_SIZE);
    expect(history[0]?.at).toBe(10);
    expect(history.at(-1)?.at).toBe(HISTORY_SIZE + 9);
  });
});

describe('throughputPerSecond', () => {
  it('null sans relevé précédent ou si le temps n\'a pas avancé', () => {
    expect(throughputPerSecond(null, sample(1000, 5))).toBeNull();
    expect(throughputPerSecond(sample(1000, 0), sample(1000, 5))).toBeNull();
  });
  it('compte les jobs terminés (réussis ou échoués) par seconde', () => {
    expect(throughputPerSecond(sample(0, 10, 0), sample(2000, 14, 2))).toBe(3);
    expect(throughputPerSecond(sample(0, 5), sample(500, 6))).toBe(2);
  });
  it('un compteur qui diminue (file purgée, Redis vidé) donne 0, jamais un débit négatif', () => {
    expect(throughputPerSecond(sample(0, 100), sample(1000, 3))).toBe(0);
  });
});

describe('sparklinePoints', () => {
  it('vide avec moins de deux valeurs', () => {
    expect(sparklinePoints([], 100, 50)).toBe('');
    expect(sparklinePoints([3], 100, 50)).toBe('');
  });
  it('trace de gauche à droite sur toute la largeur, 0 en bas et le maximum en haut', () => {
    expect(sparklinePoints([0, 10, 5], 100, 50, 10)).toBe('0.0,50.0 50.0,0.0 100.0,25.0');
  });
  it('garde une échelle minimale : une petite valeur ne devient pas un pic plein hauteur', () => {
    expect(sparklinePoints([0, 1], 100, 50, 5)).toBe('0.0,50.0 100.0,40.0');
  });
  it('ne dépasse jamais le cadre', () => {
    const points = sparklinePoints([0, 3, 99, 7], 300, 80).split(' ').map((p) => p.split(',').map(Number));
    for (const [x, y] of points) {
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThanOrEqual(300);
      expect(y).toBeGreaterThanOrEqual(0);
      expect(y).toBeLessThanOrEqual(80);
    }
  });
});

describe('randomLoadBody', () => {
  it('produit des paramètres valides pour l\'API (rotation 1-359, largeur 200-1000, webp)', () => {
    for (const r of [0, 0.5, 0.999999]) {
      const body = randomLoadBody(() => r);
      expect(body.rotate).toBeGreaterThanOrEqual(1);
      expect(body.rotate).toBeLessThanOrEqual(359);
      expect(body.resize?.width).toBeGreaterThanOrEqual(200);
      expect(body.resize?.width).toBeLessThanOrEqual(1000);
      expect(body.format).toBe('webp');
    }
  });
  it('varie d\'un appel à l\'autre (sinon le cache absorberait la charge)', () => {
    const bodies = new Set(Array.from({ length: 30 }, () => JSON.stringify(randomLoadBody())));
    expect(bodies.size).toBeGreaterThan(20);
  });
});
