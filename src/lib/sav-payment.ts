import { z } from 'zod'

export const savPaymentSchema = z.object({
  id: z.guid(),
  amount_due: z.string().trim().max(20)
    .regex(/^(?:\d+(?:[.,]\d{1,2})?)?$/, 'Saisissez un montant positif avec deux décimales maximum.')
    .transform((value) => value === '' ? null : Number(value.replace(',', '.')))
    .refine((value) => value === null || value <= 999999.99, 'Le montant maximum est de 999 999,99 €.'),
  is_paid: z.boolean(),
}).refine((value) => !value.is_paid || value.amount_due !== null, {
  message: 'Renseignez le montant avant de marquer le dossier comme payé.', path: ['amount_due'],
})

export type SavPaymentInput = z.input<typeof savPaymentSchema>
