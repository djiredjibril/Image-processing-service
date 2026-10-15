# Système de Règles d'Ingénierie Logicielle (TS Backend)

Applique strictement la Clean Architecture, le DDD et les principes SOLID sur toutes
les tâches d'implémentation.

## Contraintes d'Architecture & Patterns

1. **Domaine Pur (DDD) :**
   - Crée des entités isolées avec propriétés immuables (`readonly`) et méthodes
     d'usine statiques (`Entity.create()`).
   - Encapsule les invariants métiers dans des *Value Objects*. Zéro dépendance
     technique (ex : ORM/Framework) dans `src/domain/`.

2. **Inversion des Dépendances (SOLID - D) :**
   - Définis obligatoirement les interfaces de stockage (`I{Entity}Repository`)
     dans le domaine.
   - Relègue l'implémentation concrète (Prisma, TypeORM, Kysely, NestJS)
     exclusivement dans `src/infrastructure/`.

3. **Cas d'Usage (Use Cases) :**
   - Implémente un pattern *Command* ou un service par cas d'usage métier unique.
   - Utilise le pattern *Result/Either* pour renvoyer des erreurs typées.
     Pas de `throw` générique.

4. **Validation Stricte (Fail Fast) :**
   - Valide tous les payloads d'entrée (DTOs) via des schémas de typage stricts (Zod)
     à la frontière de l'infrastructure.

5. **Type Safety (TS Strict) :**
   - Interdiction formelle du type `any`. Utilise `unknown` combiné avec des
     *Type Guards* ou des asserts de type explicites si le type initial est incertain.

6. **Docstrings (TSDoc) obligatoires :**
   - Chaque fichier commence par un **commentaire d'en-tête** (`/** ... */`) qui dit
     en 1 à 3 lignes *quel est son rôle* et *dans quelle couche* il vit.
   - Chaque élément **exporté** (classe, interface, type, fonction, méthode publique,
     value object, use case) a une docstring TSDoc en **français**.
   - Une docstring explique le **pourquoi** et le **contrat** (ce que la chose garantit),
     pas une paraphrase du code. Elle utilise `@param`, `@returns` et, quand c'est
     pertinent, `@example`.
   - Pour un use case ou une méthode qui renvoie un `Result` : lister les **erreurs
     possibles** (avec `@returns` ou une phrase dédiée).
   - Pour une entité ou un value object : documenter les **invariants** qu'il protège.
   - Pour une interface de port ou de repository : documenter le **contrat** que toute
     implémentation doit respecter (ex. « renvoie `null` si introuvable, ne lève jamais »).
   - Les éléments privés n'ont une docstring que si leur logique n'est pas évidente.
   - Un commentaire `//` sert à expliquer une ligne délicate ; il ne remplace jamais
     une docstring.

Génère ou valide le code en respectant scrupuleusement cet empilement de patterns pour
maximiser la testabilité et le découplage.

---

## Précisions pour ce projet

- **Persistance** : l'implémentation concrète est écrite avec le driver natif `pg`
  (pas d'ORM), dans `src/infrastructure/persistence/`. Le domaine ne sait pas que
  PostgreSQL existe.
- **Framework HTTP** : Express, uniquement dans `src/infrastructure/http/`. Une route
  valide l'entrée (zod), appelle un use case, puis traduit le `Result` en réponse HTTP.
  Elle ne contient aucune logique métier.
- **Erreurs** : les erreurs métier sont des types dédiés (ex. `EmailAlreadyUsed`,
  `UnsupportedImageFormat`), renvoyées dans le `Result`. Un seul endroit traduit
  ces erreurs en codes HTTP. `throw` n'est réservé qu'aux erreurs réellement
  inattendues (bug, panne d'infrastructure), attrapées par un middleware global.
- **Testabilité** : chaque use case reçoit ses dépendances par son constructeur
  (interfaces), ce qui permet de les tester avec des fakes en mémoire.

---

## Exemple de référence (docstrings)

```ts
/**
 * Value Object représentant une adresse e-mail valide.
 *
 * Couche : domaine. Protège l'invariant « un Email existant est toujours bien formé »,
 * de sorte qu'aucun autre code n'a besoin de le revérifier.
 */
export class Email {
  private constructor(public readonly value: string) {}

  /**
   * Construit un Email à partir d'une chaîne brute.
   *
   * @param raw - Chaîne saisie par l'utilisateur (sera normalisée en minuscules).
   * @returns `Ok(Email)` si le format est valide, sinon `Err(InvalidEmailError)`.
   * @example
   * const result = Email.create("Salut@Example.com");
   * // result.value.value === "salut@example.com"
   */
  static create(raw: string): Result<Email, InvalidEmailError> {
    // ...
  }
}
```

```ts
/**
 * Contrat de persistance des utilisateurs.
 *
 * Couche : domaine (port). Toute implémentation (pg, mémoire pour les tests, ...)
 * doit respecter ce contrat.
 */
export interface IUserRepository {
  /**
   * Cherche un utilisateur par e-mail.
   *
   * @returns L'utilisateur, ou `null` s'il n'existe pas. Ne lève pas d'erreur
   * pour « introuvable ».
   */
  findByEmail(email: Email): Promise<User | null>;
}
```
