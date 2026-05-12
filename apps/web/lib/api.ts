import "server-only";
import { NotFoundError, TheManagerError, ValidationError } from "@the-manager/shared";
import { NextResponse } from "next/server";
import { z } from "zod";

/**
 * Tiny route-handler glue. Centralises the error → HTTP mapping so individual
 * route files stay short and consistent.
 */

export function jsonOk<T>(data: T, init?: ResponseInit): Response {
  return NextResponse.json(data, init);
}

export function jsonErr(status: number, code: string, message: string): Response {
  return NextResponse.json({ error: code, message }, { status });
}

export function handleErr(err: unknown): Response {
  if (err instanceof NotFoundError) return jsonErr(404, err.code, err.message);
  if (err instanceof ValidationError) return jsonErr(400, err.code, err.message);
  if (err instanceof z.ZodError) {
    const flat = err.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ");
    return jsonErr(400, "VALIDATION", flat);
  }
  if (err instanceof TheManagerError) return jsonErr(500, err.code, err.message);
  const message = err instanceof Error ? err.message : String(err);
  return jsonErr(500, "INTERNAL", message);
}

export async function parseJson<T>(req: Request, schema: z.ZodType<T>): Promise<T> {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    throw new ValidationError("body must be valid JSON");
  }
  return schema.parse(raw);
}
