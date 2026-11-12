import { z } from 'zod';
import { ValidationError } from './errors.js';
import {
  CHANCE_PHASE,
  AKTIVITAET_TYP,
} from '../db/schema/enums.js';

// ─── Firma ────────────────────────────────────────────────────────────────────
export const FirmaCreateSchema = z.object({
  name: z.string().min(1, 'Name ist erforderlich').max(255),
  industry: z.string().max(255).optional().nullable(),
  website: z.string().max(500).optional().nullable(),
  phone: z.string().max(50).optional().nullable(),
  email: z.string().email('Ungültige E-Mail-Adresse').optional().nullable().or(z.literal('')),
  notes: z.string().optional().nullable(),
});
export type FirmaCreateDTO = z.infer<typeof FirmaCreateSchema>;

// ─── Person ───────────────────────────────────────────────────────────────────
export const PersonCreateSchema = z.object({
  firstName: z.string().min(1, 'Vorname ist erforderlich').max(100),
  lastName: z.string().min(1, 'Nachname ist erforderlich').max(100),
  email: z.string().email('Ungültige E-Mail-Adresse').optional().nullable().or(z.literal('')),
  phone: z.string().max(50).optional().nullable(),
  position: z.string().max(255).optional().nullable(),
  notes: z.string().optional().nullable(),
  firmaId: z.number().int().positive('Firma ist erforderlich'),
  abteilungId: z.number().int().positive().optional().nullable(),
});
export type PersonCreateDTO = z.infer<typeof PersonCreateSchema>;

// ─── Abteilung ────────────────────────────────────────────────────────────────
export const AbteilungCreateSchema = z.object({
  name: z.string().min(1, 'Name ist erforderlich').max(255),
  description: z.string().optional().nullable(),
  firmaId: z.number().int().positive('Firma ist erforderlich'),
});
export type AbteilungCreateDTO = z.infer<typeof AbteilungCreateSchema>;

// ─── Adresse ──────────────────────────────────────────────────────────────────
export const AdresseCreateSchema = z.object({
  street: z.string().max(255).optional().nullable(),
  houseNumber: z.string().max(20).optional().nullable(),
  postalCode: z.string().max(20).optional().nullable(),
  city: z.string().max(100).optional().nullable(),
  country: z.string().max(100).optional().nullable(),
  typ: z.string().max(50).optional().nullable(),
  firmaId: z.number().int().positive().optional().nullable(),
  personId: z.number().int().positive().optional().nullable(),
  latitude: z.number().min(-90).max(90).optional().nullable(),
  longitude: z.number().min(-180).max(180).optional().nullable(),
});
export type AdresseCreateDTO = z.infer<typeof AdresseCreateSchema>;

// ─── Aktivitaet ───────────────────────────────────────────────────────────────
export const AktivitaetCreateSchema = z.object({
  typ: z.enum(AKTIVITAET_TYP, { errorMap: () => ({ message: 'Ungültiger Typ' }) }),
  subject: z.string().min(1, 'Betreff ist erforderlich').max(255),
  description: z.string().optional().nullable(),
  datum: z.string().min(1, 'Datum ist erforderlich'),
  firmaId: z.number().int().positive().optional().nullable(),
  personId: z.number().int().positive().optional().nullable(),
});
export type AktivitaetCreateDTO = z.infer<typeof AktivitaetCreateSchema>;

// ─── Chance ───────────────────────────────────────────────────────────────────
export const ChanceCreateSchema = z.object({
  titel: z.string().min(1, 'Titel ist erforderlich').max(255),
  beschreibung: z.string().optional().nullable(),
  wert: z.number().optional().nullable(),
  currency: z.string().max(10).optional(),
  phase: z.enum(CHANCE_PHASE, { errorMap: () => ({ message: 'Ungültige Phase' }) }).optional(),
  wahrscheinlichkeit: z.number().int().min(0).max(100).optional().nullable(),
  erwartetesDatum: z.string().optional().nullable(),
  firmaId: z.number().int().positive('Firma ist erforderlich'),
  kontaktPersonId: z.number().int().positive().optional().nullable(),
});
export type ChanceCreateDTO = z.infer<typeof ChanceCreateSchema>;

// ─── Szenario ─────────────────────────────────────────────────────────────────
const DurationSchema = z
  .number()
  .int('Muss eine ganze Zahl sein')
  .min(0, 'Darf nicht negativ sein')
  .max(479520, 'Maximal 999 Tage');

const StepNameSchema = z.string().max(200, 'Maximal 200 Zeichen');

// A process is a chain of N steps with N-1 waits between them (a wait always
// belongs to the step before it). works.length and waits.length are sibling
// fields on the same object, so "one fewer wait than steps" is a cross-field
// rule and cannot be expressed as two independent per-array .length() calls.
// It is enforced below via .superRefine() with an explicit error path, so the
// emitted field-error key keeps its existing dotted shape (e.g. "humanSteps.waits").
function prozessSchema() {
  return z
    .object({
      works: z
        .array(DurationSchema)
        .min(1, 'Mindestens 1 Arbeitszeit')
        .max(50, 'Maximal 50 Arbeitszeiten'),
      waits: z.array(DurationSchema),
      names: z.array(StepNameSchema).optional(),
    })
    .superRefine((val, ctx) => {
      if (val.waits.length !== val.works.length - 1) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Genau ${val.works.length - 1} Wartezeiten`,
          path: ['waits'],
        });
      }
      if (val.names !== undefined && val.names.length !== val.works.length) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Genau ${val.works.length} Namen`,
          path: ['names'],
        });
      }
    });
}

export const SzenarioSchema = z.object({
  name: z.string().min(1, 'Name ist erforderlich'),
  humanSteps: prozessSchema(),
  agileKiSteps: prozessSchema(),
  semiAutomatedSteps: prozessSchema(),
  automatedSteps: prozessSchema(),
});
export type SzenarioCreateDTO = z.infer<typeof SzenarioSchema>;

// ─── validate() helper ────────────────────────────────────────────────────────
export function validate<T>(schema: z.ZodSchema<T>, data: unknown): T {
  const result = schema.safeParse(data);
  if (!result.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of result.error.issues) {
      const path = issue.path.join('.');
      fieldErrors[path || '_'] = issue.message;
    }
    throw new ValidationError('Validierungsfehler', fieldErrors);
  }
  return result.data;
}
