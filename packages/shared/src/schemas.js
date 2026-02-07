import { z } from "zod";
export const MerchantSlugSchema = z.string().min(1);
export const DeviceIdSchema = z.string().uuid();
export const PublicTokenSchema = z.string().min(16);
export const IdempotencyKeySchema = z.string().min(8);
export const PublicSessionInitSchema = z.object({
    merchant_slug: MerchantSlugSchema,
    device_id: DeviceIdSchema
});
export const PublicCardParamsSchema = z.object({
    publicToken: PublicTokenSchema
});
export const StaffResolveSchema = z.object({
    public_token: PublicTokenSchema
});
export const EarnSchema = z.object({
    public_token: PublicTokenSchema,
    amount: z.number().positive(),
    idempotency_key: IdempotencyKeySchema
});
export const RedeemSchema = z.object({
    public_token: PublicTokenSchema,
    reward_id: z.string().uuid(),
    idempotency_key: IdempotencyKeySchema
});
