import { z } from "zod";

export const PublicSessionInitSchema = z.object({
  merchant_slug: z.string().min(1),
  device_id: z.string().uuid(),
});

export const PublicClaimStartSchema = z.object({
  public_token: z.string().min(16),
  phone: z.string().min(4).optional(),
  email: z.string().email().optional(),
}).refine((value) => value.phone || value.email, {
  message: "phone or email is required",
});

export const PublicClaimVerifySchema = z.object({
  challenge: z.string().min(8),
  code: z.string().min(4),
});

export const TokenResolveSchema = z.object({
  public_token: z.string().min(16),
});

export const TokenRevokeSchema = z.object({
  token_id: z.string().uuid().optional(),
  public_token: z.string().min(16).optional(),
}).refine((value) => value.token_id || value.public_token, {
  message: "token_id or public_token is required",
});

export const TokenBindNfcSchema = z.object({
  nfc_uid: z.string().min(4),
  public_token: z.string().min(16),
});

export const EarnSchema = z.object({
  public_token: z.string().min(16),
  amount: z.number().positive(),
  idempotency_key: z.string().min(8),
});

export const RedeemSchema = z.object({
  public_token: z.string().min(16),
  reward_id: z.string().uuid(),
  idempotency_key: z.string().min(8),
});

export type PublicSessionInitInput = z.infer<typeof PublicSessionInitSchema>;
