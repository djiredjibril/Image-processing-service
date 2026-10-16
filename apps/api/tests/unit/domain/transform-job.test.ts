/** Tests unitaires de l'entité TransformJob : machine à états et invariants. */
import { describe, expect, it } from "vitest";
import { TransformJob } from "../../../src/domain/entities/transform-job.js";
import { isErr, isOk } from "../../../src/domain/shared/result.js";

const fresh = (): TransformJob => TransformJob.create({ ownerId: "o", sourceImageId: "s", transformations: { rotate: 90 } });

function must<T>(result: { ok: boolean; value?: T }): T {
  if (!result.ok || result.value === undefined) throw new Error("transition attendue valide");
  return result.value;
}

describe("TransformJob", () => {
  it("naît en file : queued, 0 tentative, sans résultat ni erreur", () => {
    const job = fresh();
    expect(job.status).toBe("queued");
    expect(job.props).toMatchObject({ attempts: 0, resultImageId: null, errorKind: null, errorMessage: null });
    expect(job.id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("chemin heureux : queued → processing (1 tentative) → completed avec l'image résultat", () => {
    const processing = must(fresh().startProcessing());
    expect(processing.status).toBe("processing");
    expect(processing.props.attempts).toBe(1);
    const done = must(processing.complete("img-1"));
    expect(done.status).toBe("completed");
    expect(done.props.resultImageId).toBe("img-1");
  });

  it("est immuable : une transition renvoie un NOUVEAU job, l'ancien ne change pas", () => {
    const job = fresh();
    must(job.startProcessing());
    expect(job.status).toBe("queued");
    expect(job.props.attempts).toBe(0);
  });

  it("une nouvelle tentative après panne est autorisée : processing → processing compte une tentative de plus", () => {
    const second = must(must(fresh().startProcessing()).startProcessing());
    expect(second.status).toBe("processing");
    expect(second.props.attempts).toBe(2);
  });

  it("échec : enregistre le type et le message, et peut survenir depuis queued ou processing", () => {
    const failed = must(must(fresh().startProcessing()).fail("InvalidTransformation", "rotate invalide"));
    expect(failed.status).toBe("failed");
    expect(failed.props).toMatchObject({ errorKind: "InvalidTransformation", errorMessage: "rotate invalide", resultImageId: null });
    expect(isOk(fresh().fail("ProcessingFailed", "x"))).toBe(true);
  });

  it("les états terminaux le restent : aucune transition depuis completed ni failed", () => {
    const completed = must(must(fresh().startProcessing()).complete("img"));
    const failed = must(fresh().fail("K", "m"));
    for (const job of [completed, failed]) {
      expect(isErr(job.startProcessing())).toBe(true);
      expect(isErr(job.fail("K", "m"))).toBe(true);
      expect(isErr(job.complete("img"))).toBe(true);
    }
  });

  it("on ne peut pas terminer en succès un job qui n'a pas démarré", () => {
    const result = fresh().complete("img");
    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.error).toMatchObject({ kind: "InvalidJobTransition", from: "queued", to: "completed" });
  });
});
