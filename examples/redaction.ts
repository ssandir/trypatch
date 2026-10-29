import { db } from './shared'

// #region redaction
import { z } from 'zod'
import { trypatch } from '@ssandir/trypatch'

const CustomerSchema = z.object({
    id: z.string(),
    name: z.string(),
    tier: z.enum(['free', 'pro', 'enterprise']),
})
type Customer = z.infer<typeof CustomerSchema>

export class CustomerRepository {
    @trypatch({
        aiInvestigation: {
            resultSchema: CustomerSchema,
            investigationProvider: {
                provider: 'openai',
                apiKey: process.env.OPENAI_API_KEY!,
            },
            // Redacted on top of what flare-redact's detectors find
            redactConfig: {
                terms: [process.env.DB_PASSWORD!, process.env.INTERNAL_SERVICE_TOKEN!],
            },
        },
    })
    async getCustomer (customerId: string): Promise<Customer> {
        // Even if the password appears in the error, it won't reach OpenAI
        const [row] = await db.query('SELECT id, name, tier FROM customers WHERE id = $1', [customerId])
        return CustomerSchema.parse(row)
    }
}
// #endregion redaction
